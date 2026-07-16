"use server";

/**
 * Hand cabin-sketch -> pre-filled Cabin Job, via Claude vision.
 *
 * A photo of a hand sketch (like the ones the owner draws — a plan view with
 * panel codes + a spec block) is read into a structured list of cabin items,
 * then each is RESOLVED to a real inventory item so the New Cabin Job form can
 * be pre-filled for review. Nothing is written to the DB here — the engineer
 * reviews and saves through the normal (Job-Order-enforced) createCabinJob path.
 *
 * Key learnings baked into the resolver (from filling these by hand):
 *  - Panel codes: P1..P6 + P2C/P2R/P2L/COP -> Side Panel; door-return P1L/P1R with
 *    a door-type prefix (AT/ACO/…) -> Front Wall LHS/RHS.
 *  - Platform/Canopy/Car Linton items live in door-type SUB-categories.
 *  - Car Linton door type is RE-CODED: AT->"SO", ACO/centre-opening->"CO".
 *  - Item names are INCONSISTENT about separators (P1R-200 vs "P1R 200"), unit
 *    suffixes (800 vs 800mm), size glue (1100X1300) and token ORDER
 *    (COP TOUCH R1 STD vs R1 COP STD). The resolver is tolerant of all of these.
 *
 * The ONLY key-dependent piece. Reads ANTHROPIC_API_KEY; absent -> graceful
 * { ok:false, reason:'not_configured' }, never throws.
 */
import { createCacheClient } from "@/lib/supabase/cache-client";
import {
  CABIN_TYPES,
  cabinInventoryType,
  isFinishSplitType,
  CABIN_PARENT,
} from "@/lib/cabin/cabin-types";
import { canonicalFinish } from "@/lib/cabin/finish-alias";

const MODEL = "claude-opus-4-8";
// Bounded so a slow read can't let the serverless platform kill the whole function.
const VISION_TIMEOUT_MS = 40_000;

/* ------------------------------------------------------------------ *
 * Result contract (consumed by the cabin-job form)
 * ------------------------------------------------------------------ */

export interface AutofillRow {
  cabin_type: string; // one of CABIN_TYPES
  item_id: string;
  item_code: string;
  item_name: string;
  item_family: string | null; // needed by the finish-split picker
  uom: string;
  qty: number;
  /** finish deliberately left blank on the sketch (e.g. linton) — MS base picked as placeholder. */
  finish_to_fill?: boolean;
  /** the raw sketch label this row was matched from (for the review panel). */
  matched_from: string;
}

export interface AutofillUnresolved {
  cabin_type: string | null;
  raw: string;
  finish: string | null;
  qty: number;
  reason: string;
  candidates: { item_id: string; code: string; name: string }[];
}

export interface CabinAutofillData {
  job_order: { job_number: string; customer_name: string | null } | null;
  job_number_raw: string | null;
  door_type: string | null;
  height: string | null;
  opening: string | null;
  rows: AutofillRow[];
  unresolved: AutofillUnresolved[];
  legend: { abbrev: string; full: string }[];
  notes: string;
}

export type CabinAutofillResult =
  | { ok: true; data: CabinAutofillData }
  | { ok: false; error: string; reason?: "not_configured" };

/* ------------------------------------------------------------------ *
 * Vision extraction
 * ------------------------------------------------------------------ */

