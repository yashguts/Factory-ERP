"use server";

/**
 * PDF -> elevator spec via Claude vision. This is the ONLY key-dependent piece.
 * Reads ANTHROPIC_API_KEY from the server env; when absent it returns a graceful
 * {ok:false} ("not configured") and never throws — so the whole feature works
 * from the typed spec until the owner adds a key, then this lights up.
 *
 * Additive: only READS the job's public GAD PDF and RETURNS a draft spec. It
 * never writes to the job. Uses raw fetch (no SDK dependency to break the build).
 */
import { createCacheClient } from "@/lib/supabase/cache-client";

export type FieldConfidence = "high" | "medium" | "low";
export interface SpecField<T> {
  value: T | null;
  confidence: FieldConfidence;
  rationale: string;
}
export interface ExtractedSpec {
  floors: SpecField<number>;
  drive_type: SpecField<string>; // MRL|BELT|HOME|MR|HYD|CANTI
  capacity: SpecField<string>; // "4PASS" | "1000KG"
  door_finish: SpecField<string>;
  brand: SpecField<string>;
  notes: string;
}
export type ExtractSpecResult =
  | { ok: true; spec: ExtractedSpec }
  | { ok: false; error: string; reason?: "not_configured" };

const MODEL = "claude-opus-4-8";

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

const SPEC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    floors: CONF("integer"),
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
    capacity: CONF("string"),
    door_finish: CONF("string"),
    brand: CONF("string"),
    notes: { type: "string" },
  },
  required: ["floors", "drive_type", "capacity", "door_finish", "brand", "notes"],
};

const SYSTEM_PROMPT = `You are an expert elevator engineer reading General Arrangement (GA) drawings for passenger and goods elevators made in India, and extracting the machine-readable specification. Read every view, the title block, the dimension table and notes. Return the spec ONLY by calling report_elevator_spec exactly once.

Rules:
- drive_type — normalise to exactly one of MRL, BELT, HOME, MR, HYD, CANTI. Map synonyms: "Machine Room Less"/"roomless"/"gearless MRL" -> MRL; "Belt"/"belt drive" -> BELT; "Home lift"/"villa"/"domestic" -> HOME; "Machine Room"/"geared"/"traction MR" -> MR; "Hydraulic" -> HYD; "Cantilever" -> CANTI. If the drawing doesn't say, value null, confidence "low".
- floors — total stops served (integer). "G+N" = N+1, "B+G+N" = N+2. If only a travel dimension is given, null.
- capacity — copy the rated load AS LABELLED: persons -> "4PASS"/"6PASS"; kilograms -> "1000KG". Prefer persons for passenger lifts, KG for goods.
- door_finish — e.g. "SS Hairline", "SS Mirror", "MS Powder Coated", "Rose Gold", "Glass".
- brand — lift/controller make from the title block if printed.
- confidence — "high" (clearly printed), "medium" (inferred/partly legible), "low" (guessed or absent). Never invent a value; null + low is correct when the drawing is silent.
- rationale — one short phrase per field saying where you read it ("title block", "plan view", "not shown").`;

const USER_PROMPT =
  'This is the GA drawing for one elevator job. Read it and call report_elevator_spec with floors, drive_type (MRL/BELT/HOME/MR/HYD/CANTI), capacity, door_finish and brand — each with a per-field confidence and a one-line rationale. Null + low for anything not on the drawing.';

export async function extractSpecFromPdf(jobId: string): Promise<ExtractSpecResult> {
  if (!jobId) return { ok: false, error: "Missing jobId" };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "AI drawing-reading not configured", reason: "not_configured" };

  const supabase = createCacheClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("gad_drawing_url")
    .eq("id", jobId)
    .single();
  if (error || !job) return { ok: false, error: "Job not found." };
  const url = (job.gad_drawing_url as string | null) ?? null;
  if (!url) return { ok: false, error: "This job has no drawing to read." };

  try {
    // Download + base64 the PDF (robust for public AND future-private buckets).
    const pdfRes = await fetch(url);
    if (!pdfRes.ok) return { ok: false, error: "Could not load the drawing file." };
    const b64 = Buffer.from(await pdfRes.arrayBuffer()).toString("base64");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tool_choice: { type: "tool", name: "report_elevator_spec" },
        tools: [
          {
            name: "report_elevator_spec",
            description: "Report the elevator specification read from the GA drawing.",
            input_schema: SPEC_SCHEMA,
          },
        ],
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
    });

    if (!resp.ok) {
      const status = resp.status;
      if (status === 429) return { ok: false, error: "AI is busy — try again in a moment." };
      if (status === 401) return { ok: false, error: "AI key rejected — check the Anthropic API key." };
      return { ok: false, error: `AI drawing-reading failed (${status}).` };
    }
    const data = (await resp.json()) as {
      content?: Array<{ type: string; input?: unknown }>;
      stop_reason?: string;
    };
    const tool = data.content?.find((b) => b.type === "tool_use");
    if (!tool?.input) {
      return {
        ok: false,
        error:
          data.stop_reason === "refusal"
            ? "The model declined to read this drawing."
            : "Could not extract a spec from this drawing.",
      };
    }
    const spec = tool.input as ExtractedSpec;
    // Range-guard floors (schema can't express numeric bounds).
    if (
      spec.floors?.value != null &&
      (!Number.isInteger(spec.floors.value) || spec.floors.value < 1 || spec.floors.value > 60)
    ) {
      spec.floors = { value: null, confidence: "low", rationale: "Out-of-range floor count — verify manually." };
    }
    return { ok: true, spec };
  } catch {
    return { ok: false, error: "AI drawing-reading failed unexpectedly." };
  }
}
