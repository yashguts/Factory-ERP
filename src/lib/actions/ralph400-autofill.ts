"use server";

/**
 * RALPH 400 input auto-fill: job record + GA drawing → the calculator's inputs.
 *
 * Two tiers, one entry point (getRalph400Autofill):
 *   1. FREE tier (allowVision=false) — job record (floors) + the latest stored
 *      drawing extraction (ralph400_v1 if present, else the rich_v* corpus).
 *      Instant, no API key, runs on job select.
 *   2. VISION tier (allowVision=true) — a RALPH-400-focused Claude read of the
 *      job's GA drawing: structure external W×D, pit, overhead, per-floor
 *      floor-to-floor heights (the one thing the rich corpus lacks),
 *      counterweight side as BACK/LEFT/RIGHT, door type/opening/hand.
 *      Stored in job_drawing_extractions (schema ralph400_v1) so the second
 *      click is instant and the corpus keeps growing.
 *
 * Values are SUGGESTIONS: everything lands in editable inputs and the user
 * remains the authority — same philosophy as the job autofill (spec-vision.ts).
 */
import { createCacheClient } from "@/lib/supabase/cache-client";
import { createClient } from "@/lib/supabase/server";
import type { Ralph400Inputs } from "@/lib/ralph400/model";

const MODEL = "claude-opus-4-8";
const SCHEMA_VERSION = "ralph400_v1";
// Same bound + rationale as spec-vision.ts: stay under the serverless cap.
const VISION_TIMEOUT_MS = 22_000;

type Conf = "high" | "medium" | "low";
interface F<T> {
  value: T | null;
  confidence: Conf;
  rationale: string;
}

/** What the focused vision read reports (stored verbatim in `extracted`). */
interface RalphDrawing {
  stops: F<number>;
  /** Floor-to-floor rises bottom-up, mm: [bottom→1st, 1st→2nd, ...]. */
  floor_to_floor_mm: { mm: number; confidence: Conf; label: string }[];
  pit_mm: F<number>;
  overhead_mm: F<number>;
  structure_width_mm: F<number>;
  structure_depth_mm: F<number>;
  cwt_side: F<"BACK" | "LEFT" | "RIGHT">;
  door_type: F<"AT" | "ACO" | "SWING" | "MCD">;
  door_opening_width_mm: F<number>;
  door_hand: F<"L" | "R">;
  notes: string;
}

export type Ralph400AutofillResult =
  | {
      ok: true;
      /** Only the fields that could be filled — merge over the current inputs. */
      values: Partial<Ralph400Inputs>;
      /** Where each filled field came from, for the summary line. */
      sources: Record<string, "drawing" | "stored-drawing" | "job">;
      warnings: string[];
      usedVision: boolean;
    }
  | { ok: false; error: string };

const CONF = (vt: "integer" | "string", enumVals?: (string | null)[]) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    value: enumVals ? { type: [vt, "null"], enum: [...enumVals, null] } : { type: [vt, "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    rationale: { type: "string" },
  },
  required: ["value", "confidence", "rationale"],
});

const TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    stops: CONF("integer"),
    floor_to_floor_mm: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          mm: { type: "integer" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          label: { type: "string" },
        },
        required: ["mm", "confidence", "label"],
      },
    },
    pit_mm: CONF("integer"),
    overhead_mm: CONF("integer"),
    structure_width_mm: CONF("integer"),
    structure_depth_mm: CONF("integer"),
    cwt_side: CONF("string", ["BACK", "LEFT", "RIGHT"]),
    door_type: CONF("string", ["AT", "ACO", "SWING", "MCD"]),
    door_opening_width_mm: CONF("integer"),
    door_hand: CONF("string", ["L", "R"]),
    notes: { type: "string" },
  },
  required: [
    "stops", "floor_to_floor_mm", "pit_mm", "overhead_mm", "structure_width_mm",
    "structure_depth_mm", "cwt_side", "door_type", "door_opening_width_mm",
    "door_hand", "notes",
  ],
};

