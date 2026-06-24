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
/** The fields the autofill form/engine consume. door_type is not a form field but
 *  is carried so the BOM engine can condition on it (the door-system SKU driver). */
export interface ExtractedSpec {
  floors: SpecField<number>;
  drive_type: SpecField<string>;
  capacity: SpecField<string>;
  door_type: SpecField<string>;
  door_finish: SpecField<string>;
  landing_door_finish: SpecField<string>;
  door_vision: SpecField<string>;
  door_side: SpecField<string>;
  brand: SpecField<string>;
  /** Door opening width in mm parsed from the drawing — the door SKU size driver. */
  door_opening_width_mm: number | null;
  /** Total travel / shaft height in mm — drives shaft-height consumable quantities. */
  travel_mm: number | null;
  /** Counterweight position (side/rear) — gates the combination main-bracket compose. */
  counterweight_position: string | null;
  /** Rail-to-wall gaps (mm) — the rail-bracket projection (car gap -> class, counter gap -> combo). */
  car_rail_to_wall_mm: number | null;
  counter_rail_to_wall_mm: number | null;
  notes: string;
}
/** The FULL read — everything we can pull off the drawing, for the deep corpus. */
export interface RichDrawing {
  drive_type: SpecField<string>;
  floors: SpecField<number>;
  capacity: SpecField<string>;
  door_type: SpecField<string>;
  door_finish: SpecField<string>;
  landing_door_finish: SpecField<string>;
  door_vision: SpecField<string>;
  door_side: SpecField<string>;
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
    car_rail_to_wall_mm: SpecField<string>; // car guide rail -> wall gap (sets the standard bracket projection class)
    counter_rail_to_wall_mm: SpecField<string>; // counterweight guide rail -> wall gap (sets the combination bracket projection)
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
        value: { type: ["string", "null"], enum: ["MR", "MRL", "HOME", "BELT", "MRLBELT", "HYD", "CANTI", "R1000", null] },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        rationale: { type: "string" },
      },
      required: ["value", "confidence", "rationale"],
    },
    floors: CONF("integer"),
    capacity: CONF("string"),
    door_type: CONF("string"),
    door_finish: CONF("string"),
    landing_door_finish: CONF("string"),
    door_vision: CONF("string"),
    door_side: CONF("string"),
    brand: CONF("string"),
    dimensions: {
      type: "object",
      additionalProperties: false,
      properties: {
        shaft_width_mm: DIM(), shaft_depth_mm: DIM(), car_width_mm: DIM(), car_depth_mm: DIM(),
        car_height_mm: DIM(), door_opening_width_mm: DIM(), door_opening_height_mm: DIM(),
        pit_depth_mm: DIM(), overhead_mm: DIM(), travel_mm: DIM(), speed_mps: DIM(),
        car_rail_to_wall_mm: DIM(), counter_rail_to_wall_mm: DIM(),
      },
      required: [
        "shaft_width_mm", "shaft_depth_mm", "car_width_mm", "car_depth_mm", "car_height_mm",
        "door_opening_width_mm", "door_opening_height_mm", "pit_depth_mm", "overhead_mm",
        "travel_mm", "speed_mps", "car_rail_to_wall_mm", "counter_rail_to_wall_mm",
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
    "drive_type", "floors", "capacity", "door_type", "door_finish", "landing_door_finish", "door_vision", "door_side", "brand",
    "dimensions", "machine_room", "counterweight_position", "additional_details", "notes",
  ],
};

