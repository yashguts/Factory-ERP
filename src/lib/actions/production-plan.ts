"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { getMrpData } from "@/lib/actions/mrp";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";

/**
 * Make-shortfall PRODUCTION PLAN: the fewest "other parts" (least over-production)
 * set of AUDITED program runs to cover the Make-type MRP shortfall.
 *
 * - Demand = getMrpData (already in-production + requirement-stage-scoped + dispatch-netted),
 *   filtered to make items with shortfall.
 * - Resolution: a sub-assembly explodes to its parts list; otherwise the item is produced
 *   directly. Stock is netted at every level.
 * - Objective: minimise TOTAL parts produced (== minimise "other parts") while covering every
 *   needed part — a greedy that each round picks the program run with the best useful:produced
 *   ratio, so co-products that are also needed come "for free" and wasteful nests are avoided.
 */

export interface PlanFeed {
  code: string;
  name: string;
  type: string;
  category: string; // top-level category
  subCategory: string; // direct (sub-)category
  need: number;
}
export interface PlanCover {
  code: string; // the produced part — the program's TRUE output
  name: string;
  qty: number; // units of this part the run contributes toward the plan (capped at need)
  direct: boolean; // the produced part is itself a shortfall finished item
  type: string;
  category: string; // top-level category (of the produced part)
  subCategory: string; // direct (sub-)category (of the produced part)
  feeds: PlanFeed[]; // finished items this part is a sub-component of (empty when produced directly)
}
export interface PlanInput {
  code: string;
  name: string; // raw sheet name, e.g. "1250x2500x3.0mm MS/GI" — encodes size + thickness
  thicknessMm: number | null; // parsed from the name; null when not parseable
  perRun: number; // sheets consumed per program run
  total: number; // perRun × runs — what the operator actually has to load
}
export interface PlanOutput {
  code: string;
  name: string;
  perRun: number;
  /** Units this plan's runs will produce (perRun × runs). */
  produced: number;
  /** Units of those counted toward the requirement (globally allocated — never double-counted across programs). */
  used: number;
}
export interface PlanProgram {
  code: string;
  name: string;
  machine: string;
  runs: number;
  /** Machining time of ONE run in seconds (null = not captured on the program). */
  machiningTimeSeconds: number | null;
  /** runs x machiningTimeSeconds (null when the per-run time is unknown). */
  machineSeconds: number | null;
  /** Scrap share of one sheet for this nest, from the TruTops report (null = not captured). */
  scrapPercent: number | null;
  /** runs x sheet weight — total steel this program's runs load (null = not captured). */
  materialKg: number | null;
  /** runs x scrap weight — steel wasted by this program's runs (null = not captured). */
  scrapKg: number | null;
  partsMade: number;
  extra: number;
  covers: PlanCover[];
  /** EVERY part the program's runs produce, with produced vs counted-toward-requirement. */
  outputs: PlanOutput[];
  /** Raw material consumed (usually one sheet item) — tells the floor which thickness to cut. */
  inputs: PlanInput[];
}
export interface BlockedItem {
  code: string;
  name: string;
  type: string;
  category: string; // top-level category
  subCategory: string; // direct (sub-)category
  need: number;
  missing: { code: string; auditProgram: string | null }[];
}
export interface MakeProductionPlan {
  cutoffDate: string | null;
  totals: {
    shortfallItems: number;
    makeable: number;
    blocked: number;
    programs: number;
    runs: number;
    partsMade: number;
    partsNeeded: number;
    otherParts: number;
    /** Raw sheets the chosen plan consumes (programs with recorded sheet inputs). */
    sheets: number;
    /** What the simple least-extra-parts pick would have consumed — shows the saving. */
    sheetsSimple: number;
    /** Total machine time of the plan in seconds (runs x time/run, where known). */
    machineSeconds: number;
    /** Programs in the plan with no machining time captured (count 0 in the total). */
    programsMissingTime: number;
    /** Total steel the plan loads, kg (runs x sheet weight, where captured). */
    materialKg: number;
    /** Total steel the plan scraps, kg (runs x scrap weight, where captured). */
    scrapKg: number;
    /** Programs in the plan with no scrap data captured (count 0 in the totals). */
    programsMissingScrap: number;
  };
  plan: PlanProgram[];
  blocked: BlockedItem[];
  /** Program codes the user excluded ("don't run this") — the plan above is computed without them. */
  excluded: string[];
}

const PAGE = 1000;

/** Sheet thickness from names like "1250x2500x3.0mm MS/GI" / "2500X1250X1.2mm SS/Grade 430"
 *  (third dimension), falling back to any standalone "N mm" token. */
