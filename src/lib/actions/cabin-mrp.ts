"use server";

/**
 * CABIN MRP — the three /mrp/cabin views (Requirements / Programs to run / Weekly).
 *
 * Rebuilt 2026-07-03. All three read cabin-job demand and share ONE eligibility
 * rule (getEligibleCabinJobs). "Programs to run" additionally plans against the
 * entire audited-programs universe (see getCabinMrp) with the locked selectRuns.
 *
 * DEMAND ELIGIBILITY (owner rule, 2026-07-03): a cabin job's items count as cabin
 * cutting demand ONLY if
 *   - the cabin job is NOT marked ready (Cabin Jobs → Mark Ready), AND
 *   - its linked Job Order (matched by job_number) is status = in_production, AND
 *   - that Job Order's Required stage = full_material (the "2nd phase"), AND
 *   - that Job Order is NOT fully dispatched (dispatch status != 'full' — i.e. it
 *     is still in the Jobs "Active" tab).
 * A cabin job with no linked in-production/2nd-phase/active Job Order contributes
 * nothing. Same rule feeds Requirements, Programs to run, and Weekly so the three
 * agree. (The Cabin Jobs page's own weekly widget is NOT filtered by this — it
 * still uses the dormant cabin-program-plan.ts reader.)
 *
 * Deliberately a separate file: cabin-program-plan.ts is left untouched (a
 * parallel session has uncommitted edits there; it also still powers the Cabin
 * Jobs page + Cabin Jobs "by finish" tab).
 */
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { selectRuns, type OpOuts } from "@/lib/actions/make-plan-core";
import { getJobsDispatchStatus } from "@/lib/actions/dispatch";
import { sheetThicknessMm } from "@/lib/cabin/cabin-program-meta";
import type { WeekMeta } from "@/lib/actions/mrp-weekly";
import type {
  CabinMrpPlan,
  CabinPlanProgram,
  CabinPlanSheet,
  CabinPlanBlocked,
  CabinPlanInput,
  CabinPlanOutput,
  CabinReqRow,
  CabinWeeklyRow,
  CabinWeeklyPlan,
} from "@/lib/actions/cabin-program-plan";

interface EligibleCabinJob {
  requirementDispatchDate: string | null;
}

/** The demand-eligibility gate (see file header). Returns eligible
 *  cabin_job_id -> the linked Job Order's requirement_dispatch_date (used by the
 *  weekly board). Empty map = no cabin demand is live right now. */
async function getEligibleCabinJobs(
  supabase: ReturnType<typeof createCacheClient>,
): Promise<Map<string, EligibleCabinJob>> {
  const { data: cjobsRaw } = await supabase
    .from("cabin_jobs")
    .select("id, job_number, marked_ready_at");
  const notReady = ((cjobsRaw ?? []) as any[]).filter((c) => !c.marked_ready_at);
  if (notReady.length === 0) return new Map();

  // Job Orders that pass the status + Required-stage gate. jobs is small (~200
  // rows); fetch the in-production/2nd-phase set and match by normalised number.
  const { data: jobsRaw } = await supabase
    .from("jobs")
    .select("id, job_number, requirement_dispatch_date")
    .eq("status", "in_production")
    .eq("requirement_stage", "full_material");
  const jobByNumber = new Map<string, { id: string; date: string | null }>();
  for (const j of (jobsRaw ?? []) as any[]) {
    const key = ((j.job_number as string) ?? "").trim().toLowerCase();
    if (key) jobByNumber.set(key, { id: j.id as string, date: (j.requirement_dispatch_date as string | null) ?? null });
  }

  const cabinToJob = new Map<string, { jobId: string; date: string | null }>();
  const candidateJobIds = new Set<string>();
  for (const c of notReady) {
    const link = jobByNumber.get(((c.job_number as string) ?? "").trim().toLowerCase());
    if (link) {
      cabinToJob.set(c.id as string, { jobId: link.id, date: link.date });
      candidateJobIds.add(link.id);
    }
  }
  if (candidateJobIds.size === 0) return new Map();

  // Drop fully-dispatched Job Orders (dispatch status 'full' == left Active tab).
  const dispatch = await getJobsDispatchStatus([...candidateJobIds]);
  const eligible = new Map<string, EligibleCabinJob>();
  for (const [cabinId, link] of cabinToJob) {
    if (dispatch[link.jobId] !== "full") eligible.set(cabinId, { requirementDispatchDate: link.date });
  }
  return eligible;
}

