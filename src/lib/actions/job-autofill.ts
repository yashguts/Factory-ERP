"use server";

/**
 * Orchestrates AI autofill for a job: read the drawing (if a key is configured)
 * for the spec, then predict the BOM from that spec via the retrieval engine.
 * Plus captureSuggestionOutcome — the learning signal written on Save.
 *
 * Additive only: reads + a write to the job_field_suggestions LOG. Never touches
 * jobs / job_bom_* (the locked save flow).
 */
import { createClient } from "@/lib/supabase/server";
import { extractSpecFromPdf } from "@/lib/actions/spec-vision";
import { predictBomFromSpec, type BomTargetSpec } from "@/lib/actions/bom-predict";
import { normaliseDoorType } from "@/lib/bom/predict-core";
import type {
  AutofillResult,
  SpecSuggestion,
  AppliedSuggestion,
} from "@/components/jobs/autofill-types";

const ENGINE_VERSION = "autofill_v1";

export type AutofillActionResult =
  | { ok: true; data: AutofillResult }
  | { ok: false; error: string };

/**
 * @param typedSpec the spec already entered in the form (used as the fallback /
 *   merge base when the drawing can't be read).
 */
export async function autofillFromDrawing(
  jobId: string,
  typedSpec: BomTargetSpec,
): Promise<AutofillActionResult> {
  // Whole-body guard: an unexpected throw here would otherwise reject the server
  // action, and the form's transition has no catch — so it would surface as the
  // route-level error boundary ("Something went wrong"). Returning the message
  // (not throwing) keeps it readable in prod (Next.js strips thrown messages).
  try {
    let spec: SpecSuggestion | null = null;
    let drawingRead = false;
    let drawingNote: string | null = null;

    const vision = await extractSpecFromPdf(jobId);
    if (vision.ok) {
      drawingRead = true;
      const s = vision.spec;
      spec = {
        floors: s.floors,
        drive_type: s.drive_type,
        capacity: s.capacity,
        door_finish: s.door_finish,
        brand: s.brand,
      };
    } else if (vision.reason !== "not_configured") {
      // The drawing couldn't be read (e.g. it took too long and was bounded out).
      // Not fatal — we still predict the BOM from the typed spec; surface why.
      drawingNote = vision.error;
    }

    // Build the retrieval target: drawing values where read, else the typed spec.
    // door_type (normalised to a code) is the door-system SKU driver — it's read
    // from the drawing here and fed to the BOM engine even though it's not a form
    // field. The vision spec carries it; the form's typedSpec never sets it.
    const drawingDoorType = vision.ok ? normaliseDoorType(vision.spec.door_type.value) : null;
    const target: BomTargetSpec = {
      floors: (spec?.floors.value as number | null) ?? typedSpec.floors ?? null,
      drive_type: (spec?.drive_type.value as string | null) ?? typedSpec.drive_type ?? null,
      capacity: (spec?.capacity.value as string | null) ?? typedSpec.capacity ?? null,
      door_finish: (spec?.door_finish.value as string | null) ?? typedSpec.door_finish ?? null,
      brand: (spec?.brand.value as string | null) ?? typedSpec.brand ?? null,
      door_type: drawingDoorType ?? typedSpec.door_type ?? null,
      // Door opening width drives the door-system SKU size; from the drawing read.
      door_opening_width: (vision.ok ? vision.spec.door_opening_width_mm : null) ?? typedSpec.door_opening_width ?? null,
      // Visual door attributes read off the page-1 spec table / door elevation —
      // vision glass (LV/MV/NV) and hinge side (LHS/RHS) drive the door-panel +
      // door-post SKU. The composer reads these; nothing populated them before.
      door_vision: (vision.ok ? (vision.spec.door_vision.value as string | null) : null) ?? typedSpec.door_vision ?? null,
      landing_door_vision: (vision.ok ? (vision.spec.door_vision.value as string | null) : null) ?? typedSpec.landing_door_vision ?? null,
      door_side: (vision.ok ? (vision.spec.door_side.value as string | null) : null) ?? typedSpec.door_side ?? null,
    };

    const pred = await predictBomFromSpec(target, jobId);
    if (!pred.ok) {
      // If the drawing was read but the BOM couldn't be predicted, still return the spec.
      if (spec) {
        return {
          ok: true,
          data: {
            drawingRead,
            specSource: "drawing",
            spec,
            bom: [],
            neighbours: [],
            warnings: [pred.error],
            overallConfidence: 0,
          },
        };
      }
      return { ok: false, error: pred.error };
    }

    return {
      ok: true,
      data: {
        drawingRead,
        specSource: spec ? "drawing" : target.drive_type || target.floors != null || target.capacity ? "typed" : "none",
        spec,
        bom: pred.prediction.draft.map((l) => ({
          section: l.section,
          phase: l.phase,
          item_id: l.item_id,
          item_code: l.item_code,
          item_name: l.item_name,
          uom: l.uom,
          suggestedQty: l.suggestedQty,
          confidence: l.confidence,
          confidenceBand: l.confidenceBand,
          supportingJobs: l.supportingJobs,
        })),
        neighbours: pred.prediction.neighbours.map((n) => ({ job_number: n.job_number, sim: n.sim })),
        warnings: drawingNote ? [drawingNote, ...pred.prediction.warnings] : pred.prediction.warnings,
        overallConfidence: pred.prediction.overallConfidence,
      },
    };
  } catch (e) {
    console.error("autofillFromDrawing failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Auto-fill failed unexpectedly." };
  }
}