function sheetThicknessMm(name: string): number | null {
  const dims = /\d{3,4}\s*[xX]\s*\d{3,4}\s*[xX]\s*(\d+(?:\.\d+)?)\s*mm/.exec(name);
  if (dims) return parseFloat(dims[1]);
  const loose = /(\d+(?:\.\d+)?)\s*mm\b/i.exec(name);
  return loose ? parseFloat(loose[1]) : null;
}
const empty = (c: string | null, excluded: string[] = []): MakeProductionPlan => ({
  cutoffDate: c,
  totals: { shortfallItems: 0, makeable: 0, blocked: 0, programs: 0, runs: 0, partsMade: 0, partsNeeded: 0, otherParts: 0, sheets: 0, sheetsSimple: 0, machineSeconds: 0, programsMissingTime: 0, materialKg: 0, scrapKg: 0, programsMissingScrap: 0 },
  plan: [],
  blocked: [],
  excluded,
});

/* ------------------------------------------------------------------ *
 * Program-run selection. Two greedy strategies over the same demand:
 *  - least-extra-parts (the original): best useful:produced ratio per round.
 *  - least-sheets: best useful-parts-per-SHEET per round (a program that
 *    covers the same demand with fewer raw sheets wins).
 * Both get a reverse "trim" pass (most-expensive program first, cancel runs
 * that other programs' co-products already cover), then whichever covers
 * the demand with fewer sheets is used. Coverage is re-verified — on any
 * discrepancy we fall back to the original selection.
 * ------------------------------------------------------------------ */

type OpOuts = Map<string, Map<string, number>>; // op -> part -> qty per run
type Runs = Map<string, number>;

type ScoreFn = (
  op: string,
  outs: Map<string, number>,
  remaining: Map<string, number>,
  useful: number,
) => number;

function greedySelect(progOut: OpOuts, leafProduce: Map<string, number>, score: ScoreFn): Runs {
  const remaining = new Map(leafProduce);
  const runs: Runs = new Map();
  for (;;) {
    let best: string | null = null, bestScore = -1, bestUseful = -1;
    for (const [op, outs] of progOut) {
      let u = 0;
      for (const [part, qty] of outs) u += Math.min(remaining.get(part) ?? 0, qty);
      if (u <= 0) continue;
      const s = score(op, outs, remaining, u);
      if (s > bestScore || (s === bestScore && u > bestUseful)) { bestScore = s; bestUseful = u; best = op; }
    }
    if (!best) break;
    const outs = progOut.get(best)!;
    let batch = Infinity;
    for (const [part, qty] of outs) { const rem = remaining.get(part) ?? 0; if (rem > 0) batch = Math.min(batch, Math.ceil(rem / qty)); }
    runs.set(best, (runs.get(best) ?? 0) + batch);
    for (const [part, qty] of outs) { const rem = remaining.get(part) ?? 0; if (rem > 0) remaining.set(part, Math.max(0, rem - qty * batch)); }
  }
  return runs;
}

/** Cancel runs that other selected programs' co-products already cover
 *  (most sheet-expensive first), repeated to FIXPOINT — removing one
 *  program's runs can make another's removable. */
function trimRuns(runs: Runs, progOut: OpOuts, leafProduce: Map<string, number>, sheetCost: Map<string, number>): Runs {
  const produced = new Map<string, number>();
  for (const [op, r] of runs) for (const [part, qty] of progOut.get(op) ?? []) produced.set(part, (produced.get(part) ?? 0) + qty * r);
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    const order = [...runs.keys()].sort((a, b) => (sheetCost.get(b) ?? 1) - (sheetCost.get(a) ?? 1));
    for (const op of order) {
      const outs = progOut.get(op) ?? new Map<string, number>();
      while ((runs.get(op) ?? 0) > 0) {
        let removable = true;
        for (const [part, qty] of outs) {
          const need = leafProduce.get(part) ?? 0;
          if (need > 0 && (produced.get(part) ?? 0) - qty < need) { removable = false; break; }
        }
        if (!removable) break;
        runs.set(op, runs.get(op)! - 1);
        changed = true;
        for (const [part, qty] of outs) produced.set(part, (produced.get(part) ?? 0) - qty);
      }
      if ((runs.get(op) ?? 0) === 0) runs.delete(op);
    }
    if (!changed) break;
  }
  return runs;
}

/**
 * Remove-and-repair local search: try dropping one run (or all runs) of each
 * selected program, patch any coverage deficit with the cheapest-per-sheet
 * greedy over ALL candidates, re-trim, and keep the move when total sheets
 * strictly drop. This is what un-sticks the greedy's early over-commitments —
 * e.g. a dedicated bracket nest whose part later arrives as co-product of
 * programs we must run anyway.
 */