/**
 * Scope resolver for all three Cabin-MRP readers. An EXPLICIT selection (the
 * "?jobs=" picker) takes exactly those cabin jobs — the engineer is asking a
 * what-if for a chosen set, so the default eligibility gate (in-production /
 * 2nd-phase / not fully dispatched / not ready) is NOT applied to them; dates
 * still come from the linked Job Order. No selection = the owner-rule
 * eligibility gate above (which excludes Hold and fully-dispatched jobs).
 */
async function getScopedCabinJobs(
  supabase: ReturnType<typeof createCacheClient>,
  jobIds?: string[],
): Promise<Map<string, EligibleCabinJob>> {
  if (!jobIds || jobIds.length === 0) return getEligibleCabinJobs(supabase);
  const { data: cjobs } = await supabase
    .from("cabin_jobs")
    .select("id, job_number")
    .in("id", jobIds);
  if (!cjobs?.length) return new Map();
  const { data: jobsRaw } = await supabase
    .from("jobs")
    .select("job_number, requirement_dispatch_date");
  const dateByNumber = new Map<string, string | null>();
  for (const j of (jobsRaw ?? []) as any[]) {
    const key = ((j.job_number as string) ?? "").trim().toLowerCase();
    if (key) dateByNumber.set(key, (j.requirement_dispatch_date as string | null) ?? null);
  }
  const out = new Map<string, EligibleCabinJob>();
  for (const c of cjobs as any[]) {
    out.set(c.id as string, {
      requirementDispatchDate:
        dateByNumber.get(((c.job_number as string) ?? "").trim().toLowerCase()) ?? null,
    });
  }
  return out;
}

/** Options for the Cabin-MRP job-scope picker: every cabin job with its line
 *  count, flagged with whether it sits in the DEFAULT eligible set (so the
 *  picker can mark Hold / fully-dispatched / ready jobs as outside it). */
export interface CabinScopeOption {
  id: string;
  job_number: string;
  customer_name: string | null;
  line_count: number;
  /** In the default all-jobs demand set (in production, 2nd phase, not dispatched, not ready). */
  eligible: boolean;
  ready: boolean;
}

export async function getCabinScopeOptions(): Promise<CabinScopeOption[]> {
  return unstable_cache(
    async () => {
      const supabase = createCacheClient();
      const [{ data: cjobs }, eligible] = await Promise.all([
        supabase
          .from("cabin_jobs")
          .select("id, job_number, customer_name, marked_ready_at, created_at, cabin_job_lines(count)")
          .order("created_at", { ascending: false }),
        getEligibleCabinJobs(supabase),
      ]);
      return ((cjobs ?? []) as any[])
        .map((c) => ({
          id: c.id as string,
          job_number: c.job_number as string,
          customer_name: (c.customer_name as string | null) ?? null,
          line_count: Array.isArray(c.cabin_job_lines)
            ? Number((c.cabin_job_lines[0] as any)?.count ?? 0)
            : 0,
          eligible: eligible.has(c.id as string),
          ready: c.marked_ready_at != null,
        }))
        // Eligible (default-set) jobs first; stable sort keeps recent-first within groups.
        .sort((a, b) => Number(b.eligible) - Number(a.eligible));
    },
    ["cabin-mrp-scope-options"],
    { revalidate: 120, tags: ["cabin-programs", "jobs"] },
  )();
}

interface ItemInfo {
  code: string;
  name: string;
  finish: string | null;
  category: string | null;
  stock: number;
}

/* ===================== Programs to run (the optimiser plan) ===================== */

