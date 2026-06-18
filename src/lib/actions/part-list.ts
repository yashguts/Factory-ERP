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

const MODEL = "claude-opus-4-8";
// Bound each call under the serverless function cap (see spec-vision.ts). The
// vision read is the slow one; the match call is small. Total worst-case stays
// under the platform timeout, and a skipped/failed match call degrades to
// "unmatched" rather than failing the whole upload.
const VISION_TIMEOUT_MS = 16_000;
const MATCH_TIMEOUT_MS = 7_000;
const MATCH_SKIP_AFTER_MS = 17_000; // if the vision step ran long, skip the match call

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

function contentBlocksFor(files: PartListFile[]): unknown[] {
  const blocks: unknown[] = [];
  for (const f of files) {
    if (f.media_type === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
    } else if (IMG_TYPES.has(f.media_type)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } });
    }
  }
  return blocks;
}

async function callAnthropic(
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: true; data: { content?: Blk[] } } | { ok: false; error: string }> {
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
      if (resp.status === 429) return { ok: false, error: "AI is busy — try again in a moment." };
      if (resp.status === 401) return { ok: false, error: "AI key was rejected." };
      return { ok: false, error: `AI request failed (${resp.status}).` };
    }
    return { ok: true, data: (await resp.json()) as { content?: Blk[] } };
  } catch {
    return {
      ok: false,
      error: ctrl.signal.aborted
        ? "Reading the part list took too long — try fewer pages or clearer photos."
        : "Couldn't reach the AI service — try again.",
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

  const r1 = await callAnthropic(
    apiKey,
    {
      model: MODEL,
      max_tokens: 4096,
      system,
      tool_choice: { type: "tool", name: "report_part_list" },
      tools: [visionTool],
      messages: [
        {
          role: "user",
          content: [...contentBlocksFor(files), { type: "text", text: "Read this part list completely and call report_part_list." }],
        },
      ],
    },
    VISION_TIMEOUT_MS,
  );
  if (!r1.ok) return r1;
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

  /* ---- Partition: BOM-matched vs needs inventory resolution ---- */
  const bomFills: PartListBomFill[] = [];
  const usedBomLine = new Set<string>();
  const toResolve: { raw_text: string; quantity: number | null; query: string }[] = [];

  for (const l of rawLines) {
    const qty = l.quantity != null && Number.isFinite(l.quantity) && l.quantity > 0 ? l.quantity : 0;
    const m = l.bom_match;
    if (m != null && Number.isInteger(m) && m >= 1 && m <= bom.length) {
      const chosen = bom[m - 1];
      const target = !usedBomLine.has(chosen.job_bom_line_id)
        ? chosen
        : bom.find((b) => b.item_id === chosen.item_id && !usedBomLine.has(b.job_bom_line_id));
      if (target) {
        usedBomLine.add(target.job_bom_line_id);
        bomFills.push({
          job_bom_line_id: target.job_bom_line_id,
          item_id: target.item_id,
          code: target.code,
          name: target.name,
          uom: target.uom,
          category: target.category,
          qty,
          raw_text: l.raw_text,
        });
        continue;
      }
    }
    toResolve.push({
      raw_text: l.raw_text,
      quantity: l.quantity != null && Number.isFinite(l.quantity) ? l.quantity : null,
      query: (l.search_query && l.search_query.trim()) || l.raw_text,
    });
  }

  /* ---- Resolve non-BOM lines against inventory ---- */
  const extras: PartListExtra[] = [];
  const unmatched: PartListUnmatched[] = [];

  if (toResolve.length) {
    const candLists = await Promise.all(
      toResolve.map((t) => searchItems(t.query, undefined, 6).catch(() => [])),
    );

    const picks = new Map<number, { item_id: string | null; confidence: "high" | "medium" | "low" }>();
    const resolvable = toResolve
      .map((t, i) => ({
        line_index: i,
        text: t.raw_text,
        candidates: candLists[i].map((c) => ({ id: c.id, code: c.code, name: c.name, category: c.category_name })),
      }))
      .filter((b) => b.candidates.length);

    // Only spend the second call if there's something to resolve AND we still
    // have time budget; otherwise leave those lines as unmatched.
    if (resolvable.length && Date.now() - startedAt < MATCH_SKIP_AFTER_MS) {
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
          model: MODEL,
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
        MATCH_TIMEOUT_MS,
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

    toResolve.forEach((t, i) => {
      const cands = candLists[i];
      const pick = picks.get(i);
      const chosen = pick?.item_id ? cands.find((c) => c.id === pick.item_id) : undefined;
      if (chosen) {
        extras.push({
          item_id: chosen.id,
          code: chosen.code,
          name: chosen.name,
          uom: chosen.uom_abbreviation,
          qty: t.quantity != null && t.quantity > 0 ? t.quantity : 1,
          raw_text: t.raw_text,
          confidence: pick?.confidence ?? "low",
        });
      } else {
        unmatched.push({ raw_text: t.raw_text, quantity: t.quantity });
      }
    });
  }

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
