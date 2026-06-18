"use server";

/* ------------------------------------------------------------------ *
 * Part List (packing list) reader — turns the dispatch team's uploaded
 * part list (PDF or photos) into a pre-filled dispatch draft.
 *
 * Flow (2 bounded Claude calls, graceful fallback so a slow read never
 * leaves the user stuck):
 *   1. VISION — read every physical line + quantity off the document and
 *      match each to one of the job's BOM items (by index) when it clearly
 *      is the same part; otherwise return a normalised search query.
 *   2. MATCH  — for the non-BOM lines, resolve each against the live
 *      inventory from server-side candidates (grounded; the model only
 *      picks from real ids, so it can't invent an item).
 * Anything still unmatched is returned for the user to add by hand.
 *
 * READ-ONLY: never writes anything. The dispatch modal applies the draft
 * locally; the user audits + confirms via the normal createDispatch.
 * Reuses the same ANTHROPIC_API_KEY + Messages API as the drawing autofill.
 * ------------------------------------------------------------------ */

import { createCacheClient } from "@/lib/supabase/cache-client";
import { searchItems } from "@/lib/actions/items";

// Extraction/matching from (mostly clean) text is latency-sensitive and runs
// inside the serverless function timeout — use the FAST model so long lists
// finish before the budget runs out (Opus was timing out on big lists).
const EXTRACT_MODEL = "claude-haiku-4-5-20251001";
const MATCH_MODEL = "claude-haiku-4-5-20251001";
// Whole-action wall-clock budget, comfortably under the platform function cap
// (~26s on this plan). Each AI call is sized from the REMAINING budget so a slow
// PDF parse or a long first call can never push us past the platform timeout
// (which would kill the function with a generic error instead of our message).
const BUDGET_MS = 24_000;
const MATCH_MAX_MS = 7_000;
const MATCH_MIN_MS = 4_000; // skip the match call if less than this remains

const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function flat<T>(rel: unknown): T | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return (rel[0] ?? null) as T | null;
  return rel as T;
}

export interface PartListFile {
  media_type: string;
  data: string; // base64, no "data:" prefix
}

export interface PartListBomFill {
  job_bom_line_id: string;
  item_id: string;
  code: string | null;
  name: string | null;
  uom: string | null;
  category: string | null;
  qty: number;
  raw_text: string;
}
export interface PartListExtra {
  item_id: string;
  code: string | null;
  name: string | null;
  uom: string | null;
  qty: number;
  raw_text: string;
  confidence: "high" | "medium" | "low";
}
export interface PartListUnmatched {
  raw_text: string;
  quantity: number | null;
}
export interface PartListDraft {
  bomFills: PartListBomFill[];
  extras: PartListExtra[];
  unmatched: PartListUnmatched[];
  stats: { total: number; bom: number; extra: number; unmatched: number };
}
export type PartListResult = { ok: true; draft: PartListDraft } | { ok: false; error: string };

interface Blk {
  type: string;
  input?: Record<string, unknown>;
}

/** Pull the embedded text layer out of a PDF (instant, no AI). Empty string for
 *  a scanned/image-only PDF (then we fall back to reading it as page-images). */
async function extractPdfText(b64: string): Promise<string> {
  try {
    const mod = (await import("pdf-parse")) as {
      PDFParse: new (o: { data: Buffer }) => { getText: () => Promise<{ text?: string }> };
    };
    const parser = new mod.PDFParse({ data: Buffer.from(b64, "base64") });
    const res = await parser.getText();
    return (res?.text ?? "").trim();
  } catch (e) {
    console.error("[part-list] pdf text extraction failed", e);
    return "";
  }
}

/** Build the model's user content. Text-layer PDFs become a cheap text block
 *  (fast, no page rendering); scanned PDFs and photos become image blocks read by
 *  vision. usedVision tells the caller which timeout budget to apply. */
async function buildContent(
  files: PartListFile[],
): Promise<{ blocks: unknown[]; usedVision: boolean; textLen: number }> {
  const blocks: unknown[] = [];
  let usedVision = false;
  let textLen = 0;
  let pdfIdx = 0;
  for (const f of files) {
    if (f.media_type === "application/pdf") {
      const text = await extractPdfText(f.data);
      // Enough real text => use it; a near-empty layer (page markers only) means
      // a scanned/image PDF, so fall back to reading it as page-images.
      if (text.length > 80) {
        pdfIdx++;
        textLen += text.length;
        blocks.push({ type: "text", text: `--- Part list (file ${pdfIdx}) ---\n${text.slice(0, 40_000)}` });
      } else {
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
        usedVision = true;
      }
    } else if (IMG_TYPES.has(f.media_type)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } });
      usedVision = true;
    }
  }
  return { blocks, usedVision, textLen };
}

