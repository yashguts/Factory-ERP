"use server";

/**
 * Read an attached Purchase Order copy (PDF / image) and extract the HEADER
 * fields, so the Add-PO form's "Order details" can auto-fill. Mirrors the
 * proven elevator-drawing extractor ({@link ./spec-vision.ts}): reads
 * ANTHROPIC_API_KEY, raw fetch to the Anthropic Messages API, a forced
 * `report_po` tool, a hard timeout, and a graceful {ok:false} on any failure
 * (never throws). Read-only — extraction writes nothing; the form fills
 * client-side for the user to review before "Create PO".
 */

const MODEL = "claude-sonnet-4-6"; // fast + accurate enough for a few header fields
const VISION_TIMEOUT_MS = 20_000;

export interface PoHeader {
  po_number: string | null;
  supplier_name: string | null;
  order_date: string | null; // ISO yyyy-mm-dd
  expected_date: string | null; // ISO yyyy-mm-dd
  note: string | null;
}

export type ExtractPoResult =
  | { ok: true; header: PoHeader }
  | { ok: false; error: string; reason?: "not_configured" };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    po_number: { type: ["string", "null"] },
    supplier_name: { type: ["string", "null"] },
    order_date: { type: ["string", "null"] },
    expected_date: { type: ["string", "null"] },
    note: { type: ["string", "null"] },
  },
  required: ["po_number", "supplier_name", "order_date", "expected_date", "note"],
};

const SYSTEM_PROMPT = `You are reading a purchase order document (an Indian supplier/vendor PO, as a PDF or a photo). Extract ONLY the header fields and return them by calling report_po exactly once.

Fields:
- po_number: the PO / order number exactly as printed (the buyer's order reference).
- supplier_name: the supplier / vendor / seller the order is placed ON — NOT the buyer's own company that issued the PO.
- order_date: the PO / order date, normalised to ISO yyyy-mm-dd.
- expected_date: the expected / required / delivery / due date, normalised to ISO yyyy-mm-dd.
- note: a short note such as payment or delivery terms, or a one-line remark, only if clearly present.

Rules: use null for any field that is not clearly present — never invent or guess. Dates MUST be ISO yyyy-mm-dd (Indian POs are usually day-first dd/mm/yyyy — interpret accordingly). Keep note under ~120 characters.`;

const USER_PROMPT =
  "This is a purchase order copy. Read its header and call report_po with the PO number, supplier name, order date, expected date, and a short note (null where absent).";

const PDF_MEDIA = "application/pdf";
const IMAGE_MEDIA = new Set(["image/png", "image/jpeg", "image/webp"]);

function normMedia(mediaType: string): string {
  return mediaType === "image/jpg" ? "image/jpeg" : mediaType;
}

function contentBlock(data: string, mediaType: string): Record<string, unknown> {
  if (mediaType === PDF_MEDIA) {
    return { type: "document", source: { type: "base64", media_type: PDF_MEDIA, data } };
  }
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

export async function extractPoHeader(input: {
  data: string; // base64 (no data: prefix)
  mediaType: string;
  filename?: string;
}): Promise<ExtractPoResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "PO auto-read not configured", reason: "not_configured" };
  if (!input?.data) return { ok: false, error: "No document data." };

  const mediaType = normMedia(input.mediaType);
  if (mediaType !== PDF_MEDIA && !IMAGE_MEDIA.has(mediaType)) {
    return { ok: false, error: "Unsupported file type for auto-read." };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tool_choice: { type: "tool", name: "report_po" },
        tools: [{ name: "report_po", description: "Report the purchase-order header fields.", input_schema: SCHEMA }],
        messages: [
          {
            role: "user",
            content: [contentBlock(input.data, mediaType), { type: "text", text: USER_PROMPT }],
          },
        ],
      }),
      signal: ctrl.signal,
    });
  } catch {
    return {
      ok: false,
      error: ctrl.signal.aborted
        ? "Reading the PO took too long — fill the details manually."
        : "Couldn't reach the PO-reading service — fill the details manually.",
    };
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    if (resp.status === 429) return { ok: false, error: "AI is busy — try attaching again in a moment." };
    if (resp.status === 401) return { ok: false, error: "AI key rejected — check the Anthropic API key." };
    return { ok: false, error: `PO auto-read failed (${resp.status}).` };
  }

  const out = (await resp.json()) as { content?: Array<{ type: string; input?: unknown }>; stop_reason?: string };
  const tool = out.content?.find((b) => b.type === "tool_use");
  if (!tool?.input) {
    return {
      ok: false,
      error: out.stop_reason === "refusal" ? "The model declined to read this document." : "Couldn't read the PO details.",
    };
  }

  const raw = tool.input as Record<string, unknown>;
  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t ? t : null;
  };
  const iso = (v: unknown): string | null => {
    const s = str(v);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  return {
    ok: true,
    header: {
      po_number: str(raw.po_number),
      supplier_name: str(raw.supplier_name),
      order_date: iso(raw.order_date),
      expected_date: iso(raw.expected_date),
      note: str(raw.note),
    },
  };
}
