/**
 * Make-plan OPTIMISER CORE — the owner-tuned, sheet-minimising program-run
 * selection, extracted so BOTH the Programs-to-run page (production-plan.ts) and
 * the Weekly MRP board (mrp-weekly.ts) drive the SAME optimiser and can never
 * disagree. Plain lib (no "use server"): exports the pure helpers the weekly
 * allocator reuses (explodeToLeaves) plus the async core that returns the run
 * set and every intermediate the two presentation layers need.
 *
 * MRP demand is INJECTED (`mrpData`) rather than fetched, so the core runs
 * outside a Next request (the verification script feeds it the uncached MRP).
 */
import { createCacheClient } from "@/lib/supabase/cache-client";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import type { MrpRow } from "@/lib/actions/mrp";

export type OpOuts = Map<string, Map<string, number>>; // op -> part -> qty per run
export type Runs = Map<string, number>;

type ScoreFn = (
  op: string,
  outs: Map<string, number>,
  remaining: Map<string, number>,
  useful: number,
) => number;

/* ------------------------------------------------------------------ *
 * Selection helpers (greedy + trim + local search). Unchanged from the
 * original production-plan.ts implementation — moved here verbatim.
 * ------------------------------------------------------------------ */

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
 * strictly drop.
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

export function coversDemand(runs: Runs, progOut: OpOuts, leafProduce: Map<string, number>): boolean {
  const produced = new Map<string, number>();
  for (const [op, r] of runs) for (const [part, qty] of progOut.get(op) ?? []) produced.set(part, (produced.get(part) ?? 0) + qty * r);
  for (const [part, need] of leafProduce) if ((produced.get(part) ?? 0) < need - 1e-9) return false;
  return true;
}

/** Reported sheet total, per-item ceil like the UI. A program with NO recorded
 *  inputs counts as 1 sheet/run — same as the selection's sheetCost default. */
export function reportedSheets(runs: Runs, inputsOf: Map<string, Map<string, number>>): number {
  let s = 0;
  for (const [op, r] of runs) {
    const ins = inputsOf.get(op);
    if (!ins || ins.size === 0) { s += r; continue; }
    for (const [, perRun] of ins) s += Math.ceil(perRun * r);
  }
  return s;
}

/**
 * Topo explosion: finished-item shortfall → leaf production needs (for leaves
 * matching `collectLeaf`), stock netted at every level. The SAME explosion the
 * optimiser uses for its global `leafProduce` (collectLeaf = isMakeLeaf); the
 * weekly layer also calls it per-week with cumulative finished shortfall to
 * derive each leaf's per-week cumulative demand, and with a trade predicate to
 * derive the purchased (trade-leaf) buy list. `topo` must be a topological order
 * over all items reachable from the finished set (parents before children).
 */
export function explodeToLeaves(
  finishedShortfall: Map<string, number>,
  topo: string[],
  partsOf: Map<string, { child: string; qty: number }[]>,
  stock: Map<string, number>,
  collectLeaf: (id: string) => boolean,
): Map<string, number> {
  const demand = new Map<string, number>();
  for (const [f, sf] of finishedShortfall) demand.set(f, (demand.get(f) ?? 0) + sf + (stock.get(f) ?? 0)); // gross = shortfall + stock so produce nets back to shortfall
  const leafProduce = new Map<string, number>();
  for (const it of topo) {
    const prod = Math.max(0, (demand.get(it) ?? 0) - (stock.get(it) ?? 0));
    if (prod <= 0) continue;
    const kids = partsOf.get(it) ?? [];
    if (kids.length) for (const { child, qty } of kids) demand.set(child, (demand.get(child) ?? 0) + prod * qty);
    else if (collectLeaf(it)) leafProduce.set(it, (leafProduce.get(it) ?? 0) + prod);
  }
  return leafProduce;
}

export interface MakePlanCore {
  empty: boolean;
  short: Map<string, { shortfall: number; code: string; name: string; category: string }>;
  makeable: string[];
  statusOf: Map<string, { kind: string; missing: string[] }>;
  pend: Map<string, Map<string, number>>;
  partsOf: Map<string, { child: string; qty: number }[]>;
  topo: string[];
  stock: Map<string, number>;
  itemInfo: Map<string, any>;
  catProc: Map<string, { name: string | null; procurement_type: string | null; parent_id: string | null }>;
  ops: Map<string, any>;
  leafProduce: Map<string, number>;
  progOut: OpOuts;
  progOutOriginal: OpOuts;
  inputsOf: Map<string, Map<string, number>>;
  fullOut: Map<string, Map<string, number>>;
  finishedByLeaf: Map<string, Set<string>>;
  runs: Runs;
  runsSheets: number;
  sheetsSimple: number;
}