interface SketchItem {
  block: string;
  label: string;
  finish: string | null;
  qty: number;
}
interface SketchExtraction {
  job_number: string | null;
  door_type: string | null;
  height: string | null;
  opening: string | null;
  legend: { abbrev: string; full: string }[];
  items: SketchItem[];
  notes: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    job_number: { type: ["string", "null"], description: "Job number as written, e.g. RNLCHA0063 or RNLBLR-0051." },
    door_type: { type: ["string", "null"], description: "Cabin/door type: ACO, AT, MT, Collapsible, AFF, Swing." },
    height: { type: ["string", "null"], enum: ["STD", "BIG", null], description: "Cabin height class if written." },
    opening: { type: ["string", "null"], description: "Door opening handedness: LHO, RHO, CO, LH, RH." },
    legend: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { abbrev: { type: "string" }, full: { type: "string" } },
        required: ["abbrev", "full"],
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          block: { type: "string", enum: [...CABIN_TYPES] },
          label: { type: "string", description: "Panel identity/size/variant EXACTLY as written, WITHOUT the finish." },
          finish: { type: ["string", "null"], description: "Full finish name (expand via legend), or null if not marked." },
          qty: { type: "integer", minimum: 1 },
        },
        required: ["block", "label", "finish", "qty"],
      },
    },
    notes: { type: "string" },
  },
  required: ["job_number", "door_type", "height", "opening", "legend", "items", "notes"],
};

const SYSTEM_PROMPT = `You read HAND-DRAWN cabin sketches for Indian elevator cabins and return a structured parts list by calling report_sketch exactly once. A sketch is a top-view plan: three walls drawn as boxes tiled with panels, an open side with the door, plus a written spec block (Job No, Platform, Canopy, Linton, Height, Opening, Door type) and a finish legend (e.g. "(RGL) = Rose Gold Linen", "(BM) = Black Mirror").

Return EVERY panel drawn and every component in the spec block. For each item give: block, label, finish, qty.

BLOCK — classify each item into one cabin block:
- Side Panel: rear/side wall panels P1..P6 and their C/L/R/COP variants (P2C, P2R, P3C, P4, P6C, P2R COP, …). NO door-type prefix.
- Front Wall LHS / Front Wall RHS: the narrow door-return panels at the door, written WITH a door-type prefix (e.g. "ACO P1L-100 R1 STD", "AT P1R-50 LHO STD"). P1L -> LHS, P1R -> RHS.
- Platform: the "PLATFORM -> …" line (e.g. "ACO 1100X1300").
- Canopy: the "Canopy -> …" line(s); there may be several segments each with its own QTY.
- Car Linton: the "Linton -> …" line.
- Cabin Support / Corner Wall Cover / Cabin Glass / supports: only if explicitly drawn.

LABEL — copy the identity EXACTLY as written but WITHOUT the finish words. Keep the code, size, and every variant token (STD, BIG, R1, COP, TOUCH, LHO, RHO, Blower, Glass). Examples: "P2C 350", "P4 100", "P6C 350", "ACO P1R 200 COP TOUCH R1 STD", "AT P1L 50 LHO STD", "ACO 1100X1300", "1100X300 Blower R1", "CO 800 R1". Do NOT normalise separators — write what you see.

FINISH — expand the legend to the FULL finish name (BM -> "Black Mirror", RGL -> "Rose Gold Linen"). If a panel has no finish marked (Platform, Canopy, and often the Linton), return null. NAMING: "White Mirror", "Silver Mirror", "White Silver Mirror" and "Mirror Silver" are all the SAME finish — return it as "White Mirror Silver". Plain "Mirror" is a different finish; keep it as "Mirror".

QTY — count how many of that exact panel are drawn. If a panel appears on both side walls, that is qty 2. Canopy segments carry an explicit QTY. Default 1.

SPEC BLOCK — read Job No exactly, door_type (ACO/AT/…), height (STD/BIG) if written, opening (LHO/RHO/CO). Numbers on these sketches can look like ordinals — "2nd" is usually 200, "3rd" 350; read them as sizes when they sit next to a panel code. Put anything else useful in notes. Never invent values.`;