const _getCabinMrpUncached = async (excludeKeys: string[], jobIds: string[]): Promise<CabinMrpPlan> => {
  const supabase = createCacheClient();
  const excludeSet = new Set(excludeKeys);

  const empty: CabinMrpPlan = {
    plan: [], sheets: [], blocked: [], excluded: excludeKeys,
    totals: { demandedItems: 0, inStock: 0, toCut: 0, makeable: 0, blocked: 0, programs: 0, runs: 0, sheets: 0, machineSeconds: 0, auditedPrograms: 0 },
  };

  /* 1. Cabin demand from the SCOPED cabin jobs (explicit ?jobs= selection, else
   *    the eligibility gate), netted vs stock -> shortfall. */
  const eligible = await getScopedCabinJobs(supabase, jobIds);
  if (eligible.size === 0) return empty;
  const eligibleIds = [...eligible.keys()];
  const lines = await fetchAllRanged<{ item_id: string | null; qty: number }>((from, to, withCount) =>
    supabase
      .from("cabin_job_lines")
      .select("item_id, qty", withCount ? { count: "exact" } : {})
      .not("item_id", "is", null)
      .in("cabin_job_id", eligibleIds)
      .range(from, to),
  );
  const demandByItem = new Map<string, number>();
  for (const l of lines) {
    if (!l.item_id) continue;
    demandByItem.set(l.item_id, (demandByItem.get(l.item_id) ?? 0) + (Number(l.qty) || 0));
  }
  if (demandByItem.size === 0) return empty;

  /* 2. Item identity + stock for the demanded items. */
  const itemIds = [...demandByItem.keys()];
  const itemInfo = new Map<string, ItemInfo>();
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await supabase
      .from("items")
      .select("id, code, name, finish, category:item_categories!items_category_id_fkey(name), inventory(quantity)")
      .in("id", itemIds.slice(i, i + 200));
    for (const it of (data ?? []) as any[]) {
      const stock = Array.isArray(it.inventory) ? it.inventory.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0) : 0;
      const cat = Array.isArray(it.category) ? it.category[0] : it.category;
      itemInfo.set(it.id as string, {
        code: it.code as string,
        name: it.name as string,
        finish: (it.finish as string | null) ?? null,
        category: cat?.name ?? null,
        stock,
      });
    }
  }

  const demandedItems = demandByItem.size;
  const shortfall = new Map<string, number>();
  let inStock = 0;
  for (const [id, dem] of demandByItem) {
    const info = itemInfo.get(id);
    if (!info) continue;
    const need = Math.max(0, dem - info.stock);
    if (need > 0) shortfall.set(id, need);
    else inStock += 1;
  }
  if (shortfall.size === 0) {
    return { ...empty, totals: { ...empty.totals, demandedItems, inStock } };
  }

  const blockedAll = (reason: "no-program"): CabinPlanBlocked[] =>
    [...shortfall].map(([id, need]) => {
      const info = itemInfo.get(id)!;
      return { item_id: id, code: info.code, name: info.name, finish: info.finish, category: info.category, need: Math.round(need), reason };
    }).sort((a, b) => b.need - a.need);

  /* 3. Candidate producers from the AUDITED UNIVERSE: every component output
   *    (any audited, active program) whose item is a demanded cabin item. */
  const shortfallIds = [...shortfall.keys()];
  const producedRows: { operation_id: string; item_id: string; qty_per_run: number }[] = [];
  for (let i = 0; i < shortfallIds.length; i += 200) {
    const { data } = await supabase
      .from("operation_outputs")
      .select("operation_id, item_id, qty_per_run")
      .eq("role", "component")
      .in("item_id", shortfallIds.slice(i, i + 200));
    for (const r of (data ?? []) as any[]) {
      if (!r.operation_id || !r.item_id) continue;
      producedRows.push({ operation_id: r.operation_id as string, item_id: r.item_id as string, qty_per_run: Number(r.qty_per_run ?? 1) || 1 });
    }
  }
  if (producedRows.length === 0) {
    const blocked = blockedAll("no-program");
    return { plan: [], sheets: [], blocked, excluded: excludeKeys,
      totals: { demandedItems, inStock, toCut: shortfall.size, makeable: 0, blocked: blocked.length, programs: 0, runs: 0, sheets: 0, machineSeconds: 0, auditedPrograms: 0 } };
  }

  /* 4. Keep only AUDITED + active operations. Load meta + sheet inputs. */
  const candOpIds = [...new Set(producedRows.map((r) => r.operation_id))];
  const opMeta = new Map<string, { code: string | null; name: string; machine: string | null; machineSeconds: number | null }>();
  for (let i = 0; i < candOpIds.length; i += 200) {
    const { data } = await supabase
      .from("operations")
      .select("id, code, name, machine, machining_time_seconds")
      .eq("is_active", true)
      .not("audited_at", "is", null)
      .in("id", candOpIds.slice(i, i + 200));
    for (const o of (data ?? []) as any[]) {
      opMeta.set(o.id as string, {
        code: (o.code as string | null) ?? null,
        name: (o.name as string) ?? "",
        machine: (o.machine as string | null) ?? null,
        machineSeconds: (o.machining_time_seconds as number | null) ?? null,
      });
    }
  }
  const auditedOpIds = [...opMeta.keys()];
  const auditedPrograms = auditedOpIds.length;
  if (auditedPrograms === 0) {
    const blocked = blockedAll("no-program");
    return { plan: [], sheets: [], blocked, excluded: excludeKeys,
      totals: { demandedItems, inStock, toCut: shortfall.size, makeable: 0, blocked: blocked.length, programs: 0, runs: 0, sheets: 0, machineSeconds: 0, auditedPrograms: 0 } };
  }

  const inputRows: { operation_id: string; item_id: string; qty_per_run: number }[] = [];
  for (let i = 0; i < auditedOpIds.length; i += 200) {
    const { data } = await supabase
      .from("operation_inputs")
      .select("operation_id, item_id, qty_per_run")
      .in("operation_id", auditedOpIds.slice(i, i + 200));
    for (const r of (data ?? []) as any[]) {
      if (!r.operation_id || !r.item_id) continue;
      inputRows.push({ operation_id: r.operation_id as string, item_id: r.item_id as string, qty_per_run: Number(r.qty_per_run ?? 1) || 1 });
    }
  }
  const inputsByOp = new Map<string, { item_id: string; qty_per_run: number }[]>();
  for (const r of inputRows) {
    const arr = inputsByOp.get(r.operation_id) ?? [];
    arr.push({ item_id: r.item_id, qty_per_run: r.qty_per_run });
    inputsByOp.set(r.operation_id, arr);
  }

  const sheetIds = [...new Set(inputRows.map((r) => r.item_id))];
  const sheetInfo = new Map<string, { code: string; name: string; thicknessMm: number | null }>();
  for (let i = 0; i < sheetIds.length; i += 200) {
    const { data } = await supabase.from("items").select("id, code, name").in("id", sheetIds.slice(i, i + 200));
    for (const s of (data ?? []) as any[]) {
      sheetInfo.set(s.id as string, { code: (s.code as string) ?? "", name: (s.name as string) ?? "", thicknessMm: sheetThicknessMm((s.name as string) ?? "") });
    }
  }

  /* 5. Build concrete candidates keyed `${opId}::${code}` (the Don't-run key). */
  const producedByOp = new Map<string, Map<string, number>>();
  for (const r of producedRows) {
    if (!opMeta.has(r.operation_id)) continue; // drop non-audited / inactive
    const m = producedByOp.get(r.operation_id) ?? new Map<string, number>();
    m.set(r.item_id, (m.get(r.item_id) ?? 0) + r.qty_per_run);
    producedByOp.set(r.operation_id, m);
  }

  const progOut: OpOuts = new Map();
  const inputsOf = new Map<string, Map<string, number>>();
  const candMeta = new Map<string, { opId: string; category: string; finish: string }>();
  const coveredRunnable = new Set<string>();

  for (const [opId, produced] of producedByOp) {
    const meta = opMeta.get(opId)!;
    const excludeKey = `${opId}::${meta.code ?? opId}`;
    if (excludeSet.has(excludeKey)) continue; // Don't-run

    let primaryItem: string | null = null;
    let primaryQty = -1;
    for (const [itemId, qpr] of produced) {
      if (qpr > primaryQty) { primaryQty = qpr; primaryItem = itemId; }
    }
    const primaryInfo = primaryItem ? itemInfo.get(primaryItem) : null;
    const category = primaryInfo?.category ?? "Cabin";
    const finish = primaryInfo?.finish ?? "";

    const inputMap = new Map<string, number>();
    for (const inp of inputsByOp.get(opId) ?? []) {
      inputMap.set(inp.item_id, (inputMap.get(inp.item_id) ?? 0) + inp.qty_per_run);
    }

    progOut.set(excludeKey, produced);
    inputsOf.set(excludeKey, inputMap);
    candMeta.set(excludeKey, { opId, category, finish });
    for (const id of produced.keys()) coveredRunnable.add(id);
  }

  const leafProduce = new Map<string, number>();
  for (const [id, need] of shortfall) if (coveredRunnable.has(id)) leafProduce.set(id, need);

  let runs = new Map<string, number>();
  if (leafProduce.size > 0) {
    const codeOf = (key: string) => candMeta.get(key)?.opId ?? key;
    runs = selectRuns(progOut, inputsOf, leafProduce, codeOf).runs;
  }

  /* 6. Allocate "used" smallest-producer-first (the 436A lesson) so surplus shows. */
  const producersByItem = new Map<string, { cand: string; produced: number }[]>();
  for (const [cand, rc] of runs) {
    if (rc <= 0) continue;
    for (const [item, qpr] of progOut.get(cand) ?? []) {
      const arr = producersByItem.get(item) ?? [];
      arr.push({ cand, produced: qpr * rc });
      producersByItem.set(item, arr);
    }
  }
  const usedByCandItem = new Map<string, Map<string, number>>();
  const makeableItems = new Set<string>();
  for (const [item, producers] of producersByItem) {
    producers.sort((a, b) => a.produced - b.produced);
    let rem = leafProduce.get(item) ?? 0;
    for (const { cand, produced } of producers) {
      const u = Math.max(0, Math.min(rem, produced));
      rem -= u;
      if (u > 0) makeableItems.add(item);
      const m = usedByCandItem.get(cand) ?? new Map<string, number>();
      m.set(item, u);
      usedByCandItem.set(cand, m);
    }
  }

  /* 7. Assemble program rows + sheet totals. */
  const plan: CabinPlanProgram[] = [];
  const sheetAgg = new Map<string, CabinPlanSheet>();
  let totalRuns = 0;
  let totalMachineSeconds = 0;
  for (const [cand, rc] of runs) {
    if (rc <= 0) continue;
    const cm = candMeta.get(cand)!;
    const meta = opMeta.get(cm.opId)!;
    const outItems = progOut.get(cand)!;
    const usedMap = usedByCandItem.get(cand) ?? new Map<string, number>();

    const outputs: CabinPlanOutput[] = [...outItems.entries()].map(([itemId, qpr]) => {
      const info = itemInfo.get(itemId)!;
      return { code: info.code, name: info.name, produced: Math.round(qpr * rc), used: Math.round(usedMap.get(itemId) ?? 0) };
    });
    outputs.sort((a, b) => b.produced - a.produced);
    const partsMade = outputs.reduce((s, o) => s + o.produced, 0);
    const extra = outputs.reduce((s, o) => s + (o.produced - o.used), 0);

    const inputs: CabinPlanInput[] = [];
    for (const [sheetId, perRun] of inputsOf.get(cand) ?? []) {
      const si = sheetInfo.get(sheetId);
      const total = Math.ceil(perRun * rc);
      inputs.push({ code: si?.code ?? "", name: si?.name ?? "", thicknessMm: si?.thicknessMm ?? null, total, perRun });
      const ex = sheetAgg.get(sheetId) ?? { code: si?.code ?? "", name: si?.name ?? "", finish: cm.finish, thicknessMm: si?.thicknessMm ?? null, total: 0 };
      ex.total += total;
      sheetAgg.set(sheetId, ex);
    }
    inputs.sort((a, b) => (a.thicknessMm ?? 99) - (b.thicknessMm ?? 99));

    const machineSeconds = meta.machineSeconds != null ? meta.machineSeconds * rc : null;
    if (machineSeconds != null) totalMachineSeconds += machineSeconds;
    totalRuns += rc;

    plan.push({
      excludeKey: cand, program_id: cm.opId, code: meta.code, name: meta.name, machine: meta.machine,
      category: cm.category, finish: cm.finish, runs: rc, machineSeconds, inputs, outputs, partsMade, extra,
    });
  }
  plan.sort((a, b) => a.category.localeCompare(b.category) || b.runs - a.runs || a.name.localeCompare(b.name));

  const totalSheets = [...sheetAgg.values()].reduce((s, x) => s + x.total, 0);

  /* 8. Blocked — short items no runnable candidate makes. */
  const blocked: CabinPlanBlocked[] = [];
  for (const [id, need] of shortfall) {
    if (makeableItems.has(id)) continue;
    const info = itemInfo.get(id)!;
    blocked.push({ item_id: id, code: info.code, name: info.name, finish: info.finish, category: info.category, need: Math.round(need), reason: "no-program" });
  }
  blocked.sort((a, b) => b.need - a.need);

  return {
    plan,
    sheets: [...sheetAgg.values()].sort((a, b) => (a.thicknessMm ?? 99) - (b.thicknessMm ?? 99) || b.total - a.total),
    blocked,
    excluded: excludeKeys,
    totals: {
      demandedItems, inStock, toCut: shortfall.size, makeable: makeableItems.size, blocked: blocked.length,
      programs: plan.length, runs: totalRuns, sheets: totalSheets, machineSeconds: totalMachineSeconds, auditedPrograms,
    },
  };
};