const SYSTEM_PROMPT = `You are an expert elevator engineer reading General Arrangement (GA) drawings for passenger and goods elevators made in India, and extracting a COMPLETE machine-readable record. Read every view, the title block, the dimension/spec table, and all notes. Return everything ONLY by calling report_drawing exactly once.

Capture the core spec AND every other labelled value you can find (sizes, weights, speeds, counts, finishes, makes, clauses) — put anything that doesn't fit a named field into additional_details as {label, value}. Be exhaustive: this drawing's details are what makes the job different from past jobs.

Normalisation rules:
- drive_type -> exactly one of MR, MRL, HOME, BELT, MRLBELT, HYD, CANTI, R1000. Two axes: machine location (machine-room MR / machine-room-less MRL / home-pit) and suspension (rope vs belt). Map: "Machine Room Less"/"roomless"/"gearless MRL" (rope) -> MRL; "Machine Room"/"geared"/"traction MR" -> MR; "Home lift"/"villa"/"domestic" (rope) -> HOME; HOME lift driven by a BELT -> BELT; MRL driven by a BELT -> MRLBELT; "Hydraulic" -> HYD; "Cantilever" -> CANTI; car-parking / "R1000" / "R-1000" -> R1000. Decide belt-vs-rope from the suspension labelled on the drawing; if a home/MRL lift shows a belt, pick the BELT/MRLBELT variant. Unknown -> null/low.
- floors -> total stops (integer). "G+N"=N+1, "B+G+N"=N+2. Only a travel dimension and no stop count -> null.
- capacity -> as labelled: persons -> "4PASS"/"6PASS"; kilograms -> "1000KG". Prefer persons for passenger, KG for goods.
- door_type -> the door OPERATOR type; prefer one of and include the code: "Centre Opening (CO)", "Auto Telescopic (AT)", "Manual Telescopic (MT)", "Collapsible (COL)", "Auto Four-Fold (AFF)", "Swing (SWS)".
- door_finish -> the CAR door leaf material + designer finish, read from the CAR DOOR row of the page-1 specification table (e.g. "SS HAIRLINE FINISH AUTO TELESCOPIC DOOR..."). Material is "SS" or "MS"; KEEP any designer colour after it — it is the panel SKU's key discriminator. Examples: "SS Hairline", "SS Mirror", "MS Powder Coated", "SS Rose Gold", "Rose Gold Linen", "Rose Gold Mirror", "Golden", "Champagne", "Titanium"/"TI Black", "Silver Mirror", "Black Mirror", "Glass".
- landing_door_finish -> the LANDING door (L. DOOR) row finish, SAME format as door_finish. It can DIFFER from the car door (e.g. designer car door + plain SS landing) and it drives the door-frame / door-post / linton colour. If the L. DOOR row is not separately stated, copy door_finish.
- door_vision -> extent of vision glass on the door leaf, from the door-row text ("...WITH LONG VISION GLASS") or the door elevation: "LV" (long/full vision), "MV" (medium/half vision), "NV" (no vision/blind). null if not shown.
- door_side -> for a side-opening telescopic / swing door, the side the door OPENS TOWARD (the direction the leading door panel travels to fully open), viewed from the LANDING facing the car: "LHS" (opens to the left) or "RHS" (opens to the right). Read it from the asymmetric door layout: in a side-slide telescopic the panels PARK on the WIDER jamb side and the door opens toward the NARROWER jamb — e.g. an elevation showing "520 | 700 opening | 40" parks on the LEFT (520) and opens RIGHT, so it is RHS. Do NOT report the parking side. null for centre-opening (CO) doors or if the door is symmetric / not shown.
- dimensions -> the labelled value with units (mm). machine_room -> "yes"/"no". counterweight_position -> "rear"/"side" if shown.
- car_rail_to_wall_mm -> on the HOISTWAY PLAN (top view), the small clearance dimension from the BACK of a CAR guide rail to the adjacent shaft WALL face — i.e. how far the rail-bracket arm projects from the wall to the rail. It is the SMALL gap dimension (typically 50-400mm) right at the rail, NOT the big shaft/DBG dimensions. This sets the rail-bracket projection CLASS (50-100=B, 100-160=C, 160-210=D, 210-310=E, 310-360=F, 360-410=G). Read the typical/larger of the two car rails. null if not dimensioned.
- counter_rail_to_wall_mm -> same idea for a COUNTERWEIGHT guide rail -> wall gap (the counterweight is the hatched block at the side/rear of the plan, near a "D.B.G" label). This sets the COMBINATION bracket's projection (e.g. 180 in "DBG-850X50X180"). null if the counterweight rails aren't dimensioned.
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
      door_type: rich.door_type,
      door_finish: rich.door_finish,
      landing_door_finish: rich.landing_door_finish,
      door_vision: rich.door_vision,
      door_side: rich.door_side,
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

/**
 * Idempotent "read the drawing once and cache it." Skips the (slow, ~22s) vision
 * call if this job's CURRENT drawing has already been extracted. Fired on upload
 * so the Part List can be generated instantly later (and used as a catch-up).
 */
export async function ensureDrawingRead(jobId: string): Promise<{ ok: boolean; cached?: boolean; reason?: string }> {
  if (!jobId) return { ok: false, reason: "missing-job" };
  const supabase = createCacheClient();
  const { data: job } = await supabase.from("jobs").select("gad_drawing_url").eq("id", jobId).maybeSingle();
  if (!job?.gad_drawing_url) return { ok: false, reason: "no-drawing" };

  // Skip if this job already has a cached read. On re-upload the old extractions
  // are wiped first (resetPartListForNewDrawing), so "any extraction" is the right
  // signal — and avoids paying for a re-read of the ~113 already-read jobs.
  const { data: existing } = await supabase
    .from("job_drawing_extractions")
    .select("id")
    .eq("job_id", jobId)
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, cached: true };

  const r = await extractDrawingData(jobId);
  return { ok: r.ok, cached: false, reason: r.ok ? undefined : r.reason ?? "read-failed" };
}

/** Parse a door-opening-width dimension string ("1000", "1000 mm", "1.0m") to mm. */
function parseWidthMm(v: string | null | undefined): number | null {
  if (v == null) return null;
  const digits = String(v).replace(/[^0-9.]/g, "");
  if (!digits) return null;
  let n = parseFloat(digits);
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n < 10) n *= 1000; // metres → mm
  return n >= 300 && n <= 4000 ? Math.round(n) : null;
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
      door_type: rich.door_type,
      door_finish: rich.door_finish,
      landing_door_finish: rich.landing_door_finish,
      door_vision: rich.door_vision,
      door_side: rich.door_side,
      brand: rich.brand,
      door_opening_width_mm: parseWidthMm(rich.dimensions?.door_opening_width_mm?.value),
      travel_mm: parseWidthMm(rich.dimensions?.travel_mm?.value),
      counterweight_position: (rich.counterweight_position?.value as string | null) ?? null,
      car_rail_to_wall_mm: parseWidthMm(rich.dimensions?.car_rail_to_wall_mm?.value),
      counter_rail_to_wall_mm: parseWidthMm(rich.dimensions?.counter_rail_to_wall_mm?.value),
      notes: rich.notes ?? "",
    },
  };
}