async function callVision(
  b64: string,
  mediaType: string,
  apiKey: string,
): Promise<SketchExtraction | { error: string }> {
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
        tool_choice: { type: "tool", name: "report_sketch" },
        tools: [{ name: "report_sketch", description: "Report the cabin sketch as a structured parts list.", input_schema: SCHEMA }],
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
              { type: "text", text: "Read this hand cabin sketch completely and call report_sketch with the full parts list + spec." },
            ],
          },
        ],
      }),
      signal: ctrl.signal,
    });
  } catch {
    return {
      error: ctrl.signal.aborted
        ? "Reading the sketch took too long — try again."
        : "Couldn't reach the sketch-reading service.",
    };
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    if (resp.status === 429) return { error: "AI is busy — try again in a moment." };
    if (resp.status === 401) return { error: "AI key rejected — check the Anthropic API key." };
    return { error: `AI sketch-reading failed (${resp.status}).` };
  }
  const data = (await resp.json()) as { content?: Array<{ type: string; input?: unknown }>; stop_reason?: string };
  const tool = data.content?.find((b) => b.type === "tool_use");
  if (!tool?.input)
    return { error: data.stop_reason === "refusal" ? "The model declined to read this sketch." : "Could not read a parts list from the sketch." };
  return tool.input as SketchExtraction;
}

/* ------------------------------------------------------------------ *
 * Tolerant matching helpers
 * ------------------------------------------------------------------ */

/** Normalise a name/label so separator/unit/size-glue differences don't matter. */
function normStr(s: string): string {
  return s
    .toLowerCase()
    .replace(/(\d)\s*[x×]\s*(\d)/g, "$1 $2") // 1100X1300 / 1100 x 1300 -> 1100 1300
    .replace(/(\d)\s*mm\b/g, "$1"); // 800mm -> 800
}
/** Token SET: alnum runs; drop single letters (keep numbers + 2+ char codes). */
function toks(s: string): string[] {
  return normStr(s)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 || /\d/.test(t));
}
const HEIGHT_TOKENS = new Set(["std", "big"]);

interface Candidate {
  item_id: string;
  code: string;
  name: string;
  family: string | null;
  finish: string | null;
  uom: string;
}

/**
 * Rank a candidate against the required tokens. Returns null when the candidate
 * does NOT contain every required token (a hard miss); otherwise a score where
 * higher is better (fewest extra tokens, height match rewarded / opposite height
 * heavily penalised so a STD job never grabs the BIG variant).
 */
function scoreCandidate(reqTokens: string[], candText: string, height: string | null): number | null {
  const cand = new Set(toks(candText));
  for (const t of reqTokens) if (!cand.has(t)) return null;
  const extras = [...cand].filter((t) => !reqTokens.includes(t));
  let score = -extras.length;
  const h = height?.toLowerCase();
  if (h && HEIGHT_TOKENS.has(h)) {
    if (cand.has(h)) score += 3;
    for (const other of HEIGHT_TOKENS) if (other !== h && cand.has(other) && !reqTokens.includes(other)) score -= 100;
  }
  // Prefer the plain panel over glass / goods / bso / 1.5mm one-offs when not asked for.
  for (const noisy of ["glass", "goods", "bso", "spl"]) if (cand.has(noisy) && !reqTokens.includes(noisy)) score -= 5;
  return score;
}

/* ------------------------------------------------------------------ *
 * Category subtree resolution (per cabin block)
 * ------------------------------------------------------------------ */

type Cat = { id: string; name: string; parent_id: string | null };

async function loadCats(): Promise<Cat[]> {
  const supabase = createCacheClient();
  const { data } = await supabase.from("item_categories").select("id, name, parent_id");
  return (data ?? []) as Cat[];
}

/** Category ids of the inventory type + all its descendants. */
function subtreeIds(cats: Cat[], typeName: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const c of cats) if (c.parent_id) (childrenOf.get(c.parent_id) ?? childrenOf.set(c.parent_id, []).get(c.parent_id)!).push(c.id);
  const cabinRoot = cats.find((c) => c.name === CABIN_PARENT && c.parent_id === null);
  const typeCat =
    typeName === "Cabin Glass"
      ? cats.find((c) => c.name === "Cabin Glass")
      : cabinRoot
        ? cats.find((c) => c.name === typeName && c.parent_id === cabinRoot.id)
        : undefined;
  if (!typeCat) return [];
  const ids: string[] = [];
  const stack = [typeCat.id];
  while (stack.length) {
    const id = stack.pop() as string;
    ids.push(id);
    for (const ch of childrenOf.get(id) ?? []) stack.push(ch);
  }
  return ids;
}