function localSearch(
  start: Runs,
  progOut: OpOuts,
  leafProduce: Map<string, number>,
  sheetCost: Map<string, number>,
  inputsOf: Map<string, Map<string, number>>,
): Runs {
  let best = start;
  let bestSheets = reportedSheets(best, inputsOf);
  for (let iter = 0; iter < 25; iter++) {
    let improved = false;
    const ops = [...best.keys()].sort((a, b) => (sheetCost.get(b) ?? 1) - (sheetCost.get(a) ?? 1));
    outer: for (const op of ops) {
      const r = best.get(op)!;
      for (const removeAll of r > 1 ? [false, true] : [true]) {
        const cand: Runs = new Map(best);
        if (removeAll) cand.delete(op);
        else cand.set(op, r - 1);
        // Patch whatever the removal uncovered.
        const produced = new Map<string, number>();
        for (const [o2, r2] of cand) for (const [part, qty] of progOut.get(o2) ?? []) produced.set(part, (produced.get(part) ?? 0) + qty * r2);
        const deficit = new Map<string, number>();
        for (const [part, need] of leafProduce) {
          const d = need - (produced.get(part) ?? 0);
          if (d > 0) deficit.set(part, d);
        }
        if (deficit.size > 0) {
          const patch = greedySelect(progOut, deficit, (o2, _outs, _rem, u) => u / (sheetCost.get(o2) ?? 1));
          for (const [o2, r2] of patch) cand.set(o2, (cand.get(o2) ?? 0) + r2);
        }
        trimRuns(cand, progOut, leafProduce, sheetCost);
        if (!coversDemand(cand, progOut, leafProduce)) continue;
        const s = reportedSheets(cand, inputsOf);
        if (s < bestSheets) { best = cand; bestSheets = s; improved = true; break outer; }
      }
    }
    if (!improved) {
      // Add-and-trim: sometimes ADDING one run of a rich nest lets several
      // other programs cancel runs for a net sheet saving — a move the
      // remove-repair direction can't discover.
      for (const op of progOut.keys()) {
        const cand: Runs = new Map(best);
        cand.set(op, (cand.get(op) ?? 0) + 1);
        trimRuns(cand, progOut, leafProduce, sheetCost);
        if (!coversDemand(cand, progOut, leafProduce)) continue;
        const s = reportedSheets(cand, inputsOf);
        if (s < bestSheets) { best = cand; bestSheets = s; improved = true; break; }
      }
    }
    if (!improved) break;
  }
  return best;
}

function coversDemand(runs: Runs, progOut: OpOuts, leafProduce: Map<string, number>): boolean {
  const produced = new Map<string, number>();
  for (const [op, r] of runs) for (const [part, qty] of progOut.get(op) ?? []) produced.set(part, (produced.get(part) ?? 0) + qty * r);
  for (const [part, need] of leafProduce) if ((produced.get(part) ?? 0) < need - 1e-9) return false;
  return true;
}

/** Reported sheet total, per-item ceil like the UI. A program with NO recorded
 *  inputs counts as 1 sheet/run — same as the selection's sheetCost default —
 *  so a data gap can never make a program look FREE to the optimiser. */
function reportedSheets(runs: Runs, inputsOf: Map<string, Map<string, number>>): number {
  let s = 0;
  for (const [op, r] of runs) {
    const ins = inputsOf.get(op);
    if (!ins || ins.size === 0) {
      s += r;
      continue;
    }
    for (const [, perRun] of ins) s += Math.ceil(perRun * r);
  }
  return s;
}

export async function getMakeProductionPlan(
  cutoffDate?: string,
  excludeCodes?: string[],
): Promise<MakeProductionPlan> {
  const excl = [...new Set((excludeCodes ?? []).map((c) => c.trim()).filter(Boolean))].sort();
  const key = `${cutoffDate ?? "__all__"}|${excl.join("§")}`;
  return unstable_cache(_getPlanUncached, ["make-production-plan", key], {
    revalidate: 1800,
    tags: ["jobs", "bom-lines", "items", "inventory-stock", "operations"],
  })(cutoffDate, excl);
}