const EMPTY_CORE: Omit<MakePlanCore, "empty"> = {
  short: new Map(), makeable: [], statusOf: new Map(), pend: new Map(), partsOf: new Map(),
  topo: [], stock: new Map(), itemInfo: new Map(), catProc: new Map(), ops: new Map(),
  leafProduce: new Map(), progOut: new Map(), progOutOriginal: new Map(), inputsOf: new Map(),
  fullOut: new Map(), finishedByLeaf: new Map(), runs: new Map(), runsSheets: 0, sheetsSimple: 0,
};

/**
 * Run the optimiser for one demand snapshot. `mrpData` is the already-computed
 * MRP (make/trade shortfall per item) — caller injects `getMrpData(cutoff)`.
 */
export async function computeMakePlanCore(
  excludeCodes: string[],
  mrpData: MrpRow[],
): Promise<MakePlanCore> {
  const supabase = createCacheClient();

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

  const catProcPromise = (async () => {
    const catProc = new Map<string, { name: string | null; procurement_type: string | null; parent_id: string | null }>();
    const { data } = await supabase.from("item_categories").select("id, name, procurement_type, parent_id");
    for (const c of data ?? []) catProc.set(c.id as string, { name: c.name as string, procurement_type: c.procurement_type as string | null, parent_id: (c.parent_id as string | null) ?? null });
    return catProc;
  })();

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

  // 1) Make shortfall from the injected MRP calc
  const short = new Map<string, { shortfall: number; code: string; name: string; category: string }>();
  for (const r of mrpData) {
    if (r.procurement_type === "make" && r.shortfall > 0)
      short.set(r.item_id, { shortfall: r.shortfall, code: r.item_code, name: r.item_name, category: r.category_name ?? "(none)" });
  }
  if (short.size === 0) {
    await Promise.all([partsOfPromise, catProcPromise, opsPromise]);
    return { empty: true, ...EMPTY_CORE };
  }

  const partsOf = await partsOfPromise;

  // involved items = shortfall finished + all parts-list descendants
  const involved = new Set<string>(short.keys());
  const stack = [...short.keys()];
  while (stack.length) {
    const it = stack.pop() as string;
    for (const { child } of partsOf.get(it) ?? []) if (!involved.has(child)) { involved.add(child); stack.push(child); }
  }
  const invIds = [...involved];

  const itemInfo = new Map<string, any>();
  const stock = new Map<string, number>();
  {
    const chunks: string[][] = [];
    for (let i = 0; i < invIds.length; i += 150) chunks.push(invIds.slice(i, i + 150));
    const [itemResults, stockResults] = await Promise.all([
      Promise.all(chunks.map((ids) => supabase.from("items").select("id, code, name, category_id, procurement_type, stock_behaviour, item_type").in("id", ids))),
      Promise.all(chunks.map((ids) => supabase.from("inventory").select("item_id, quantity").in("item_id", ids))),
    ]);
    for (const { data, error } of itemResults) { if (error) throw error; for (const it of data ?? []) itemInfo.set(it.id as string, it); }
    for (const { data, error } of stockResults) { if (error) throw error; for (const v of data ?? []) stock.set(v.item_id as string, (stock.get(v.item_id as string) ?? 0) + Number(v.quantity || 0)); }
  }
  const catProc = await catProcPromise;
  const effProc = (id: string) => {
    const it = itemInfo.get(id) ?? {};
    return it.procurement_type ?? (it.category_id ? catProc.get(it.category_id)?.procurement_type : null) ?? null;
  };
  const isMakeLeaf = (id: string) => effProc(id) !== "trade";

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

  const finishedByLeaf = new Map<string, Set<string>>();
  for (const f of makeable) {
    for (const l of leavesOf(f)) {
      if (!isMakeLeaf(l)) continue;
      const set = finishedByLeaf.get(l) ?? new Set<string>();
      set.add(f);
      finishedByLeaf.set(l, set);
    }
  }

  // topo order over items reachable from makeable finished items
  const seed = new Set<string>();
  { const st = [...makeable]; while (st.length) { const it = st.pop() as string; if (seed.has(it)) continue; seed.add(it); for (const { child } of partsOf.get(it) ?? []) st.push(child); } }
  const indeg = new Map<string, number>(); for (const it of seed) indeg.set(it, 0);
  for (const it of seed) for (const { child } of partsOf.get(it) ?? []) if (seed.has(child)) indeg.set(child, (indeg.get(child) ?? 0) + 1);
  const queue = [...seed].filter((it) => indeg.get(it) === 0); const topo: string[] = [];
  while (queue.length) { const it = queue.shift() as string; topo.push(it); for (const { child } of partsOf.get(it) ?? []) if (seed.has(child)) { indeg.set(child, indeg.get(child)! - 1); if (indeg.get(child) === 0) queue.push(child); } }

  const leafProduce = explodeToLeaves(
    new Map(makeable.map((f) => [f, short.get(f)!.shortfall])),
    topo, partsOf, stock, isMakeLeaf,
  );

  // candidate programs for the needed parts
  const progOut: OpOuts = new Map();
  for (const part of leafProduce.keys()) for (const [op, qty] of aud.get(part) ?? []) { const m = progOut.get(op) ?? new Map<string, number>(); m.set(part, qty); progOut.set(op, m); }

  const inputsOf = new Map<string, Map<string, number>>();
  {
    const candIds = [...progOut.keys()];
    const chunks: string[][] = [];
    for (let i = 0; i < candIds.length; i += 150) chunks.push(candIds.slice(i, i + 150));
    const results = await Promise.all(
      chunks.map((ids) => supabase.from("operation_inputs").select("operation_id, item_id, qty_per_run").in("operation_id", ids).gt("qty_per_run", 0)),
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

  const progOutOriginal: OpOuts = new Map([...progOut.entries()].map(([k, v]) => [k, new Map(v)]));

  // Dominance preprocessing
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

  const nProducers = new Map<string, number>();
  for (const outs of progOut.values())
    for (const part of outs.keys()) nProducers.set(part, (nProducers.get(part) ?? 0) + 1);

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
    (op, _o, _r, u) => u / totalOut(op),
    (op, _o, _r, u) => u / cost(op),
    (op, outs, rem) => scarceUseful(outs, rem) / cost(op),
    (op, outs, rem) => scarceUseful(outs, rem) / totalOut(op),
    (op, _o, _r, u) => { const t = totalOut(op); return u / (cost(op) * (1 + (t - u) / t)); },
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

  // full output bundles of the chosen programs
  const selIds = [...runs.keys()];
  const fullOut = new Map<string, Map<string, number>>();
  {
    const chunks: string[][] = [];
    for (let i = 0; i < selIds.length; i += 150) chunks.push(selIds.slice(i, i + 150));
    const results = await Promise.all(
      chunks.map((ids) => supabase.from("operation_outputs").select("operation_id, item_id, qty_per_run").in("operation_id", ids).in("role", ["component", "cut_part"]).gt("qty_per_run", 0)),
    );
    for (const { data } of results)
      for (const o of data ?? []) { if (!o.item_id) continue; const m = fullOut.get(o.operation_id as string) ?? new Map<string, number>(); m.set(o.item_id as string, (m.get(o.item_id as string) ?? 0) + Number(o.qty_per_run)); fullOut.set(o.operation_id as string, m); }
  }

  // code/name for input + co-product items not in the involved set
  {
    const missingIds = [
      ...new Set(selIds.flatMap((op) => [...(inputsOf.get(op)?.keys() ?? []), ...(fullOut.get(op)?.keys() ?? [])])),
    ].filter((id) => !itemInfo.has(id));
    const chunks: string[][] = [];
    for (let i = 0; i < missingIds.length; i += 150) chunks.push(missingIds.slice(i, i + 150));
    const results = await Promise.all(
      chunks.map((ids) => supabase.from("items").select("id, code, name, category_id, item_type").in("id", ids)),
    );
    for (const { data } of results) for (const it of data ?? []) itemInfo.set(it.id as string, it);
  }

  return {
    empty: false,
    short, makeable, statusOf, pend, partsOf, topo, stock, itemInfo, catProc, ops,
    leafProduce, progOut, progOutOriginal, inputsOf, fullOut, finishedByLeaf,
    runs, runsSheets, sheetsSimple,
  };
}
