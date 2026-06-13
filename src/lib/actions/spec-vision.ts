"use server";

/**
 * PDF -> RICH elevator drawing extraction via Claude vision.
 *
 * Phase 1 of the deep-learning program: read the WHOLE drawing (not just the
 * 5 form fields) and STORE it per job (job_drawing_extractions), so we
 * accumulate the (drawing content -> human-verified job) corpus the deep study
 * will learn from. Piggybacks the existing autofill call — no extra cost.
 *
 * The ONLY key-dependent piece. Reads ANTHROPIC_API_KEY; absent -> graceful
 * {ok:false,'not configured'}, never throws. Additive: reads the public GAD
 * PDF + writes ONLY to the job_drawing_extractions log. Never touches the job.
 */
import { createCacheClient } from "@/lib/supabase/cache-client";
import { createClient } from "@/lib/supabase/server";

export type FieldConfidence = "high" | "medium" | "low";
export interface SpecField<T> {
  value: T | null;
  confidence: FieldConfidence;
  rationale: string;
}
/** The 5 fields the autofill form consumes (unchanged contract). */
export interface ExtractedSpec {
  floors: SpecField<number>;
  drive_type: SpecField<string>;
  capacity: SpecField<string>;
  door_finish: SpecField<string>;
  brand: SpecField<string>;
  notes: string;
}
/** The FULL read — everything we can pull off the drawing, for the deep corpus. */
export interface RichDrawing {
  drive_type: SpecField<string>;
  floors: SpecField<number>;
  capacity: SpecField<string>;
  door_type: SpecField<string>;
  door_finish: SpecField<string>;
  brand: SpecField<string>;
  dimensions: {
    shaft_width_mm: SpecField<string>;
    shaft_depth_mm: SpecField<string>;
    car_width_mm: SpecField<string>;
    car_depth_mm: SpecField<string>;
    car_height_mm: SpecField<string>;
    door_opening_width_mm: SpecField<string>;
    door_opening_height_mm: SpecField<string>;
    pit_depth_mm: SpecField<string>;
    overhead_mm: SpecField<string>;
    travel_mm: SpecField<string>;
    speed_mps: SpecField<string>;
  };
  machine_room: SpecField<string>;
  counterweight_position: SpecField<string>;
  /** Everything else labelled on the drawing — the open-ended nuance bucket. */
  additional_details: { label: string; value: string; confidence: FieldConfidence }[];
  notes: string;
}
export type ExtractSpecResult =
  | { ok: true; spec: ExtractedSpec }
  | { ok: false; error: string; reason?: "not_configured" };
export type RichResult =
  | { ok: true; rich: RichDrawing; discrepancies: Discrepancy[] }
  | { ok: false; error: string; reason?: "not_configured" };

export interface Discrepancy {
  field: string;
  drawing: string;
  entered: string;
  note: string;
}

const MODEL = "claude-opus-4-8";

// Reading a (often multi-sheet, "merged") GA PDF can run long, and the autofill
// runs inside a synchronous serverless function with a hard execution cap. If the
// vision call isn't bounded, a slow read lets the platform KILL the whole function
// before it can return — the client then sees Next.js's "An unexpected response was
// received from the server." We bound the call below that cap and fall back to the
// typed spec (the BOM still gets predicted), so the action always returns cleanly.
// Tunable: keep comfortably under the function timeout, leaving room for the BOM
// prediction that runs after.
const VISION_TIMEOUT_MS = 22_000;

