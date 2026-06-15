"use server";

/**
 * WEEKLY MRP PLAN — the same MRP, broken into an Overdue lane + the next 8
 * Sunday-start weeks (Sun–Sat) so the team can plan week by week. MRP is
 * CUMULATIVE: the plan "by end of week N" covers every job due on/before that week.
 *
 * The hard rule (owner): do NOT optimise each week separately — that
 * over-provisions. Instead the sheet-minimising optimiser runs ONCE on the full
 * 8-week demand (computeMakePlanCore), and those globally-minimal runs are
 * ALLOCATED to weeks by deadline. Σ(weekly runs) === the one global optimum, so
 * there's zero over-provisioning; the split is pure sequencing. One optimiser
 * pass + cheap in-memory bucketing → no per-week blow-up.
 *
 * Scope = strictly the 8 weeks: jobs due after the horizon, or with no Req.
 * Dispatch date, are excluded from the plan (surfaced as a muted count).
 */
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { dispatchPhaseOf } from "@/lib/bom/bom-sections";
import { computeMakePlanCore, explodeToLeaves } from "@/lib/actions/make-plan-core";
import { _getOutstandingLinesUncached } from "@/lib/actions/po-outstanding";
import type { MrpRow } from "@/lib/actions/mrp";

const HORIZON_WEEKS = 8; // this week (w0) + 7 more
const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface WeekMeta {
  index: number; // -1 = Overdue, 0..7 = weeks
  key: string;
  label: string; // chart axis
  title: string; // section heading
  subtitle: string;
  weekStartIso: string | null;
  isCurrent: boolean;
  isOverdue: boolean;
}
export interface WeeklyItemRow {
  item_id: string;
  code: string;
  name: string;
  uom: string | null;
  category: string | null;
  procurement_type: "make" | "trade" | null;
  perWeek: number[]; // incremental shortfall per bucket
  cumulative: number[]; // cumulative shortfall by end of bucket
  total: number; // = cumulative[last]
}
export interface WeeklyProgramRow {
  program_id: string;
  code: string;
  name: string;
  machine: string;
  runsPerWeek: number[];
  cumulativeRuns: number[];
  totalRuns: number;
  machiningTimeSeconds: number | null;
  inputs: { code: string; name: string; thicknessMm: number | null; perRun: number }[];
  outputs: { code: string; name: string; perRun: number }[];
}
export interface WeeklyBuyRow {
  item_id: string;
  code: string;
  name: string;
  thicknessMm: number | null;
  perWeek: number[];
  cumulative: number[];
  total: number;
}
export interface WeeklyMrpPlan {
  generatedAt: string;
  horizonEnd: string;
  weeks: WeekMeta[];
  make: WeeklyItemRow[];
  trade: WeeklyItemRow[];
  programs: WeeklyProgramRow[];
  buy: WeeklyBuyRow[]; // raw sheets for the programs, by week
  blocked: { code: string; name: string; need: number }[];
  totals: {
    globalRuns: number;
    globalSheets: number;
    allocatedRuns: number; // === globalRuns (zero-over-provisioning proof)
    makeShortfallItems: number;
    tradeShortfallItems: number;
  };
  laterCount: number; // in-production jobs due after the horizon
  undatedCount: number; // in-production jobs with no Req. Dispatch date
  excluded: string[];
}