/**
 * Record how the AI's applied suggestions fared against what was actually saved
 * — the learning signal. Fire-and-forget from the form's Save success path; a
 * failure here must never affect the save. `finalSpec`/`finalLines` are the
 * values the engineer actually persisted.
 */
export async function captureSuggestionOutcome(
  jobId: string,
  drawingUrl: string | null,
  applied: AppliedSuggestion[],
  finalSpec: Record<string, string | number | null>,
  finalLines: { category: string; item_id: string | null; required_quantity: number }[],
): Promise<{ ok: boolean }> {
  if (!jobId || applied.length === 0) return { ok: true };
  try {
    const supabase = await createClient();
    const now = new Date().toISOString();

    // Index final BOM by section -> set of item_ids + qty per item.
    const finalBySection = new Map<string, Map<string, number>>();
    for (const l of finalLines) {
      if (!l.item_id) continue;
      const m = finalBySection.get(l.category) ?? new Map<string, number>();
      m.set(l.item_id, (m.get(l.item_id) ?? 0) + Number(l.required_quantity || 0));
      finalBySection.set(l.category, m);
    }

    const rows = applied.map((a) => {
      let finalValue: string | null = null;
      let finalQty: number | null = null;
      let outcome: "accepted" | "edited" | "rejected" | "added_manually" = "rejected";

      if (a.kind === "spec") {
        const fv = finalSpec[a.field];
        finalValue = fv == null ? null : String(fv);
        if (finalValue && a.suggested_value && finalValue === String(a.suggested_value)) outcome = "accepted";
        else if (finalValue) outcome = "edited";
        else outcome = "rejected";
      } else {
        const m = finalBySection.get(a.field);
        if (m && a.suggested_value && m.has(a.suggested_value)) {
          finalQty = m.get(a.suggested_value)!;
          finalValue = a.suggested_value;
          outcome =
            a.suggested_qty != null && Math.abs(finalQty - a.suggested_qty) / Math.max(a.suggested_qty, 1) <= 0.1
              ? "accepted"
              : "edited";
        } else {
          outcome = "rejected";
        }
      }

      return {
        job_id: jobId,
        drawing_url: drawingUrl,
        engine_version: ENGINE_VERSION,
        kind: a.kind,
        field: a.field,
        suggested_value: a.suggested_value,
        suggested_qty: a.suggested_qty,
        confidence: a.confidence,
        provenance: a.provenance,
        applied: true,
        final_value: finalValue,
        final_qty: finalQty,
        outcome,
        audited_at: now,
      };
    });

    await supabase.from("job_field_suggestions").insert(rows);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