const CONF = (vt: "string" | "integer") => ({
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: [vt, "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    rationale: { type: "string" },
  },
  required: ["value", "confidence", "rationale"],
});
const DIM = () => ({
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["value", "confidence"],
});

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    drive_type: {
      type: "object",
      additionalProperties: false,
      properties: {
        value: { type: ["string", "null"], enum: ["MRL", "BELT", "HOME", "MR", "HYD", "CANTI", null] },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        rationale: { type: "string" },
      },
      required: ["value", "confidence", "rationale"],
    },
    floors: CONF("integer"),
    capacity: CONF("string"),
    door_type: CONF("string"),
    door_finish: CONF("string"),
    brand: CONF("string"),
    dimensions: {
      type: "object",
      additionalProperties: false,
      properties: {
        shaft_width_mm: DIM(), shaft_depth_mm: DIM(), car_width_mm: DIM(), car_depth_mm: DIM(),
        car_height_mm: DIM(), door_opening_width_mm: DIM(), door_opening_height_mm: DIM(),
        pit_depth_mm: DIM(), overhead_mm: DIM(), travel_mm: DIM(), speed_mps: DIM(),
      },
      required: [
        "shaft_width_mm", "shaft_depth_mm", "car_width_mm", "car_depth_mm", "car_height_mm",
        "door_opening_width_mm", "door_opening_height_mm", "pit_depth_mm", "overhead_mm",
        "travel_mm", "speed_mps",
      ],
    },
    machine_room: CONF("string"),
    counterweight_position: CONF("string"),
    additional_details: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["label", "value", "confidence"],
      },
    },
    notes: { type: "string" },
  },
  required: [
    "drive_type", "floors", "capacity", "door_type", "door_finish", "brand",
    "dimensions", "machine_room", "counterweight_position", "additional_details", "notes",
  ],
};

const SYSTEM_PROMPT = `You are an expert elevator engineer reading General Arrangement (GA) drawings for passenger and goods elevators made in India, and extracting a COMPLETE machine-readable record. Read every view, the title block, the dimension/spec table, and all notes. Return everything ONLY by calling report_drawing exactly once.

Capture the core spec AND every other labelled value you can find (sizes, weights, speeds, counts, finishes, makes, clauses) — put anything that doesn't fit a named field into additional_details as {label, value}. Be exhaustive: this drawing's details are what makes the job different from past jobs.

Normalisation rules:
- drive_type -> exactly one of MRL, BELT, HOME, MR, HYD, CANTI. Synonyms: "Machine Room Less"/"roomless"/"gearless MRL"->MRL; "Belt"->BELT; "Home lift"/"villa"/"domestic"->HOME; "Machine Room"/"geared"/"traction MR"->MR; "Hydraulic"->HYD; "Cantilever"->CANTI. Unknown -> null/low.
- floors -> total stops (integer). "G+N"=N+1, "B+G+N"=N+2. Only a travel dimension and no stop count -> null.
- capacity -> as labelled: persons -> "4PASS"/"6PASS"; kilograms -> "1000KG". Prefer persons for passenger, KG for goods.
- door_type -> e.g. "Centre Opening (CO)", "2-Panel Telescopic", "Collapsible", "Swing", "Auto". door_finish -> "SS Hairline", "SS Mirror", "MS Powder Coated", "Rose Gold", "Glass".
- dimensions -> the labelled value with units (mm). machine_room -> "yes"/"no". counterweight_position -> "rear"/"side" if shown.
- confidence -> "high" (clearly printed), "medium" (inferred), "low" (guessed/absent). Never invent; null+low when silent. rationale -> where on the drawing you read each core field.`;

const USER_PROMPT =
  "This is the GA drawing for one elevator job. Read it COMPLETELY and call report_drawing with the full spec, all dimensions, and every other labelled value in additional_details — each with a confidence and (for core fields) a one-line rationale of where you read it.";