/* ------------------------------------------------------------------ *
 * Per-item resolution
 * ------------------------------------------------------------------ */

/** Distinctive tokens for narrowing the DB query (codes + numbers, not STD/BIG/R1). */
function anchorTokens(label: string): string[] {
  const generic = new Set(["std", "big", "r1", "cop", "touch", "lho", "rho", "glass", "blower", "goods", "co"]);
  return toks(label).filter((t) => /\d/.test(t) || (!generic.has(t) && t.length >= 2)).slice(0, 5);
}

async function resolveOne(
  cats: Cat[],
  block: string,
  label: string,
  finish: string | null,
  height: string | null,
): Promise<{ row: Omit<AutofillRow, "qty"> } | { unresolved: Omit<AutofillUnresolved, "qty"> }> {
  // Normalise written finish variants to the canonical inventory finish first
  // ("White Mirror" / "Silver Mirror" / "White Silver Mirror" → "White Mirror
  // Silver") — cabin items carry ONE canonical finish string, and the match
  // below is exact-equality.
  finish = canonicalFinish(finish);
  const invType = cabinInventoryType(block);
  const ids = subtreeIds(cats, invType);
  const useFamily = isFinishSplitType(block);
  const field = useFamily ? "family" : "name";
  const fail = (reason: string, candidates: AutofillUnresolved["candidates"] = []) => ({
    unresolved: { cabin_type: block, raw: label, finish, reason, candidates },
  });
  if (ids.length === 0) return fail(`No inventory category for "${block}".`);

  const supabase = createCacheClient();
  let q = supabase
    .from("items")
    .select(`id, code, name, family, finish, uom:units_of_measurement!items_uom_id_fkey(abbreviation)`)
    .eq("is_active", true)
    .in("category_id", ids);
  for (const tok of anchorTokens(label)) q = q.ilike(field, `%${tok}%`);
  const { data, error } = await q.limit(300);
  if (error) return fail("Lookup failed.");

  const flat = (rel: unknown): string =>
    (Array.isArray(rel) ? (rel[0] as { abbreviation?: string }) : (rel as { abbreviation?: string }))?.abbreviation ?? "";
  let cands: Candidate[] = (data ?? []).map((it) => ({
    item_id: (it as { id: string }).id,
    code: (it as { code: string }).code,
    name: (it as { name: string }).name,
    family: ((it as { family: string | null }).family) ?? null,
    finish: ((it as { finish: string | null }).finish) ?? null,
    uom: flat((it as { uom?: unknown }).uom),
  }));
  if (cands.length === 0) return fail(`No item in ${invType} matches "${label}".`);

  const reqTokens = toks(label);
  const finishToFill = useFamily && !finish; // e.g. linton drawn without a finish
  const wantFinish = finish?.trim().toLowerCase() ?? null;

  // When a finish is asked for, filter to it (finish-split items carry items.finish).
  if (wantFinish && useFamily) {
    const byFinish = cands.filter((c) => (c.finish ?? "").trim().toLowerCase() === wantFinish);
    if (byFinish.length) cands = byFinish;
  }
  // finish-to-fill: prefer the MS base as the placeholder, else any.
  if (finishToFill) {
    const ms = cands.filter((c) => (c.finish ?? "").trim().toUpperCase() === "MS");
    if (ms.length) cands = ms;
  }

  let best: { c: Candidate; score: number } | null = null;
  for (const c of cands) {
    const s = scoreCandidate(reqTokens, useFamily ? (c.family ?? c.name) : c.name, height);
    if (s == null) continue;
    if (!best || s > best.score) best = { c, score: s };
  }
  if (!best) {
    return fail(
      `Found ${cands.length} near-match(es) in ${invType} but none covered every token of "${label}".`,
      cands.slice(0, 5).map((c) => ({ item_id: c.item_id, code: c.code, name: c.name })),
    );
  }
  const c = best.c;
  return {
    row: {
      cabin_type: block,
      item_id: c.item_id,
      item_code: c.code,
      item_name: c.name,
      item_family: c.family,
      uom: c.uom,
      ...(finishToFill ? { finish_to_fill: true } : {}),
      matched_from: finish ? `${label} · ${finish}` : label,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Job Order lookup (hyphen-tolerant — sketches often drop the hyphen)
 * ------------------------------------------------------------------ */

async function findJobOrder(raw: string | null): Promise<{ job_number: string; customer_name: string | null } | null> {
  const target = (raw ?? "").trim();
  if (!target) return null;
  const supabase = createCacheClient();
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = squash(target);
  if (!key) return null;
  // Separator-tolerant narrowing: the sketch often drops the hyphen
  // ("RNLCHA0063" vs "RNLCHA-0063"). Split into alpha/digit runs and wildcard
  // between them so "%RNLCHA%0063%" matches either form, then confirm by squash.
  const parts = target.match(/[a-zA-Z]+|[0-9]+/g) ?? [];
  if (parts.length === 0) return null;
  const pattern = "%" + parts.join("%") + "%";
  const { data } = await supabase
    .from("jobs")
    .select("job_number, customer_name")
    .ilike("job_number", pattern)
    .limit(50);
  const hit = (data ?? []).find((j) => squash((j as { job_number: string }).job_number) === key);
  if (!hit) return null;
  return {
    job_number: (hit as { job_number: string }).job_number,
    customer_name: ((hit as { customer_name: string | null }).customer_name) ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function autofillCabinFromSketch(
  imageBase64: string,
  mediaType: string,
): Promise<CabinAutofillResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "Sketch auto-fill isn't configured (no AI key).", reason: "not_configured" };
  if (!imageBase64) return { ok: false, error: "No image provided." };
  const media = /^image\/(png|jpe?g|webp|gif)$/.test(mediaType) ? mediaType : "image/jpeg";

  try {
    const extracted = await callVision(imageBase64, media, apiKey);
    if ("error" in extracted) return { ok: false, error: extracted.error };

    const cats = await loadCats();
    const rows: AutofillRow[] = [];
    const unresolved: AutofillUnresolved[] = [];
    // The same panel drawn several times resolves to the SAME item_id (the finish
    // is baked into the id), so merge repeats into ONE row with the quantity
    // summed instead of emitting a duplicate row per occurrence. Keyed by
    // section + item, so a shared item across two blocks (e.g. Front Wall LHS
    // P1L vs RHS P1R — different items anyway) can never collapse together.
    const rowByKey = new Map<string, AutofillRow>();

    for (const it of extracted.items ?? []) {
      if (!it?.block || !it?.label) continue;
      const qty = Number.isFinite(it.qty) && it.qty > 0 ? Math.round(it.qty) : 1;
      const res = await resolveOne(cats, it.block, it.label, it.finish ?? null, extracted.height ?? null);
      if ("row" in res) {
        const row: AutofillRow = { ...res.row, qty };
        const key = `${row.cabin_type} ${row.item_id}`;
        const existing = rowByKey.get(key);
        if (existing) existing.qty += qty; // same object is already in `rows` — order preserved
        else {
          rowByKey.set(key, row);
          rows.push(row);
        }
      } else {
        unresolved.push({ ...res.unresolved, qty });
      }
    }

    const jobOrder = await findJobOrder(extracted.job_number);

    return {
      ok: true,
      data: {
        job_order: jobOrder,
        job_number_raw: extracted.job_number ?? null,
        door_type: extracted.door_type ?? null,
        height: extracted.height ?? null,
        opening: extracted.opening ?? null,
        rows,
        unresolved,
        legend: extracted.legend ?? [],
        notes: extracted.notes ?? "",
      },
    };
  } catch (e) {
    console.error("autofillCabinFromSketch failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Sketch auto-fill failed unexpectedly." };
  }
}