const SYSTEM_PROMPT = `You are an expert elevator engineer reading the General Arrangement (GA) drawing of a small Indian passenger lift that ships with a FACTORY-MADE STEEL SHAFT STRUCTURE (glass/sheet-clad modular shaft). Extract exactly the inputs the structure's cut-list calculator needs. Read every view (hoistway plan, vertical section, floor-height table, spec table, notes). Report ONLY by calling report_ralph_inputs exactly once. Never invent a number: a value not on the drawing is null with confidence "low".

Fields:
- stops -> total number of stops the lift serves ("G+N" = N+1, "B+G+N" = N+2).
- floor_to_floor_mm -> the floor-to-floor rises BOTTOM-UP in mm, one entry per rise (stops-1 entries): bottom/ground -> 1st, 1st -> 2nd, ... Read them from the vertical section / floor-height table; label each with the drawing's own floor names. These are finished-floor to finished-floor heights, typically 2600-4000mm.
- pit_mm -> pit depth below the lowest served floor level, mm (for these structures typically 150-600, sometimes up to 1600).
- overhead_mm -> the overhead/headroom above the top served floor level, mm (typically 2600-4800).
- structure_width_mm / structure_depth_mm -> the OUTER footprint of the shaft structure: external width (across the entrance face) x external depth (front-to-back), in mm. This is the shaft/structure size, NOT the car inside size and NOT the door opening. If the drawing labels the shaft dimension as "inside"/"clear", still report the labelled number but say so in the rationale and use confidence "medium".
- cwt_side -> where the counterweight sits relative to the car ON THE HOISTWAY PLAN, viewed with the entrance/door at the FRONT: behind the car -> BACK; on the car's left -> LEFT; on the car's right -> RIGHT. Null if no counterweight is shown (e.g. hydraulic).
- door_type -> the LANDING door operator, one of: AT (automatic telescopic / side opening), ACO (automatic centre opening), SWING (hinged swing door), MCD (manual collapsible / gate). Anything else -> null.
- door_opening_width_mm -> the clear door opening width in mm.
- door_hand -> for a telescopic (side-opening) door, which side the panels stack, from the hoistway plan door split: the opening is dimensioned as two UNEQUAL sub-segments; the larger sub-segment's side IS the hand — larger on the LEFT -> "L", larger on the RIGHT -> "R" (read directly in plan orientation, do not flip). Equal split or non-telescopic door -> null.
- notes -> anything that affects the structure (existing pit, site constraints, glass vs sheet sides, etc.).`;

const USER_PROMPT =
  "This is the GA drawing of one elevator job with a factory-made shaft structure. Read it completely and call report_ralph_inputs with the structure calculator's inputs, each with confidence and a one-line rationale of where you read it.";