async function _getPlanUncached(cutoffDate?: string, excludeCodes: string[] = []): Promise<MakeProductionPlan> {
  const supabase = createCacheClient();

  // (1) Make shortfall from the live MRP calc, (2) parts lists, and the category
  // procurement tree are all independent of one another — fetch concurrently.
  // `short` gates an early return, so we compute it from the resolved MRP after
  // the join; the other two are cheap full-table reads we'd need regardless.
  const partsOfPromise = (async () => {
    const partsOf = new Map<string, { child: string; qty: number }[]>();
    const rows = await fetchAllRanged<any>((from, to, withCount) =>
      supabase
        .from("item_bom_lines")
        .select("parent_item_id, child_item_id, qty", withCount ? { count: "exact" } : {})
        .order("parent_item_id")
        .range(from, to),
    );
    for (const b of rows) {
      if (!b.child_item_id) continue;
      const a = partsOf.get(b.parent_item_id as string) ?? [];
      a.push({ child: b.child_item_id as string, qty: Number(b.qty) || 1 });
      partsOf.set(b.parent_item_id as string, a);
    }
    return partsOf;
  })();

  // 5) category procurement / names — independent full-table read.
  const catProcPromise = (async () => {
    const catProc = new Map<string, { name: string | null; procurement_type: string | null; parent_id: string | null }>();
    const { data } = await supabase.from("item_categories").select("id, name, procurement_type, parent_id");
    for (const c of data ?? []) catProc.set(c.id as string, { name: c.name as string, procurement_type: c.procurement_type as string | null, parent_id: (c.parent_id as string | null) ?? null });
    return catProc;
  })();

  // active programs — independent full-table read (used in step 5 below).
  const opsPromise = (async () => {
    const ops = new Map<string, any>();
    const rows = await fetchAllRanged<any>((from, to, withCount) =>
      supabase
        .from("operations")
        .select(
          "id, name, code, machine, audited_at, machining_time_seconds, sheet_weight_kg, scrap_percent, scrap_weight_kg",
          withCount ? { count: "exact" } : {},
        )
        .eq("is_active", true)
        .order("id")
        .range(from, to),
    );
    for (const o of rows) ops.set(o.id as string, o);
    return ops;
  })();

  // 1) Make shortfall from the live MRP calc
  const mrp = await getMrpData(cutoffDate);
  const short = new Map<string, { shortfall: number; code: string; name: string; category: string }>();
  for (const r of mrp) {
    if (r.procurement_type === "make" && r.shortfall > 0)
      short.set(r.item_id, { shortfall: r.shortfall, code: r.item_code, name: r.item_name, category: r.category_name ?? "(none)" });
  }
  if (short.size === 0) {
    // Drain the in-flight reads so we don't leave unhandled rejections.
    await Promise.all([partsOfPromise, catProcPromise, opsPromise]);
    return empty(cutoffDate ?? null, excludeCodes);
  }

  // 2) parts lists (item_bom_lines): parent -> [{child, qty}]
  const partsOf = await partsOfPromise;

  // 3) involved items = shortfall finished + all parts-list descendants
  const involved = new Set<string>(short.keys());
  const stack = [...short.keys()];
  while (stack.length) {
    const it = stack.pop() as string;
    for (const { child } of partsOf.get(it) ?? []) if (!involved.has(child)) { involved.add(child); stack.push(child); }
  }
  const invIds = [...involved];

  // 4) item info + stock — both are id-chunk batches over the SAME involved ids
  // and don't depend on each other, so fire every chunk of both concurrently.
  const itemInfo = new Map<string, any>();
  const stock = new Map<string, number>();
  {
    const chunks: string[][] = [];
    for (let i = 0; i < invIds.length; i += 150) chunks.push(invIds.slice(i, i + 150));
    const [itemResults, stockResults] = await Promise.all([
      Promise.all(
        chunks.map((ids) =>
          supabase
            .from("items")
            .select("id, code, name, category_id, procurement_type, stock_behaviour, item_type")
            .in("id", ids),
        ),
      ),
      Promise.all(
        chunks.map((ids) =>
          supabase.from("inventory").select("item_id, quantity").in("item_id", ids),
        ),
      ),
    ]);
    for (const { data, error } of itemResults) {
      if (error) throw error;
      for (const it of data ?? []) itemInfo.set(it.id as string, it);
    }
    for (const { data, error } of stockResults) {
      if (error) throw error;
      for (const v of data ?? []) stock.set(v.item_id as string, (stock.get(v.item_id as string) ?? 0) + Number(v.quantity || 0));
    }
  }
  const catProc = await catProcPromise;
  const effProc = (id: string) => {
    const it = itemInfo.get(id) ?? {};
    return it.procurement_type ?? (it.category_id ? catProc.get(it.category_id)?.procurement_type : null) ?? null;
  };
  const catName = (id: string) => (itemInfo.get(id)?.category_id ? catProc.get(itemInfo.get(id).category_id)?.name : null) ?? "(none)";
  const topCatName = (id: string) => {
    const start = itemInfo.get(id)?.category_id as string | null | undefined;
    if (!start) return "(none)";
    let cid: string = start;
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(cid)) break;
      seen.add(cid);
      const parent = catProc.get(cid)?.parent_id;
      if (!parent) break;
      cid = parent;
    }
    return catProc.get(cid)?.name ?? "(none)";
  };
  const itemType = (id: string) => (itemInfo.get(id)?.item_type as string) ?? "—";
  const code = (id: string) => (itemInfo.get(id)?.code as string) ?? id;
  const name = (id: string) => (itemInfo.get(id)?.name as string) ?? "";
  const isMakeLeaf = (id: string) => effProc(id) !== "trade"; // phantom/make/unknown -> make; trade -> buy

  // 5) producers (component + cut_part) for involved items, split audited /
  // pending. The active-programs list (kicked off up top) and the full-table
  // output scan are independent of each other and of the involved set; the
  // folding below applies the same `involved` filter and audited/pending split
  // in DB row order (.order("id")), so the result is identical.
  const [ops, outputRows] = await Promise.all([
    opsPromise,
    fetchAllRanged<any>((from, to, withCount) =>
      supabase
        .from("operation_outputs")
        .select("operation_id, item_id, qty_per_run, role", withCount ? { count: "exact" } : {})
        .not("item_id", "is", null)
        .gt("qty_per_run", 0)
        .in("role", ["component", "cut_part"])
        .order("id")
        .range(from, to),
    ),
  ]);
  // "Don't run this" exclusions: drop the program from the producer pool
  // entirely so the selection (and the blocked classification) recompute
  // as if it didn't exist.
  const excludedIds = new Set(
    [...ops.values()].filter((o: any) => excludeCodes.includes(o.code as string)).map((o: any) => o.id as string),
  );
  const aud = new Map<string, Map<string, number>>();
  const pend = new Map<string, Map<string, number>>();
  for (const o of outputRows) {
    if (!involved.has(o.item_id as string)) continue;
    if (excludedIds.has(o.operation_id as string)) continue;
    const op = ops.get(o.operation_id as string);
    if (!op) continue;
    const m = op.audited_at ? aud : pend;
    const inner = m.get(o.item_id as string) ?? new Map<string, number>();
    inner.set(o.operation_id as string, (inner.get(o.operation_id as string) ?? 0) + Number(o.qty_per_run));
    m.set(o.item_id as string, inner);
  }

  // 6) classify each finished item: leaves + makeable / blocked.
  // partsOf is fully loaded and never mutated past this point, so leavesOf is a
  // pure function of its argument — memoize it (it's called once per shortfall
  // item AND again per makeable item). Callers only READ the returned set, so
  // sharing the cached instance is safe.
  const leavesCache = new Map<string, Set<string>>();
  const leavesOf = (f: string): Set<string> => {
    const cached = leavesCache.get(f);
    if (cached) return cached;
    const seen = new Set<string>(), out = new Set<string>(), st = [f];
    while (st.length) {
      const it = st.pop() as string;
      if (seen.has(it)) continue;
      seen.add(it);
      const kids = partsOf.get(it) ?? [];
      if (kids.length) for (const { child } of kids) st.push(child);
      else out.add(it);
    }
    leavesCache.set(f, out);
    return out;
  };
  const statusOf = new Map<string, { kind: string; missing: string[] }>();
  for (const f of short.keys()) {
    const lv = leavesOf(f);
    const makeLeaves = [...lv].filter(isMakeLeaf);
    const missing = makeLeaves.filter((l) => !aud.has(l));
    if (makeLeaves.length === 0) statusOf.set(f, { kind: "no-make", missing: [] });
    else if (missing.length === 0) statusOf.set(f, { kind: lv.size === 1 && lv.has(f) ? "direct" : "assembly", missing: [] });
    else statusOf.set(f, { kind: "blocked", missing });
  }
  const makeable = [...short.keys()].filter((f) => ["direct", "assembly"].includes(statusOf.get(f)!.kind));

  // Map each produced (make-)leaf back to the finished item(s) it builds, so the plan
  // shows job-relevant finished items rather than internal/phantom cut parts.
  const finishedByLeaf = new Map<string, Set<string>>();
  for (const f of makeable) {
    for (const l of leavesOf(f)) {
      if (!isMakeLeaf(l)) continue;
      const set = finishedByLeaf.get(l) ?? new Set<string>();
      set.add(f);
      finishedByLeaf.set(l, set);
    }
  }

  // 7) topo explosion seeded from makeable finished items -> leaf demand (stock netted at every level)
  const seed = new Set<string>();
  { const st = [...makeable]; while (st.length) { const it = st.pop() as string; if (seed.has(it)) continue; seed.add(it); for (const { child } of partsOf.get(it) ?? []) st.push(child); } }
  const indeg = new Map<string, number>(); for (const it of seed) indeg.set(it, 0);
  for (const it of seed) for (const { child } of partsOf.get(it) ?? []) if (seed.has(child)) indeg.set(child, (indeg.get(child) ?? 0) + 1);
  const queue = [...seed].filter((it) => indeg.get(it) === 0); const topo: string[] = [];
  while (queue.length) { const it = queue.shift() as string; topo.push(it); for (const { child } of partsOf.get(it) ?? []) if (seed.has(child)) { indeg.set(child, indeg.get(child)! - 1); if (indeg.get(child) === 0) queue.push(child); } }
  const demand = new Map<string, number>();
  for (const f of makeable) demand.set(f, (demand.get(f) ?? 0) + short.get(f)!.shortfall + (stock.get(f) ?? 0)); // gross = shortfall + stock so produce nets back to shortfall
  const leafProduce = new Map<string, number>();
  for (const it of topo) {
    const prod = Math.max(0, (demand.get(it) ?? 0) - (stock.get(it) ?? 0));
    if (prod <= 0) continue;
    const kids = partsOf.get(it) ?? [];
    if (kids.length) for (const { child, qty } of kids) demand.set(child, (demand.get(child) ?? 0) + prod * qty);
    else if (isMakeLeaf(it)) leafProduce.set(it, (leafProduce.get(it) ?? 0) + prod);
  }

  // 8) candidate programs for the needed parts
  const progOut: OpOuts = new Map();
  for (const part of leafProduce.keys()) for (const [op, qty] of aud.get(part) ?? []) { const m = progOut.get(op) ?? new Map<string, number>(); m.set(part, qty); progOut.set(op, m); }

  // Sheet cost per CANDIDATE program (operation_inputs) — the sheet-aware
  // selection needs it for every candidate, not just the chosen ones. A
  // program with no recorded inputs counts as 1 sheet/run so a data gap
  // doesn't make it look free.
  const inputsOf = new Map<string, Map<string, number>>(); // op -> input item -> qty/run
  {
    const candIds = [...progOut.keys()];
    const chunks: string[][] = [];
    for (let i = 0; i < candIds.length; i += 150) chunks.push(candIds.slice(i, i + 150));
    const results = await Promise.all(
      chunks.map((ids) =>
        supabase.from("operation_inputs").select("operation_id, item_id, qty_per_run").in("operation_id", ids).gt("qty_per_run", 0),
      ),
    );
    for (const { data } of results)
      for (const o of data ?? []) { if (!o.item_id) continue; const m = inputsOf.get(o.operation_id as string) ?? new Map<string, number>(); m.set(o.item_id as string, (m.get(o.item_id as string) ?? 0) + Number(o.qty_per_run)); inputsOf.set(o.operation_id as string, m); }
  }
  const sheetCost = new Map<string, number>();
  for (const op of progOut.keys()) {
    const ins = inputsOf.get(op);
    sheetCost.set(op, ins && ins.size ? [...ins.values()].reduce((s, q) => s + q, 0) : 1);
  }
  const cost = (op: string) => sheetCost.get(op) ?? 1;

  // The "simple pick" baseline = the ORIGINAL algorithm on the ORIGINAL
  // candidate set (before dominance pruning), so "saves N vs simple pick"
  // honestly measures everything the optimiser adds.
  const progOutOriginal: OpOuts = new Map([...progOut.entries()].map(([k, v]) => [k, new Map(v)]));

  // Dominance preprocessing: if B makes >= of every needed part A makes, for
  // no more sheets, A can never be part of a best plan — drop it. (Strictness
  // / code tie-break keeps exactly one of identical twins.)
  {
    const opsList = [...progOut.keys()];
    const codeOf = (id: string) => (ops.get(id)?.code as string) ?? id;
    for (const a of opsList) {
      const oa = progOut.get(a);
      if (!oa) continue;
      for (const b of opsList) {
        if (a === b || !progOut.has(b) || !progOut.has(a)) continue;
        if (cost(a) < cost(b)) continue;
        const ob = progOut.get(b)!;
        let dominated = true;
        let strictlyWorse = cost(a) > cost(b);
        for (const [part, qa] of oa) {
          const qb = ob.get(part) ?? 0;
          if (qb < qa) { dominated = false; break; }
          if (qb > qa) strictlyWorse = true;
        }
        if (ob.size > oa.size) strictlyWorse = true;
        if (dominated && (strictlyWorse || codeOf(a) > codeOf(b))) { progOut.delete(a); break; }
      }
    }
  }

  // How many candidate programs can make each part — scarce parts get extra
  // weight so flexible programs aren't burned early on parts anyone can make.
  const nProducers = new Map<string, number>();
  for (const outs of progOut.values())
    for (const part of outs.keys()) nProducers.set(part, (nProducers.get(part) ?? 0) + 1);

  // Selection portfolio: five deterministic greedy strategies, each trimmed
  // and polished by the remove/repair/add local search; the covering plan
  // with the fewest sheets wins (ties: fewer runs). The original
  // least-extra-parts greedy stays the baseline + fallback.
  const totalRunsOf = (r: Runs) => [...r.values()].reduce((s, x) => s + x, 0);
  const totalOut = (op: string) => {
    let t = 0;
    for (const q of progOut.get(op)?.values() ?? []) t += q;
    return t;
  };
  const scarceUseful = (outs: Map<string, number>, rem: Map<string, number>) => {
    let w = 0;
    for (const [part, qty] of outs) {
      const r = rem.get(part) ?? 0;
      if (r > 0) w += Math.min(r, qty) * (1 + 1 / (nProducers.get(part) ?? 1));
    }
    return w;
  };
  const STRATEGIES: ScoreFn[] = [
    (op, _o, _r, u) => u / totalOut(op), // least extra parts (original)
    (op, _o, _r, u) => u / cost(op), // most covered demand per sheet
    (op, outs, rem) => scarceUseful(outs, rem) / cost(op), // scarcity-weighted per sheet
    (op, outs, rem) => scarceUseful(outs, rem) / totalOut(op), // scarcity-weighted per part
    (op, _o, _r, u) => { const t = totalOut(op); return u / (cost(op) * (1 + (t - u) / t)); }, // per sheet, waste-penalised
  ];

  const baseline = greedySelect(progOutOriginal, leafProduce, (op, _o, _r, u) => {
    let t = 0;
    for (const q of progOutOriginal.get(op)?.values() ?? []) t += q;
    return u / t;
  });
  const sheetsSimple = reportedSheets(baseline, inputsOf);
  let runs: Runs = baseline;
  let runsSheets = sheetsSimple;
  for (const strategy of STRATEGIES) {
    let cand = trimRuns(greedySelect(progOut, leafProduce, strategy), progOut, leafProduce, sheetCost);
    cand = localSearch(cand, progOut, leafProduce, sheetCost, inputsOf);
    if (!coversDemand(cand, progOut, leafProduce)) continue;
    const s = reportedSheets(cand, inputsOf);
    if (s < runsSheets || (s === runsSheets && totalRunsOf(cand) < totalRunsOf(runs))) { runs = cand; runsSheets = s; }
  }

  // 9) full output bundles of the chosen programs -> "other parts".
  // Disjoint operation_id chunks -> fetch concurrently; fullOut is keyed by
  // operation_id so there are no cross-chunk collisions, and per-operation
  // accumulation order is unchanged.
  const selIds = [...runs.keys()];
  const fullOut = new Map<string, Map<string, number>>();
  {
    const chunks: string[][] = [];
    for (let i = 0; i < selIds.length; i += 150) chunks.push(selIds.slice(i, i + 150));
    const results = await Promise.all(
      chunks.map((ids) =>
        supabase.from("operation_outputs").select("operation_id, item_id, qty_per_run").in("operation_id", ids).in("role", ["component", "cut_part"]).gt("qty_per_run", 0),
      ),
    );
    for (const { data } of results)
      for (const o of data ?? []) { if (!o.item_id) continue; const m = fullOut.get(o.operation_id as string) ?? new Map<string, number>(); m.set(o.item_id as string, (m.get(o.item_id as string) ?? 0) + Number(o.qty_per_run)); fullOut.set(o.operation_id as string, m); }
  }

  // Input items (raw sheets) and co-product outputs aren't always in the
  // parts-list `involved` set — fetch code/name for any we haven't loaded yet.
  {
    const missingIds = [
      ...new Set(
        selIds.flatMap((op) => [
          ...(inputsOf.get(op)?.keys() ?? []),
          ...(fullOut.get(op)?.keys() ?? []),
        ]),
      ),
    ].filter((id) => !itemInfo.has(id));
    const chunks: string[][] = [];
    for (let i = 0; i < missingIds.length; i += 150) chunks.push(missingIds.slice(i, i + 150));
    const results = await Promise.all(
      chunks.map((ids) => supabase.from("items").select("id, code, name, category_id, item_type").in("id", ids)),
    );
    for (const { data } of results) for (const it of data ?? []) itemInfo.set(it.id as string, it);
  }

  const plan: PlanProgram[] = [];
  // Global need allocation for the outputs view: each part's need is handed
  // out ONCE across all selected programs (no double counting), crediting the
  // SMALLEST contributors first. Co-products of programs we must run anyway
  // get credit before a dedicated nest, so any surplus shows on the program
  // whose run count is actually the decision (e.g. "makes ×350 · 326 counted").
  const allocated = new Map<string, Map<string, number>>(); // op -> part -> used
  {
    const producersByPart = new Map<string, { op: string; produced: number }[]>();
    for (const [op, r] of runs)
      for (const [part, perRun] of fullOut.get(op) ?? [])
        producersByPart.set(part, [...(producersByPart.get(part) ?? []), { op, produced: perRun * r }]);
    for (const [part, producers] of producersByPart) {
      let rem = leafProduce.get(part) ?? 0;
      producers.sort((a, b) => a.produced - b.produced);
      for (const pr of producers) {
        const used = Math.min(pr.produced, rem);
        rem -= used;
        const m = allocated.get(pr.op) ?? new Map<string, number>();
        m.set(part, Math.round(used));
        allocated.set(pr.op, m);
      }
    }
  }
  for (const [op, r] of [...runs.entries()].sort((a, b) => b[1] - a[1])) {
    const opi = ops.get(op);
    const fout = fullOut.get(op) ?? new Map<string, number>();
    const made = r * [...fout.values()].reduce((s, q) => s + q, 0);
    const outputs: PlanOutput[] = [...fout.entries()]
      .map(([itemId, perRun]) => {
        const produced = Math.round(perRun * r);
        const used = allocated.get(op)?.get(itemId) ?? 0;
        return { code: code(itemId), name: name(itemId), perRun, produced, used };
      })
      .sort((a, b) => b.produced - a.produced);
    // Fall back to the unpruned candidate set: the baseline (fallback) plan
    // may legitimately contain a program that dominance pruning removed.
    const opOuts = progOut.get(op) ?? progOutOriginal.get(op) ?? new Map<string, number>();
    const coverParts = [...opOuts.keys()].filter((p) => leafProduce.has(p));
    const used = coverParts.reduce((s, p) => s + Math.min(leafProduce.get(p)!, r * (opOuts.get(p) ?? 0)), 0);
    // Covers = the NEEDED parts this program actually outputs (its true outputs), each
    // annotated with the finished item(s) it feeds. We deliberately DON'T relabel a shared
    // sub-part as the finished items that consume it — that made a generic cut part (e.g. a
    // guide-shoe plate used by 9 assemblies) look like the program "produces" every one of
    // them, with their full shortfall, which is what confused the plan readers.
    const covers: PlanCover[] = coverParts
      .map((p) => {
        const perRun = opOuts.get(p) ?? 0;
        const qty = Math.min(leafProduce.get(p) ?? 0, r * perRun);
        const feeds: PlanFeed[] = [...(finishedByLeaf.get(p) ?? [])]
          .filter((f) => f !== p) // a finished item is its own leaf — that's "direct", not "feeds"
          .map((f) => ({
            code: short.get(f)!.code,
            name: short.get(f)!.name,
            type: itemType(f),
            category: topCatName(f),
            subCategory: catName(f),
            need: Math.round(short.get(f)!.shortfall),
          }))
          .sort((a, b) => b.need - a.need);
        return {
          code: code(p),
          name: name(p),
          qty: Math.round(qty),
          direct: short.has(p),
          type: itemType(p),
          category: topCatName(p),
          subCategory: catName(p),
          feeds,
        };
      })
      .sort((a, b) => b.qty - a.qty);
    const inputs: PlanInput[] = [...(inputsOf.get(op) ?? new Map<string, number>())]
      .map(([itemId, perRun]) => ({
        code: code(itemId),
        name: name(itemId),
        thicknessMm: sheetThicknessMm(name(itemId)),
        perRun,
        total: Math.ceil(perRun * r),
      }))
      .sort((a, b) => b.total - a.total);
    const mts = (opi.machining_time_seconds as number | null) ?? null;
    const sheetKg = (opi.sheet_weight_kg as number | null) ?? null;
    const scrapKgPerRun = (opi.scrap_weight_kg as number | null) ?? null;
    plan.push({
      code: opi.code, name: opi.name, machine: opi.machine, runs: r,
      machiningTimeSeconds: mts, machineSeconds: mts != null ? Math.round(r * mts) : null,
      scrapPercent: (opi.scrap_percent as number | null) ?? null,
      materialKg: sheetKg != null ? Math.round(r * sheetKg * 10) / 10 : null,
      scrapKg: scrapKgPerRun != null ? Math.round(r * scrapKgPerRun * 10) / 10 : null,
      partsMade: Math.round(made), extra: Math.round(made - used), covers, outputs, inputs,
    });
  }

  const blocked: BlockedItem[] = [];
  for (const f of short.keys()) {
    const st = statusOf.get(f)!;
    if (st.kind !== "blocked") continue;
    const s = short.get(f)!;
    const missing = st.missing.map((l) => {
      const p = pend.get(l);
      const auditProgram = p ? ([...p.keys()].map((o) => ops.get(o)?.code as string).filter(Boolean).sort()[0] ?? null) : null;
      return { code: code(l), auditProgram };
    });
    blocked.push({ code: s.code, name: s.name, type: itemType(f), category: topCatName(f), subCategory: s.category, need: Math.round(s.shortfall), missing });
  }
  blocked.sort((a, b) => b.need - a.need);

  const partsMade = plan.reduce((s, p) => s + p.partsMade, 0);
  const partsNeeded = Math.round([...leafProduce.values()].reduce((s, q) => s + q, 0));
  return {
    cutoffDate: cutoffDate ?? null,
    totals: {
      shortfallItems: short.size,
      makeable: makeable.length,
      blocked: blocked.length,
      programs: runs.size,
      runs: [...runs.values()].reduce((s, r) => s + r, 0),
      partsMade,
      partsNeeded,
      otherParts: partsMade - partsNeeded,
      sheets: runsSheets,
      sheetsSimple,
      machineSeconds: plan.reduce((s, p) => s + (p.machineSeconds ?? 0), 0),
      programsMissingTime: plan.filter((p) => p.machineSeconds == null).length,
      materialKg: Math.round(plan.reduce((s, p) => s + (p.materialKg ?? 0), 0) * 10) / 10,
      scrapKg: Math.round(plan.reduce((s, p) => s + (p.scrapKg ?? 0), 0) * 10) / 10,
      programsMissingScrap: plan.filter((p) => p.scrapKg == null).length,
    },
    plan,
    blocked,
    excluded: excludeCodes,
  };
}