export async function getCabinMrp(
  excludeKeys: string[] = [],
  jobIds: string[] = [],
): Promise<CabinMrpPlan> {
  const key =
    (excludeKeys.length ? [...excludeKeys].sort().join(",") : "__none__") +
    "|" +
    (jobIds.length ? [...jobIds].sort().join(",") : "__all__");
  return unstable_cache(() => _getCabinMrpUncached(excludeKeys, jobIds), ["cabin-mrp-universe", key], {
    revalidate: 300,
    tags: ["cabin-programs", "operations", "jobs", "bom-lines", "items", "inventory-stock"],
  })();
}

/* ============================ Requirements ============================ */

const _getCabinRequirementsUncached = async (jobIds: string[]): Promise<CabinReqRow[]> => {
  const supabase = createCacheClient();
  const eligible = await getScopedCabinJobs(supabase, jobIds);
  if (eligible.size === 0) return [];
  const eligibleIds = [...eligible.keys()];

  const lines = await fetchAllRanged<{ cabin_type: string; item_id: string | null; qty: number; cabin_job_id: string }>(
    (from, to, withCount) =>
      supabase
        .from("cabin_job_lines")
        .select("cabin_type, item_id, qty, cabin_job_id", withCount ? { count: "exact" } : {})
        .not("item_id", "is", null)
        .in("cabin_job_id", eligibleIds)
        .range(from, to),
  );
  if (lines.length === 0) return [];

  const demand = new Map<string, { type: string; qty: number; jobs: Set<string> }>();
  for (const l of lines) {
    if (!l.item_id) continue;
    const ex = demand.get(l.item_id) ?? { type: l.cabin_type, qty: 0, jobs: new Set<string>() };
    ex.qty += Number(l.qty) || 0;
    ex.jobs.add(l.cabin_job_id);
    demand.set(l.item_id, ex);
  }

  const itemIds = [...demand.keys()];
  const info = new Map<string, { code: string; name: string; finish: string | null; stock: number }>();
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await supabase
      .from("items")
      .select("id, code, name, finish, inventory(quantity)")
      .in("id", itemIds.slice(i, i + 200));
    for (const it of (data ?? []) as any[]) {
      const stock = Array.isArray(it.inventory) ? it.inventory.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0) : 0;
      info.set(it.id as string, { code: it.code as string, name: it.name as string, finish: (it.finish as string | null) ?? null, stock });
    }
  }

  const rows: CabinReqRow[] = [];
  for (const [id, d] of demand) {
    const it = info.get(id);
    if (!it) continue;
    rows.push({
      item_id: id, code: it.code, name: it.name, type: d.type, finish: it.finish,
      required: d.qty, stock: it.stock, shortfall: Math.max(0, d.qty - it.stock), job_count: d.jobs.size,
    });
  }
  return rows;
};