async function callVision(b64: string, apiKey: string): Promise<RichDrawing | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tool_choice: { type: "tool", name: "report_drawing" },
        tools: [{ name: "report_drawing", description: "Report the complete elevator drawing record.", input_schema: SCHEMA }],
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
    // Aborted (too slow) or a network error — the caller falls back to the typed spec.
    return {
      error: ctrl.signal.aborted
        ? "Reading the drawing took too long, so the spec was filled from what you typed — re-run AI Auto-fill to try the drawing again."
        : "Couldn't reach the drawing-reading service — used the typed spec.",
    };
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    if (resp.status === 429) return { error: "AI is busy — try again in a moment." };
    if (resp.status === 401) return { error: "AI key rejected — check the Anthropic API key." };
    return { error: `AI drawing-reading failed (${resp.status}).` };
  }
  const data = (await resp.json()) as { content?: Array<{ type: string; input?: unknown }>; stop_reason?: string };
  const tool = data.content?.find((b) => b.type === "tool_use");
  if (!tool?.input)
    return { error: data.stop_reason === "refusal" ? "The model declined to read this drawing." : "Could not extract a spec." };
  const rich = tool.input as RichDrawing;
  if (rich.floors?.value != null && (!Number.isInteger(rich.floors.value) || rich.floors.value < 1 || rich.floors.value > 60))
    rich.floors = { value: null, confidence: "low", rationale: "Out-of-range floor count — verify." };
  return rich;
}

/** Rich extraction + store + discrepancy compute. The deep-corpus entry point. */
export async function extractDrawingData(jobId: string): Promise<RichResult> {
  if (!jobId) return { ok: false, error: "Missing jobId" };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "AI drawing-reading not configured", reason: "not_configured" };

  const supabase = createCacheClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("gad_drawing_url, gad_drawing_filename, floors, drive_type, capacity, door_finish, brand")
    .eq("id", jobId)
    .single();
  if (error || !job) return { ok: false, error: "Job not found." };
  const url = (job.gad_drawing_url as string | null) ?? null;
  if (!url) return { ok: false, error: "This job has no drawing to read." };

  try {
    const pdfRes = await fetch(url);
    if (!pdfRes.ok) return { ok: false, error: "Could not load the drawing file." };
    const b64 = Buffer.from(await pdfRes.arrayBuffer()).toString("base64");
    const result = await callVision(b64, apiKey);
    if ("error" in result) return { ok: false, error: result.error };
    const rich = result;

    // Discrepancies vs the job's entered spec (first "data disagrees" signal).
    const discrepancies: Discrepancy[] = [];
    const cmp = (field: string, drawingVal: string | number | null, enteredVal: string | number | null) => {
      if (drawingVal == null || enteredVal == null) return;
      if (String(drawingVal).trim() && String(drawingVal) !== String(enteredVal))
        discrepancies.push({ field, drawing: String(drawingVal), entered: String(enteredVal), note: "drawing differs from entered value" });
    };
    cmp("drive_type", rich.drive_type?.value, job.drive_type as string | null);
    cmp("floors", rich.floors?.value, job.floors as number | null);
    cmp("capacity", rich.capacity?.value, job.capacity as string | null);

    const spec = {
      floors: rich.floors,
      drive_type: rich.drive_type,
      capacity: rich.capacity,
      door_finish: rich.door_finish,
      brand: rich.brand,
    };

    // Store (best-effort — must never break the extraction the UI needs).
    try {
      const writer = await createClient();
      await writer.from("job_drawing_extractions").insert({
        job_id: jobId,
        drawing_url: url,
        drawing_filename: (job.gad_drawing_filename as string | null) ?? null,
        extracted: rich,
        spec,
        model: MODEL,
        schema_version: "rich_v1",
        discrepancies,
      });
    } catch {
      /* logging the read is best-effort; never block the user */
    }

    return { ok: true, rich, discrepancies };
  } catch {
    return { ok: false, error: "AI drawing-reading failed unexpectedly." };
  }
}

/** Backwards-compatible 5-field spec for the autofill form (now rich-backed + stored). */
export async function extractSpecFromPdf(jobId: string): Promise<ExtractSpecResult> {
  const r = await extractDrawingData(jobId);
  if (!r.ok) return r;
  const rich = r.rich;
  return {
    ok: true,
    spec: {
      floors: rich.floors,
      drive_type: rich.drive_type,
      capacity: rich.capacity,
      door_finish: rich.door_finish,
      brand: rich.brand,
      notes: rich.notes ?? "",
    },
  };
}