// ── date helpers (calendar-date space; "today" in IST, the business tz) ──────
function istToday(): Date {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function startOfWeekSunday(d: Date): Date {
  const dow = d.getUTCDay(); // Sun=0 … Sat=6
  return new Date(d.getTime() - dow * DAY_MS);
}
function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
/** Compact inclusive date range, e.g. "14–20 Jun" or cross-month "29 Jun – 5 Jul". */
function fmtRange(start: Date, end: Date): string {
  const sm = MONTHS[start.getUTCMonth()];
  const em = MONTHS[end.getUTCMonth()];
  return sm === em
    ? `${start.getUTCDate()}–${end.getUTCDate()} ${sm}`
    : `${start.getUTCDate()} ${sm} – ${end.getUTCDate()} ${em}`;
}
function sheetThicknessMm(name: string): number | null {
  const dims = /\d{3,4}\s*[xX]\s*\d{3,4}\s*[xX]\s*(\d+(?:\.\d+)?)\s*mm/.exec(name);
  if (dims) return parseFloat(dims[1]);
  const loose = /(\d+(?:\.\d+)?)\s*mm\b/i.exec(name);
  return loose ? parseFloat(loose[1]) : null;
}

/** The bucket lanes (Overdue + 8 weeks) and their display metadata. */
function buildWeeks(today: Date, curWeek: Date): WeekMeta[] {
  const weeks: WeekMeta[] = [
    {
      index: -1, key: "overdue", label: "Overdue", title: "Overdue",
      subtitle: "Req. Dispatch date already passed", weekStartIso: null,
      isCurrent: false, isOverdue: true,
    },
  ];
  for (let w = 0; w < HORIZON_WEEKS; w++) {
    const start = new Date(curWeek.getTime() + w * 7 * DAY_MS);
    const end = new Date(start.getTime() + 6 * DAY_MS);
    const range = fmtRange(start, end); // "14–20 Jun" (Sun–Sat)
    weeks.push({
      index: w,
      key: `w${w}`,
      label: range,
      title: range,
      subtitle: w === 0 ? "This week" : w === 1 ? "Next week" : `In ${w} weeks`,
      weekStartIso: ymd(start),
      isCurrent: w === 0,
      isOverdue: false,
    });
  }
  return weeks;
}

interface ItemMeta {
  code: string;
  name: string;
  item_type: string;
  uom: string | null;
  category_name: string | null;
  procurement_type: "make" | "trade" | null;
  stock: number;
}
interface LoadedDemand {
  weeks: WeekMeta[];
  N: number;
  horizonEnd: string;
  today: Date;
  curWeek: Date;
  demandByItemWeek: Map<string, number[]>; // net-of-dispatch demand per (item, bucket pos)
  itemMeta: Map<string, ItemMeta>;
  laterCount: number;
  undatedCount: number;
}

/**
 * Per-(item, week) net demand. Mirrors getMrpData's netting EXACTLY (in-production
 * jobs, requirement-stage scope, dispatch netting per BOM line), but keyed by the
 * job's Req. Dispatch week instead of collapsed to a single total. Cutoff =
 * horizon end, so Σ_weeks === getMrpData(horizonEnd).total_required.
 */
// exported for scripts/verify-weekly-mrp.ts (read-only helpers)
export async function loadWeeklyDemand(): Promise<LoadedDemand> {
  const supabase = createCacheClient();
  const today = istToday();
  const curWeek = startOfWeekSunday(today);
  const weeks = buildWeeks(today, curWeek);
  const N = weeks.length; // Overdue + 8
  const pos = (bucket: number) => bucket + 1; // bucket -1 → 0, w0 → 1 …
  const horizonEndDate = new Date(curWeek.getTime() + (HORIZON_WEEKS * 7 - 1) * DAY_MS); // end of w7
  const horizonEnd = ymd(horizonEndDate);

  const jobs = await fetchAllRanged<{ id: string; requirement_stage: string | null; requirement_dispatch_date: string | null }>(
    (from, to, withCount) =>
      supabase
        .from("jobs")
        .select("id, requirement_stage, requirement_dispatch_date", withCount ? { count: "exact" } : {})
        .eq("status", "in_production")
        .range(from, to),
  );

  let laterCount = 0;
  let undatedCount = 0;
  const stageByJob = new Map<string, string>();
  const bucketByJob = new Map<string, number>(); // bucket index (-1..7), in-scope jobs only
  for (const j of jobs) {
    const d = j.requirement_dispatch_date ? parseDate(j.requirement_dispatch_date) : null;
    if (!d) { undatedCount++; continue; }
    if (d.getTime() > horizonEndDate.getTime()) { laterCount++; continue; }
    const bucket = d.getTime() < today.getTime()
      ? -1
      : Math.floor((startOfWeekSunday(d).getTime() - curWeek.getTime()) / (7 * DAY_MS));
    stageByJob.set(j.id, j.requirement_stage ?? "new");
    bucketByJob.set(j.id, Math.min(7, Math.max(-1, bucket)));
  }

  const empty: LoadedDemand = { weeks, N, horizonEnd, today, curWeek, demandByItemWeek: new Map(), itemMeta: new Map(), laterCount, undatedCount };
  if (stageByJob.size === 0) return empty;
  const prodJobIds = [...stageByJob.keys()];

  // dispatched-so-far per BOM line (whole table; identical to getMrpData)
  const dispatchedByLine = new Map<string, number>();
  {
    const rows = await fetchAllRanged<{ job_bom_line_id: string; qty: number }>((from, to, withCount) =>
      supabase.from("job_dispatch_lines").select("job_bom_line_id, qty", withCount ? { count: "exact" } : {}).not("job_bom_line_id", "is", null).range(from, to),
    );
    for (const d of rows) dispatchedByLine.set(d.job_bom_line_id, (dispatchedByLine.get(d.job_bom_line_id) ?? 0) + (Number(d.qty) || 0));
  }

  // header → job
  const headerToJob = new Map<string, string>();
  {
    const chunks: string[][] = [];
    for (let i = 0; i < prodJobIds.length; i += 200) chunks.push(prodJobIds.slice(i, i + 200));
    const results = await Promise.all(chunks.map((ids) => supabase.from("job_bom_headers").select("id, job_id").in("job_id", ids)));
    for (const { data, error } of results) { if (error) throw error; for (const h of data ?? []) headerToJob.set(h.id as string, h.job_id as string); }
  }
  if (headerToJob.size === 0) return empty;

  const allLines: any[] = await fetchAllRanged((from, to, withCount) =>
    supabase
      .from("job_bom_lines")
      .select("id, item_id, required_quantity, job_bom_id, category", withCount ? { count: "exact" } : {})
      .in("job_bom_id", [...headerToJob.keys()])
      .not("item_id", "is", null)
      .gt("required_quantity", 0)
      .range(from, to),
  );

  // accumulate net demand per (item, bucket-pos)
  const demandByItemWeek = new Map<string, number[]>();
  for (const line of allLines) {
    const jobId = headerToJob.get(line.job_bom_id);
    const bucket = jobId !== undefined ? bucketByJob.get(jobId) : undefined;
    if (bucket === undefined) continue; // job out of scope (later / undated)
    const stage = jobId ? stageByJob.get(jobId) : undefined;
    if (!stage || stage === "new") continue;
    if (stage === "first_phase" && dispatchPhaseOf((line.category as string) ?? "") !== "first") continue;
    const required = Number(line.required_quantity) || 0;
    const dispatched = dispatchedByLine.get(line.id) ?? 0;
    const qty = Math.max(0, required - dispatched);
    if (qty <= 0) continue;
    const arr = demandByItemWeek.get(line.item_id) ?? new Array(N).fill(0);
    arr[pos(bucket)] += qty;
    demandByItemWeek.set(line.item_id, arr);
  }

  // Component-demand rules (e.g. guide shoes per safety frame): a child is needed
  // `qty` per demanded PARENT. Apply per week off the parent's job-BOM demand so the
  // weekly make-plan schedules the children's programs too — mirrors getMrpData's
  // addComponentRuleDemand, just bucketed by Req.-Dispatch week. Single pass: build
  // all additions off the un-mutated parent demand (children aren't re-expanded as
  // parents), then fold them in. These rules are NOT item_bom_lines, so the
  // optimiser's parts-list explosion never re-derives them — no double-count.
  {
    const rules = await fetchAllRanged<{ parent_item_id: string; child_item_id: string; qty: number }>(
      (from, to, withCount) =>
        supabase
          .from("item_demand_rules")
          .select("parent_item_id, child_item_id, qty", withCount ? { count: "exact" } : {})
          .range(from, to),
    );
    const additions = new Map<string, number[]>();
    for (const r of rules) {
      const parentArr = demandByItemWeek.get(r.parent_item_id);
      const q = Number(r.qty) || 0;
      if (!parentArr || q <= 0) continue;
      const add = additions.get(r.child_item_id) ?? new Array(N).fill(0);
      for (let i = 0; i < N; i++) add[i] += parentArr[i] * q;
      additions.set(r.child_item_id, add);
    }
    for (const [child, add] of additions) {
      const arr = demandByItemWeek.get(child) ?? new Array(N).fill(0);
      for (let i = 0; i < N; i++) arr[i] += add[i];
      demandByItemWeek.set(child, arr);
    }
  }

  if (demandByItemWeek.size === 0) return empty;

  // item meta + stock for every demanded item (same shape as getMrpData)
  const itemMeta = new Map<string, ItemMeta>();
  {
    const ids = [...demandByItemWeek.keys()];
    const batches = [];
    for (let i = 0; i < ids.length; i += 200) {
      batches.push(
        supabase
          .from("items")
          .select(`id, code, name, item_type, procurement_type, category:item_categories!items_category_id_fkey(name, procurement_type), uom:units_of_measurement(abbreviation), inventory(quantity)`)
          .in("id", ids.slice(i, i + 200)),
      );
    }
    const results = await Promise.all(batches);
    for (const r of results) {
      if (r.error) throw r.error;
      for (const item of r.data ?? []) {
        const stock = (item.inventory ?? []).reduce((s: number, inv: { quantity: number }) => s + Number(inv.quantity), 0);
        const cat = Array.isArray(item.category) ? item.category[0] : item.category;
        const uom = Array.isArray(item.uom) ? item.uom[0] : item.uom;
        const procurement_type: "make" | "trade" | null =
          (item.procurement_type as "make" | "trade" | null) ?? ((cat?.procurement_type ?? null) as "make" | "trade" | null);
        itemMeta.set(item.id as string, {
          code: item.code as string, name: item.name as string, item_type: item.item_type as string,
          uom: (uom?.abbreviation as string) ?? null, category_name: (cat?.name as string) ?? null, procurement_type, stock,
        });
      }
    }
  }

  return { weeks, N, horizonEnd, today, curWeek, demandByItemWeek, itemMeta, laterCount, undatedCount };
}

/** Running cumulative shortfall per bucket = max(0, cumGross − stock − cumOnOrder).
 *  Stock and incoming PO material are both applied to the earliest weeks they're
 *  available. `onOrder` is per-bucket incoming PO qty (empty = no POs). Returns
 *  { cumulative, incremental }. */
function cumulativeShortfall(
  demand: number[],
  stock: number,
  onOrder: number[] = [],
): { cumulative: number[]; incremental: number[] } {
  const cumulative: number[] = [];
  let cg = 0;
  let coo = 0;
  for (let i = 0; i < demand.length; i++) {
    cg += demand[i];
    coo += onOrder[i] ?? 0;
    cumulative.push(Math.max(0, cg - stock - coo));
  }
  const incremental = cumulative.map((c, i) => (i === 0 ? c : c - cumulative[i - 1]));
  return { cumulative, incremental };
}

const emptyPlan = (l: LoadedDemand, excluded: string[]): WeeklyMrpPlan => ({
  generatedAt: new Date().toISOString(),
  horizonEnd: l.horizonEnd,
  weeks: l.weeks,
  make: [], trade: [], programs: [], buy: [], blocked: [],
  totals: { globalRuns: 0, globalSheets: 0, allocatedRuns: 0, makeShortfallItems: 0, tradeShortfallItems: 0 },
  laterCount: l.laterCount, undatedCount: l.undatedCount, excluded,
});

export async function _getWeeklyUncached(excludeCodes: string[] = []): Promise<WeeklyMrpPlan> {
  const l = await loadWeeklyDemand();
  if (l.demandByItemWeek.size === 0) return emptyPlan(l, excludeCodes);
  const N = l.N;

  // Time-phase outstanding POs into arrival buckets (pos 0 = overdue/now …
  // N-1 = last week). No expected date (or already due) => arrives now (pos 0,
  // covers the nearest demand); beyond the horizon => ignored (too late to help
  // in-window). Make items carry no POs, so this only affects the Trade lane.
  const onOrderByItemWeek = new Map<string, number[]>();
  {
    const ooLines = await _getOutstandingLinesUncached();
    for (const ln of ooLines) {
      let pos = 0;
      if (ln.expected_date) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ln.expected_date);
        if (m) {
          const d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
          const w = Math.floor((d - l.curWeek.getTime()) / (7 * DAY_MS));
          if (w >= HORIZON_WEEKS) continue; // arrives after the horizon
          pos = w < 0 ? 0 : w + 1;
        }
      }
      const arr = onOrderByItemWeek.get(ln.item_id) ?? new Array(N).fill(0);
      arr[pos] += ln.on_order;
      onOrderByItemWeek.set(ln.item_id, arr);
    }
  }

  // Make / Trade weekly item rows (cumulative shortfall, stock + incoming POs
  // applied to the earliest weeks they're available).
  const itemRows = (want: "make" | "trade"): WeeklyItemRow[] => {
    const rows: WeeklyItemRow[] = [];
    for (const [id, m] of l.itemMeta) {
      if (m.procurement_type !== want) continue;
      const { cumulative, incremental } = cumulativeShortfall(l.demandByItemWeek.get(id)!, m.stock, onOrderByItemWeek.get(id) ?? []);
      const total = cumulative[N - 1];
      if (total <= 0) continue;
      rows.push({ item_id: id, code: m.code, name: m.name, uom: m.uom, category: m.category_name, procurement_type: m.procurement_type, perWeek: incremental, cumulative, total });
    }
    rows.sort((a, b) => b.total - a.total);
    return rows;
  };
  const make = itemRows("make");
  const trade = itemRows("trade");

  // Optimise ONCE on the full-horizon demand. Build the MRP rows from the loader
  // (Σ over weeks) so the optimiser sees exactly the same demand as the board.
  const mrpRows: MrpRow[] = [...l.itemMeta].map(([id, m]) => {
    const total = l.demandByItemWeek.get(id)!.reduce((s, x) => s + x, 0);
    return {
      item_id: id, item_code: m.code, item_name: m.name, item_type: m.item_type,
      category_name: m.category_name, uom_abbreviation: m.uom, total_required: total,
      total_stock: m.stock, shortfall: Math.max(0, total - m.stock),
      // PO netting is applied to the trade lane separately (Phase C); the
      // optimiser input only uses shortfall, so on_order is 0 here.
      on_order: 0, to_buy: Math.max(0, total - m.stock),
      job_count: 0, procurement_type: m.procurement_type,
    };
  });
  const core = await computeMakePlanCore(excludeCodes, mrpRows);

  const blocked = [...core.statusOf.entries()]
    .filter(([, st]) => st.kind === "blocked")
    .map(([f]) => ({ code: core.short.get(f)!.code, name: core.short.get(f)!.name, need: Math.round(core.short.get(f)!.shortfall) }))
    .sort((a, b) => b.need - a.need);

  const globalRuns = [...core.runs.values()].reduce((s, r) => s + r, 0);
  if (core.empty || core.runs.size === 0) {
    return {
      ...emptyPlan(l, excludeCodes), make, trade, blocked,
      totals: { globalRuns, globalSheets: core.runsSheets, allocatedRuns: 0, makeShortfallItems: make.length, tradeShortfallItems: trade.length },
    };
  }

  const isMakeLeaf = (id: string) => {
    const it = core.itemInfo.get(id) ?? {};
    const proc = it.procurement_type ?? (it.category_id ? core.catProc.get(it.category_id)?.procurement_type : null) ?? null;
    return proc !== "trade";
  };

  // Per-(leaf, bucket) CUMULATIVE demand: explode the cumulative makeable-finished
  // shortfall at each bucket (same explosion the optimiser used for leafProduce).
  const makeableCum = new Map<string, number[]>();
  for (const f of core.makeable) {
    const dem = l.demandByItemWeek.get(f) ?? new Array(N).fill(0);
    makeableCum.set(f, cumulativeShortfall(dem, core.stock.get(f) ?? 0).cumulative);
  }
  const leafCumDemand = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    const finishedShort = new Map<string, number>();
    for (const f of core.makeable) { const cs = makeableCum.get(f)![i]; if (cs > 0) finishedShort.set(f, cs); }
    const leaves = explodeToLeaves(finishedShort, core.topo, core.partsOf, core.stock, isMakeLeaf);
    for (const [leaf, q] of leaves) {
      const arr = leafCumDemand.get(leaf) ?? new Array(N).fill(0);
      arr[i] = q;
      leafCumDemand.set(leaf, arr);
    }
  }

  // ── Allocate the optimum's runs to buckets by earliest deadline ───────────
  // Whole, indivisible runs; smallest-producer-first (surplus lands on the run
  // whose count is the real decision — the 436A philosophy). Co-products credit
  // every part the run makes, so they carry into later buckets.
  const remaining = new Map(core.runs);
  const assigned = new Map<string, number[]>();
  const producedCum = new Map<string, number>();
  const perRunOf = (op: string, leaf: string) => core.fullOut.get(op)?.get(leaf) ?? 0;
  const opIds = [...core.runs.keys()];
  for (let i = 0; i < N; i++) {
    for (const [leaf, cumArr] of [...leafCumDemand.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      let deficit = cumArr[i] - (producedCum.get(leaf) ?? 0);
      if (deficit <= 1e-9) continue;
      const cands = opIds
        .filter((op) => (remaining.get(op) ?? 0) > 0 && perRunOf(op, leaf) > 0)
        .sort((a, b) => perRunOf(a, leaf) - perRunOf(b, leaf) || a.localeCompare(b));
      for (const op of cands) {
        if (deficit <= 1e-9) break;
        const per = perRunOf(op, leaf);
        const take = Math.min(Math.ceil(deficit / per), remaining.get(op)!);
        if (take <= 0) continue;
        const arr = assigned.get(op) ?? new Array(N).fill(0);
        arr[i] += take;
        assigned.set(op, arr);
        remaining.set(op, remaining.get(op)! - take);
        for (const [part, perRun] of core.fullOut.get(op) ?? []) producedCum.set(part, (producedCum.get(part) ?? 0) + take * perRun);
        deficit -= take * per;
      }
    }
  }
  // pure-surplus runs (output only ever a co-product already covered) → last week
  for (const [op, rem] of remaining) {
    if (rem > 0) { const arr = assigned.get(op) ?? new Array(N).fill(0); arr[N - 1] += rem; assigned.set(op, arr); }
  }

  // ── Programs by week ──────────────────────────────────────────────────────
  const code = (id: string) => (core.itemInfo.get(id)?.code as string) ?? id;
  const name = (id: string) => (core.itemInfo.get(id)?.name as string) ?? "";
  const cum = (arr: number[]) => { const out: number[] = []; let s = 0; for (const v of arr) { s += v; out.push(s); } return out; };

  const programs: WeeklyProgramRow[] = [];
  let allocatedRuns = 0;
  for (const op of opIds) {
    const arr = assigned.get(op) ?? new Array(N).fill(0);
    const totalRuns = arr.reduce((s, x) => s + x, 0);
    if (totalRuns <= 0) continue;
    allocatedRuns += totalRuns;
    const opi = core.ops.get(op);
    programs.push({
      program_id: op,
      code: (opi?.code as string) ?? op,
      name: (opi?.name as string) ?? "",
      machine: (opi?.machine as string) ?? "",
      runsPerWeek: arr,
      cumulativeRuns: cum(arr),
      totalRuns,
      machiningTimeSeconds: (opi?.machining_time_seconds as number | null) ?? null,
      inputs: [...(core.inputsOf.get(op) ?? new Map<string, number>())].map(([itemId, perRun]) => ({ code: code(itemId), name: name(itemId), thicknessMm: sheetThicknessMm(name(itemId)), perRun })).sort((a, b) => b.perRun - a.perRun),
      outputs: [...(core.fullOut.get(op) ?? new Map<string, number>())].map(([itemId, perRun]) => ({ code: code(itemId), name: name(itemId), perRun })).sort((a, b) => b.perRun - a.perRun),
    });
  }
  // earliest week first, then bigger jobs
  const firstWeek = (r: WeeklyProgramRow) => r.runsPerWeek.findIndex((v) => v > 0);
  programs.sort((a, b) => firstWeek(a) - firstWeek(b) || b.totalRuns - a.totalRuns);

  // ── Buy list = raw sheets the allocated runs consume, by week ─────────────
  const sheetWeek = new Map<string, number[]>();
  for (const op of opIds) {
    const arr = assigned.get(op);
    if (!arr) continue;
    for (const [itemId, perRun] of core.inputsOf.get(op) ?? []) {
      const s = sheetWeek.get(itemId) ?? new Array(N).fill(0);
      for (let i = 0; i < N; i++) s[i] += arr[i] * perRun;
      sheetWeek.set(itemId, s);
    }
  }
  const buy: WeeklyBuyRow[] = [...sheetWeek.entries()]
    .map(([itemId, perWeek]) => {
      const cumulative = cum(perWeek);
      return { item_id: itemId, code: code(itemId), name: name(itemId), thicknessMm: sheetThicknessMm(name(itemId)), perWeek, cumulative, total: cumulative[N - 1] };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  return {
    generatedAt: new Date().toISOString(),
    horizonEnd: l.horizonEnd,
    weeks: l.weeks,
    make, trade, programs, buy, blocked,
    totals: { globalRuns, globalSheets: core.runsSheets, allocatedRuns, makeShortfallItems: make.length, tradeShortfallItems: trade.length },
    laterCount: l.laterCount, undatedCount: l.undatedCount, excluded: excludeCodes,
  };
}

export async function getWeeklyMrpPlan(excludeCodes?: string[]): Promise<WeeklyMrpPlan> {
  const excl = [...new Set((excludeCodes ?? []).map((c) => c.trim()).filter(Boolean))].sort();
  return unstable_cache(_getWeeklyUncached, ["weekly-mrp-plan", excl.join("§")], {
    revalidate: 1800,
    tags: ["jobs", "bom-lines", "items", "inventory-stock", "operations"],
  })(excl);
}