export async function getCabinRequirements(jobIds: string[] = []): Promise<CabinReqRow[]> {
  const key = jobIds.length ? [...jobIds].sort().join(",") : "__all__";
  return unstable_cache(() => _getCabinRequirementsUncached(jobIds), ["cabin-mrp-requirements", key], {
    revalidate: 300,
    tags: ["cabin-programs", "jobs", "bom-lines", "items", "inventory-stock"],
  })();
}

/* ==================== Per-item job breakdown (hover) ==================== */

export interface CabinItemJob {
  cabin_job_id: string;
  job_number: string;
  customer_name: string | null;
  line_count: number;
  total_qty: number;
}

/** Which scoped cabin jobs demand one item — powers the Required-cell hover on
 *  the Requirements view. Scope (explicit ?jobs= picker vs the eligibility
 *  gate) matches getCabinRequirements exactly, so the numbers agree. */
const _getCabinItemJobsUncached = async (
  itemId: string,
  jobIds: string[],
): Promise<CabinItemJob[]> => {
  const supabase = createCacheClient();
  const eligible = await getScopedCabinJobs(supabase, jobIds);
  if (eligible.size === 0) return [];

  const lines = await fetchAllRanged<{ cabin_job_id: string; qty: number }>(
    (from, to, withCount) =>
      supabase
        .from("cabin_job_lines")
        .select("cabin_job_id, qty", withCount ? { count: "exact" } : {})
        .eq("item_id", itemId)
        .range(from, to),
  );
  const agg = new Map<string, { line_count: number; total_qty: number }>();
  for (const l of lines) {
    if (!eligible.has(l.cabin_job_id)) continue;
    const ex = agg.get(l.cabin_job_id) ?? { line_count: 0, total_qty: 0 };
    ex.line_count += 1;
    ex.total_qty += Number(l.qty) || 0;
    agg.set(l.cabin_job_id, ex);
  }
  if (agg.size === 0) return [];

  const { data: cjobs } = await supabase
    .from("cabin_jobs")
    .select("id, job_number, customer_name")
    .in("id", [...agg.keys()]);
  const rows: CabinItemJob[] = ((cjobs ?? []) as any[]).map((c) => ({
    cabin_job_id: c.id as string,
    job_number: c.job_number as string,
    customer_name: (c.customer_name as string | null) ?? null,
    line_count: agg.get(c.id as string)!.line_count,
    total_qty: agg.get(c.id as string)!.total_qty,
  }));
  rows.sort((a, b) => b.total_qty - a.total_qty || a.job_number.localeCompare(b.job_number));
  return rows;
};