async function callAnthropic(
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: true; data: { content?: Blk[] } } | { ok: false; error: string; aborted: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      if (resp.status === 429) return { ok: false, aborted: false, error: "AI is busy — try again in a moment." };
      if (resp.status === 401) return { ok: false, aborted: false, error: "AI key was rejected." };
      return { ok: false, aborted: false, error: `AI request failed (${resp.status}).` };
    }
    return { ok: true, data: (await resp.json()) as { content?: Blk[] } };
  } catch {
    return {
      ok: false,
      aborted: ctrl.signal.aborted,
      error: ctrl.signal.aborted ? "Reading the part list took too long." : "Couldn't reach the AI service — try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}

interface RawLine {
  raw_text: string;
  quantity: number | null;
  unit: string | null;
  bom_match: number | null;
  search_query: string | null;
}

export async function readPartList(input: {
  jobId: string;
  files: PartListFile[];
}): Promise<PartListResult> {
  const startedAt = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "Part-list reading isn't configured (missing API key)." };

  const files = (input.files ?? []).filter(
    (f) => f?.data && (f.media_type === "application/pdf" || IMG_TYPES.has(f.media_type)),
  );
  if (!files.length) return { ok: false, error: "Upload a PDF or images (JPG/PNG) of the part list." };

  const supabase = createCacheClient();

  // The job's BOM lines — candidates the vision step matches against by index.
  const { data: header } = await supabase
    .from("job_bom_headers")
    .select("id")
    .eq("job_id", input.jobId)
    .limit(1)
    .maybeSingle();

  interface BomRow {
    job_bom_line_id: string;
    item_id: string;
    code: string;
    name: string;
    uom: string | null;
    category: string | null;
  }
  const bom: BomRow[] = [];
  if (header) {
    const { data: bl } = await supabase
      .from("job_bom_lines")
      .select(
        `id, category, item_id,
         item:items!job_bom_lines_item_id_fkey(code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation))`,
      )
      .eq("job_bom_id", (header as Record<string, unknown>).id as string)
      .not("item_id", "is", null)
      .order("sort_order");
    for (const r of (bl ?? []) as Record<string, unknown>[]) {
      const it = flat<{ code: string; name: string; uom: unknown }>(r.item);
      const uom = it ? flat<{ abbreviation: string }>(it.uom) : null;
      if (!r.item_id) continue;
      bom.push({
        job_bom_line_id: r.id as string,
        item_id: r.item_id as string,
        code: it?.code ?? "",
        name: it?.name ?? "",
        uom: uom?.abbreviation ?? null,
        category: (r.category as string | null) ?? null,
      });
    }
  }

  /* ---- Call 1: vision extraction + BOM-index match ---- */
  const bomListText = bom.length
    ? bom.map((b, i) => `${i + 1}. ${b.code} — ${b.name}`).join("\n")
    : "(this job has no BOM items on file — match nothing to the BOM)";

  const system = `You read a factory PART LIST / PACKING LIST for an elevator job and turn it into structured dispatch lines. The team hand-fills these; they may be printed or photographed, may list items NOT on the job's bill of materials, and quantities are usually in a column.

Call report_part_list exactly once with EVERY physical item line. For each line:
- raw_text: the item exactly as written on the list.
- quantity: the number of units as a number (null if none is written).
- unit: the unit if written (nos, set, pcs, mtr, kg...), else null.
- bom_match: if the line clearly refers to one of the job's BOM items listed below, its 1-based number; otherwise null.
- search_query: for lines where bom_match is null, a short normalised item name or code to find it in the catalog (drop quantities, "nos", and list noise). null when bom_match is set.

Job BOM items:
${bomListText}

Ignore page headers, column titles, totals, addresses, signatures and blank rows. Be faithful — never invent items or quantities. If a quantity is unclear, use null rather than guessing.`;

  const visionTool = {
    name: "report_part_list",
    description: "Report the structured part-list lines.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        lines: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              raw_text: { type: "string" },
              quantity: { type: ["number", "null"] },
              unit: { type: ["string", "null"] },
              bom_match: { type: ["integer", "null"] },
              search_query: { type: ["string", "null"] },
            },
            required: ["raw_text", "quantity", "unit", "bom_match", "search_query"],
          },
        },
      },
      required: ["lines"],
    },
  };

  const { blocks, usedVision, textLen } = await buildContent(files);
  if (!blocks.length) return { ok: false, error: "Couldn't read the uploaded file(s) — try a PDF or clear photos." };

  const remaining = () => BUDGET_MS - (Date.now() - startedAt);

  const r1 = await callAnthropic(
    apiKey,
    {
      model: EXTRACT_MODEL,
      max_tokens: 4096,
      system,
      tool_choice: { type: "tool", name: "report_part_list" },
      tools: [visionTool],
      messages: [
        {
          role: "user",
          content: [...blocks, { type: "text", text: "Read this part list completely and call report_part_list." }],
        },
      ],
    },
    Math.max(4_000, remaining() - 500),
  );
  if (!r1.ok) {
    console.error("[part-list] read failed", { usedVision, textLen, ms: Date.now() - startedAt, error: r1.error });
    if (r1.aborted) {
      const mode = usedVision ? "image" : "text";
      const hint = usedVision
        ? "It looks scanned or photographed — upload fewer pages at a time, or a clearer file."
        : "It's a long list — try splitting it into two uploads.";
      return {
        ok: false,
        error: `The part list took too long to read (${mode} mode${usedVision ? "" : `, ${textLen.toLocaleString()} chars`}). ${hint}`,
      };
    }
    return { ok: false, error: r1.error };
  }
  const t1 = (r1.data.content ?? []).find((b) => b.type === "tool_use");
  const rawLines: RawLine[] = (((t1?.input?.lines as unknown[]) ?? []) as Record<string, unknown>[])
    .filter((l) => l && typeof l.raw_text === "string" && (l.raw_text as string).trim())
    .map((l) => ({
      raw_text: (l.raw_text as string).trim(),
      quantity: l.quantity == null ? null : Number(l.quantity),
      unit: (l.unit as string | null) ?? null,
      bom_match: l.bom_match == null ? null : Number(l.bom_match),
      search_query: (l.search_query as string | null) ?? null,
    }));
  if (!rawLines.length)
    return { ok: false, error: "Couldn't read any item lines — try a clearer scan or photo of the part list." };

  /* ---- Resolve every line to a concrete item (BOM match wins, else inventory) ---- */
  // First BOM line per item — an item can recur across sections; the whole
  // dispatched qty lands on the first line and the user audits.
  const bomLineByItem = new Map<string, BomRow>();
  for (const b of bom) if (!bomLineByItem.has(b.item_id)) bomLineByItem.set(b.item_id, b);

  interface Resolved {
    item_id: string;
    code: string | null;
    name: string | null;
    uom: string | null;
    qty: number;
    raw_text: string;
    confidence: "high" | "medium" | "low";
  }
  // A line on the packing list is at least one unit; an unreadable qty → 1.
  const lineQty = (q: number | null) => (q != null && Number.isFinite(q) && q > 0 ? q : 1);

  const resolved: Resolved[] = [];
  const unmatchedRaw: PartListUnmatched[] = [];
  const needResolve: { raw_text: string; quantity: number | null; query: string }[] = [];

  for (const l of rawLines) {
    const m = l.bom_match;
    if (m != null && Number.isInteger(m) && m >= 1 && m <= bom.length) {
      const b = bom[m - 1];
      resolved.push({ item_id: b.item_id, code: b.code, name: b.name, uom: b.uom, qty: lineQty(l.quantity), raw_text: l.raw_text, confidence: "high" });
    } else {
      needResolve.push({
        raw_text: l.raw_text,
        quantity: l.quantity != null && Number.isFinite(l.quantity) ? l.quantity : null,
        query: (l.search_query && l.search_query.trim()) || l.raw_text,
      });
    }
  }

  if (needResolve.length) {
    const candLists = await Promise.all(
      needResolve.map((t) => searchItems(t.query, undefined, 6).catch(() => [])),
    );

    const picks = new Map<number, { item_id: string | null; confidence: "high" | "medium" | "low" }>();
    const resolvable = needResolve
      .map((t, i) => ({
        line_index: i,
        text: t.raw_text,
        candidates: candLists[i].map((c) => ({ id: c.id, code: c.code, name: c.name, category: c.category_name })),
      }))
      .filter((b) => b.candidates.length);

    // Only spend the match call if there's something to resolve AND we still have
    // time budget; otherwise those lines fall through to "unmatched".
    if (resolvable.length && remaining() > MATCH_MIN_MS) {
      const matchTool = {
        name: "report_matches",
        description: "Report the single best catalog match per line.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            matches: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  line_index: { type: "integer" },
                  item_id: { type: ["string", "null"] },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                },
                required: ["line_index", "item_id", "confidence"],
              },
            },
          },
          required: ["matches"],
        },
      };
      const r2 = await callAnthropic(
        apiKey,
        {
          model: MATCH_MODEL,
          max_tokens: 2048,
          system:
            "You match free-text part-list lines to catalog items. For each line pick the SINGLE catalog item id from its own candidates that is the same physical part, or null if none clearly match. Be strict — a wrong match wrongly ships stock. Only use ids from that line's candidates.",
          tool_choice: { type: "tool", name: "report_matches" },
          tools: [matchTool],
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Match each line to one of its candidates (or null):\n" + JSON.stringify(resolvable).slice(0, 60000),
                },
              ],
            },
          ],
        },
        Math.min(MATCH_MAX_MS, Math.max(2_000, remaining() - 500)),
      );
      if (r2.ok) {
        const t2 = (r2.data.content ?? []).find((b) => b.type === "tool_use");
        for (const m of ((t2?.input?.matches as unknown[]) ?? []) as Record<string, unknown>[]) {
          picks.set(Number(m.line_index), {
            item_id: (m.item_id as string | null) ?? null,
            confidence: (m.confidence as "high" | "medium" | "low") ?? "low",
          });
        }
      }
    }

    needResolve.forEach((t, i) => {
      const cands = candLists[i];
      const pick = picks.get(i);
      const chosen = pick?.item_id ? cands.find((c) => c.id === pick.item_id) : undefined;
      if (chosen) {
        resolved.push({ item_id: chosen.id, code: chosen.code, name: chosen.name, uom: chosen.uom_abbreviation, qty: lineQty(t.quantity), raw_text: t.raw_text, confidence: pick?.confidence ?? "low" });
      } else {
        unmatchedRaw.push({ raw_text: t.raw_text, quantity: t.quantity });
      }
    });
  }

  /* ---- Aggregate by item: the SAME part across several lines sums into one ---- */
  const confRank = { high: 3, medium: 2, low: 1 } as const;
  interface Agg {
    item_id: string;
    code: string | null;
    name: string | null;
    uom: string | null;
    qty: number;
    raws: string[];
    confidence: "high" | "medium" | "low";
  }
  const byItem = new Map<string, Agg>();
  for (const r of resolved) {
    const ex = byItem.get(r.item_id);
    if (ex) {
      ex.qty += r.qty;
      ex.raws.push(r.raw_text);
      if (confRank[r.confidence] < confRank[ex.confidence]) ex.confidence = r.confidence;
    } else {
      byItem.set(r.item_id, { item_id: r.item_id, code: r.code, name: r.name, uom: r.uom, qty: r.qty, raws: [r.raw_text], confidence: r.confidence });
    }
  }

  const bomFills: PartListBomFill[] = [];
  const extras: PartListExtra[] = [];
  for (const a of byItem.values()) {
    const more = a.raws.length - 1;
    const raw_text = more > 0 ? `${a.raws[0]} (+${more} more line${more === 1 ? "" : "s"})` : a.raws[0];
    const bl = bomLineByItem.get(a.item_id);
    if (bl) {
      bomFills.push({ job_bom_line_id: bl.job_bom_line_id, item_id: a.item_id, code: bl.code, name: bl.name, uom: bl.uom, category: bl.category, qty: a.qty, raw_text });
    } else {
      extras.push({ item_id: a.item_id, code: a.code, name: a.name, uom: a.uom, qty: a.qty, raw_text, confidence: a.confidence });
    }
  }

  // Aggregate unmatched lines by their text too, so repeats collapse with summed qty.
  const unmatchedMap = new Map<string, PartListUnmatched>();
  for (const u of unmatchedRaw) {
    const key = u.raw_text.toLowerCase();
    const ex = unmatchedMap.get(key);
    if (ex) ex.quantity = ex.quantity == null && u.quantity == null ? null : (ex.quantity ?? 0) + (u.quantity ?? 0);
    else unmatchedMap.set(key, { raw_text: u.raw_text, quantity: u.quantity });
  }
  const unmatched = [...unmatchedMap.values()];

  return {
    ok: true,
    draft: {
      bomFills,
      extras,
      unmatched,
      stats: { total: rawLines.length, bom: bomFills.length, extra: extras.length, unmatched: unmatched.length },
    },
  };
}