async function callVision(b64: string, apiKey: string): Promise<RalphDrawing | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tool_choice: { type: "tool", name: "report_ralph_inputs" },
        tools: [{ name: "report_ralph_inputs", description: "Report the RALPH 400 structure calculator inputs.", input_schema: TOOL_SCHEMA }],
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
              { type: "text", text: USER_PROMPT },
            ],
          },
        ],
      }),
      signal: ctrl.signal,
    });
  } catch {
    return {
      error: ctrl.signal.aborted
        ? "Reading the drawing took too long — try again (the second attempt is usually faster)."
        : "Couldn't reach the drawing-reading service.",
    };
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    // Surface the API's own message (credit balance, key errors) — the
    // run-sheet reader learned this the hard way.
    let detail = "";
    try {
      const body = (await resp.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? "";
    } catch {
      /* keep the status-only message */
    }
    if (resp.status === 429) return { error: "AI is busy — try again in a moment." };
    return { error: `AI drawing-reading failed (${resp.status}${detail ? `: ${detail}` : ""}).` };
  }
  const data = (await resp.json()) as { content?: Array<{ type: string; input?: unknown }>; stop_reason?: string };
  const tool = data.content?.find((b) => b.type === "tool_use");
  if (!tool?.input)
    return { error: data.stop_reason === "refusal" ? "The model declined to read this drawing." : "Could not read the drawing." };
  return tool.input as RalphDrawing;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/**
 * Compose a doorOpening matching the form's option list exactly (post-R1
 * formats, see OPTIONS in lib/ralph400/model.ts): AT -> "AT 700 R",
 * centre opening -> "700 CO", swing -> "700L SW". Anything else -> null
 * (the user picks manually rather than us guessing a non-option value).
 */
function composeOpening(doorType: string | null, w: number | null, hand: "L" | "R" | null): string | null {
  if (w === null || ![600, 700, 800].includes(w)) return null;
  if (doorType === "ACO") return `${w} CO`;
  if (doorType === "SWING") return `${w}L SW`;
  if (doorType === "AT" && hand) return `AT ${w} ${hand}`;
  return null;
}

const FLOOR_KEYS = ["h1", "h2", "h3", "h4", "h5"] as const;

/** Map a stored/fresh RalphDrawing onto calculator inputs. */
function applyRalph(
  d: RalphDrawing,
  values: Partial<Ralph400Inputs>,
  sources: Record<string, "drawing" | "stored-drawing" | "job">,
  src: "drawing" | "stored-drawing",
  warnings: string[],
) {
  const put = (k: keyof Ralph400Inputs, v: number | string | null | undefined) => {
    if (v === null || v === undefined || v === "" || k in values) return;
    (values as Record<string, unknown>)[k] = v;
    sources[k] = src;
  };
  put("floors", d.stops?.value ?? null);
  put("pitHeight", num(d.pit_mm?.value));
  put("overHead", num(d.overhead_mm?.value));
  put("shaftWidth", num(d.structure_width_mm?.value));
  put("shaftDepth", num(d.structure_depth_mm?.value));
  put("cwt", d.cwt_side?.value ?? null);
  put("doorType", d.door_type?.value ?? null);

  const rises = (d.floor_to_floor_mm ?? []).map((r) => num(r.mm)).filter((n): n is number => n !== null);
  rises.slice(0, 5).forEach((mm, i) => put(FLOOR_KEYS[i], mm));
  const stops = d.stops?.value ?? null;
  if (stops !== null && rises.length !== Math.max(0, stops - 1))
    warnings.push(`Drawing shows ${rises.length} floor height(s) for ${stops} stops — check the floor fields.`);

  const w = num(d.door_opening_width_mm?.value);
  const hand = d.door_hand?.value ?? null;
  const dt = d.door_type?.value ?? null;
  const opening = composeOpening(dt, w, hand);
  if (opening) put("doorOpening", opening);
  else if (w !== null && ![600, 700, 800].includes(w))
    warnings.push(`Door opening on the drawing is ${w}mm — not one of the calculator's 600/700/800 options.`);
  else if (w !== null && dt === "AT" && !hand)
    warnings.push(`Door opening is ${w}mm but the hand (L/R) isn't readable — pick it manually.`);

  if ((d.structure_width_mm?.rationale ?? "").toLowerCase().includes("inside") || (d.structure_width_mm?.confidence ?? "high") === "low")
    warnings.push("Shaft size may be labelled as inside/clear on the drawing — verify W × D against the structure outer size.");
}

/** Map the general rich_v* extraction (spec-vision corpus) onto inputs — best effort. */
function applyRich(
  rich: Record<string, unknown>,
  values: Partial<Ralph400Inputs>,
  sources: Record<string, "drawing" | "stored-drawing" | "job">,
  warnings: string[],
) {
  const put = (k: keyof Ralph400Inputs, v: number | string | null) => {
    if (v === null || v === "" || k in values) return;
    (values as Record<string, unknown>)[k] = v;
    sources[k] = "stored-drawing";
  };
  const dims = (rich.dimensions ?? {}) as Record<string, { value?: unknown } | undefined>;
  const dim = (k: string) => num(dims[k]?.value ?? null);
  const fieldVal = (k: string): string | null => {
    const f = rich[k] as { value?: unknown } | undefined;
    return typeof f?.value === "string" ? f.value : null;
  };
  const fl = rich.floors as { value?: unknown } | undefined;
  put("floors", typeof fl?.value === "number" ? fl.value : null);
  put("shaftWidth", dim("shaft_width_mm"));
  put("shaftDepth", dim("shaft_depth_mm"));
  put("pitHeight", dim("pit_depth_mm"));
  put("overHead", dim("overhead_mm"));

  const dtRaw = (fieldVal("door_type") ?? "").toUpperCase();
  let dt: string | null = null;
  if (dtRaw.includes("(CO)") || dtRaw.includes("CENTRE")) dt = "ACO";
  else if (dtRaw.includes("(AT)") || dtRaw.includes("TELESCOPIC")) dt = "AT";
  else if (dtRaw.includes("SWING") || dtRaw.includes("SWS")) dt = "SWING";
  else if (dtRaw.includes("COLLAPSIBLE") || dtRaw.includes("(COL)")) dt = "MCD";
  if (dt) put("doorType", dt);

  const w = dim("door_opening_width_mm");
  const side = (fieldVal("door_side") ?? "").toUpperCase();
  const hand = side === "LHS" ? "L" : side === "RHS" ? "R" : null;
  const opening = composeOpening(dt, w, hand);
  if (opening) put("doorOpening", opening);

  const cwt = (fieldVal("counterweight_position") ?? "").toLowerCase();
  if (cwt.includes("rear") || cwt.includes("back")) put("cwt", "BACK");
  // "side" alone is ambiguous (left vs right) — the vision tier resolves it.

  if (!("h1" in values)) warnings.push("Floor-to-floor heights aren't in the stored scan — use Read drawing (AI) or fill them manually.");
}

/**
 * The entry point. jobNumber comes from the page's dropdown (Factory-made jobs).
 * allowVision=false → instant free tier only; true → fall through to a focused
 * Claude read of the GA drawing when the stored data doesn't already cover it.
 */
export async function getRalph400Autofill(
  jobNumber: string,
  allowVision: boolean,
): Promise<Ralph400AutofillResult> {
  if (!jobNumber?.trim()) return { ok: false, error: "Pick a job first." };
  const supabase = createCacheClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, floors, gad_drawing_url, gad_drawing_filename")
    .eq("job_number", jobNumber.trim())
    .maybeSingle();
  if (error || !job) return { ok: false, error: "Job not found." };

  const values: Partial<Ralph400Inputs> = {};
  const sources: Record<string, "drawing" | "stored-drawing" | "job"> = {};
  const warnings: string[] = [];
  const url = (job.gad_drawing_url as string | null) ?? null;

  // ---- stored RALPH-focused read of the CURRENT drawing (instant, complete) ----
  let haveRalphRead = false;
  if (url) {
    const { data: cached } = await supabase
      .from("job_drawing_extractions")
      .select("extracted")
      .eq("job_id", job.id)
      .eq("drawing_url", url)
      .eq("schema_version", SCHEMA_VERSION)
      .order("extracted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached?.extracted) {
      applyRalph(cached.extracted as RalphDrawing, values, sources, "stored-drawing", warnings);
      haveRalphRead = true;
    }
  }

  // ---- fresh vision read (only when asked, needed, and possible) ----
  let usedVision = false;
  if (!haveRalphRead && allowVision) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!url) warnings.push("This job has no GA drawing uploaded — filled from the job record only.");
    else if (!apiKey) warnings.push("AI drawing-reading is not configured — filled from stored data only.");
    else {
      try {
        const pdfRes = await fetch(url);
        if (!pdfRes.ok) return { ok: false, error: "Could not load the drawing file." };
        const b64 = Buffer.from(await pdfRes.arrayBuffer()).toString("base64");
        const read = await callVision(b64, apiKey);
        if ("error" in read) return { ok: false, error: read.error };
        applyRalph(read, values, sources, "drawing", warnings);
        usedVision = true;
        // Store for next time (best-effort, same corpus table as spec-vision).
        try {
          const writer = await createClient();
          await writer.from("job_drawing_extractions").insert({
            job_id: job.id,
            drawing_url: url,
            drawing_filename: (job.gad_drawing_filename as string | null) ?? null,
            extracted: read,
            spec: {},
            model: MODEL,
            schema_version: SCHEMA_VERSION,
            discrepancies: [],
          });
        } catch {
          /* logging is best-effort */
        }
      } catch {
        return { ok: false, error: "AI drawing-reading failed unexpectedly." };
      }
    }
  }

  // ---- the general rich_v* corpus (fills remaining gaps, no floor heights) ----
  if (url) {
    const { data: rich } = await supabase
      .from("job_drawing_extractions")
      .select("extracted, schema_version")
      .eq("job_id", job.id)
      .like("schema_version", "rich_%")
      .order("extracted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rich?.extracted) applyRich(rich.extracted as Record<string, unknown>, values, sources, warnings);
  }

  // ---- job record last (never overrides a drawing value) ----
  if (!("floors" in values) && typeof job.floors === "number" && job.floors > 0) {
    values.floors = job.floors;
    sources.floors = "job";
  }

  if (Object.keys(values).length === 0)
    return {
      ok: false,
      error: allowVision
        ? "Nothing could be read for this job."
        : "No stored data for this job yet — use Read drawing (AI).",
    };
  return { ok: true, values, sources, warnings, usedVision };
}