export async function getCabinItemJobs(
  itemId: string,
  jobIds: string[] = [],
): Promise<CabinItemJob[]> {
  const key = itemId + "|" + (jobIds.length ? [...jobIds].sort().join(",") : "__all__");
  return unstable_cache(() => _getCabinItemJobsUncached(itemId, jobIds), ["cabin-mrp-item-jobs", key], {
    revalidate: 300,
    tags: ["cabin-programs", "jobs", "bom-lines", "items"],
  })();
}

/* ============================ Weekly ============================ */

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HORIZON_WEEKS = 8;

function istToday(): Date {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function startOfWeekSunday(d: Date): Date {
  return new Date(d.getTime() - d.getUTCDay() * DAY_MS);
}
function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
function fmtRange(start: Date, end: Date): string {
  const sm = MONTHS[start.getUTCMonth()], em = MONTHS[end.getUTCMonth()];
  return sm === em ? `${start.getUTCDate()}–${end.getUTCDate()} ${sm}` : `${start.getUTCDate()} ${sm} – ${end.getUTCDate()} ${em}`;
}
function buildCabinWeeks(curWeek: Date): WeekMeta[] {
  const weeks: WeekMeta[] = [
    { index: -1, key: "overdue", label: "Overdue", title: "Overdue", subtitle: "Linked job date already passed", weekStartIso: null, isCurrent: false, isOverdue: true },
  ];
  for (let w = 0; w < HORIZON_WEEKS; w++) {
    const start = new Date(curWeek.getTime() + w * 7 * DAY_MS);
    const end = new Date(start.getTime() + 6 * DAY_MS);
    const range = fmtRange(start, end);
    weeks.push({
      index: w, key: `w${w}`, label: range, title: range,
      subtitle: w === 0 ? "This week" : w === 1 ? "Next week" : `In ${w} weeks`,
      weekStartIso: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`,
      isCurrent: w === 0, isOverdue: false,
    });
  }
  weeks.push({
    index: 99, key: "undated", label: "Undated", title: "Undated",
    subtitle: "Linked job has no dispatch date", weekStartIso: null, isCurrent: false, isOverdue: false,
  });
  return weeks;
}

const _getCabinWeeklyUncached = async (jobIds: string[]): Promise<CabinWeeklyPlan> => {
  const supabase = createCacheClient();
  const today = istToday();
  const curWeek = startOfWeekSunday(today);
  const weeks = buildCabinWeeks(curWeek);
  const N = weeks.length;

  const eligible = await getScopedCabinJobs(supabase, jobIds);
  if (eligible.size === 0) return { weeks, rows: [], laterCount: 0, undatedCount: 0 };
  const eligibleIds = [...eligible.keys()];

  const lines = await fetchAllRanged<{ cabin_type: string; item_id: string | null; qty: number; cabin_job_id: string }>(
    (from, to, withCount) =>
      supabase
        .from("cabin_job_lines")
        .select("cabin_type, item_id, qty, cabin_job_id", withCount ? { count: "exact" } : {})
        .not("item_id", "is", null)
        .in("cabin_job_id", eligibleIds)
        .range(from, to),
  );

  // Each eligible cabin job's bucket comes from its linked Job Order's date.
  const dateByCabinJob = new Map<string, string | null>();
  for (const [cid, info] of eligible) dateByCabinJob.set(cid, info.requirementDispatchDate);

  const bucketOf = (iso: string | null): { pos: number | null; later: boolean; undated: boolean } => {
    if (!iso) return { pos: null, later: false, undated: true };
    const d = parseDate(iso);
    if (!d) return { pos: null, later: false, undated: true };
    const ws = startOfWeekSunday(d);
    const w = Math.round((ws.getTime() - curWeek.getTime()) / (7 * DAY_MS));
    if (w < 0) return { pos: 0, later: false, undated: false };
    if (w >= HORIZON_WEEKS) return { pos: null, later: true, undated: false };
    return { pos: w + 1, later: false, undated: false };
  };

  const demandByItemWeek = new Map<string, { type: string; arr: number[] }>();
  const laterJobs = new Set<string>();
  const undatedJobs = new Set<string>();
  const undatedPos = N - 1;
  for (const l of lines) {
    if (!l.item_id) continue;
    const b = bucketOf(dateByCabinJob.get(l.cabin_job_id) ?? null);
    if (b.later) { laterJobs.add(l.cabin_job_id); continue; }
    let pos = b.pos;
    if (b.undated) { undatedJobs.add(l.cabin_job_id); pos = undatedPos; }
    if (pos == null) continue;
    const ex = demandByItemWeek.get(l.item_id) ?? { type: l.cabin_type, arr: new Array(N).fill(0) };
    ex.arr[pos] += Number(l.qty) || 0;
    demandByItemWeek.set(l.item_id, ex);
  }

  const itemIds = [...demandByItemWeek.keys()];
  const info = new Map<string, { code: string; name: string; finish: string | null; stock: number }>();
  const chunks: Promise<void>[] = [];
  for (let i = 0; i < itemIds.length; i += 200) {
    const chunk = itemIds.slice(i, i + 200);
    chunks.push(
      (async () => {
        const { data } = await supabase.from("items").select("id, code, name, finish, inventory(quantity)").in("id", chunk);
        for (const it of (data ?? []) as any[]) {
          const stock = Array.isArray(it.inventory) ? it.inventory.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0) : 0;
          info.set(it.id as string, { code: it.code as string, name: it.name as string, finish: (it.finish as string | null) ?? null, stock });
        }
      })(),
    );
  }
  await Promise.all(chunks);

  const rows: CabinWeeklyRow[] = [];
  for (const [id, d] of demandByItemWeek) {
    const it = info.get(id);
    if (!it) continue;
    const cumulative: number[] = new Array(N).fill(0);
    const perWeek: number[] = new Array(N).fill(0);
    let gross = 0, prevShort = 0;
    for (let i = 0; i < N; i++) {
      gross += d.arr[i];
      const short = Math.max(0, gross - it.stock);
      cumulative[i] = short;
      perWeek[i] = Math.max(0, short - prevShort);
      prevShort = short;
    }
    const total = cumulative[N - 1];
    if (total <= 0) continue;
    rows.push({ item_id: id, code: it.code, name: it.name, type: d.type, finish: it.finish, perWeek, cumulative, total });
  }
  rows.sort((a, b) => b.total - a.total);

  return { weeks, rows, laterCount: laterJobs.size, undatedCount: undatedJobs.size };
};

export async function getCabinWeekly(jobIds: string[] = []): Promise<CabinWeeklyPlan> {
  const key = jobIds.length ? [...jobIds].sort().join(",") : "__all__";
  return unstable_cache(() => _getCabinWeeklyUncached(jobIds), ["cabin-mrp-weekly", key], {
    revalidate: 300,
    tags: ["cabin-programs", "jobs", "bom-lines", "items", "inventory-stock"],
  })();
}
