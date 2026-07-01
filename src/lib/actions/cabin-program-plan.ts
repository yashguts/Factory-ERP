"use server";

/**
 * CABIN MRP — programs to cut for the cabin demand, presented exactly like Make
 * MRP (production-plan.ts) and driven by the SAME owner-locked optimiser
 * (selectRuns from make-plan-core). The finish dimension is resolved here, BEFORE
 * the optimiser: each cabin program × each demanded finish becomes a concrete
 * candidate (output = the family+finish panel item, input = the sheet of that
 * finish & thickness). Demanded items with no audited program, or a finish with no
 * matching sheet, surface as "blocked / not mapped".
 */
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { selectRuns, type OpOuts } from "@/lib/actions/make-plan-core";
import { sheetThicknessMm, CABIN_PROGRAM_FINISHES } from "@/lib/cabin/cabin-program-meta";
import type { WeekMeta } from "@/lib/actions/mrp-weekly";

/** Cabin jobs flagged "ready" are already built — excluded from all cabin
 *  requirement / cutting-demand readers below. Returns the ids to filter out. */
async function readyCabinJobIds(
  supabase: ReturnType<typeof createCacheClient>,
): Promise<string[]> {
  const { data } = await supabase
    .from("cabin_jobs")
    .select("id")
    .not("marked_ready_at", "is", null);
  return (data ?? []).map((r: any) => r.id as string);
}

export interface CabinPlanInput {
  code: string;
  name: string;
  thicknessMm: number | null;
  total: number; // whole sheets across all runs
  perRun: number;
}
export interface CabinPlanOutput {
  code: string;
  name: string;
  produced: number; // qty/run × runs
  used: number; // how many the demand counts
}
export interface CabinPlanProgram {
  /** `${program_id}::${finish}` — the Don't-run exclude key. */
  excludeKey: string;
  program_id: string;
  code: string | null;
  name: string;
  machine: string | null;
  category: string;
  finish: string;
  runs: number;
  machineSeconds: number | null;
  inputs: CabinPlanInput[];
  outputs: CabinPlanOutput[];
  partsMade: number;
  extra: number;
}
export interface CabinPlanSheet {
  code: string;
  name: string;
  finish: string;
  thicknessMm: number | null;
  total: number;
}
export interface CabinPlanBlocked {
  item_id: string;
  code: string;
  name: string;
  finish: string | null;
  category: string | null;
  need: number;
  reason: "no-program" | "no-sheet";
}
export interface CabinMrpPlan {
  plan: CabinPlanProgram[];
  sheets: CabinPlanSheet[];
  blocked: CabinPlanBlocked[];
  excluded: string[];
  totals: {
    demandedItems: number;
    inStock: number; // demanded items fully covered by stock (excluded from plan)
    toCut: number; // demanded items still short
    makeable: number; // short items a program can cut
    blocked: number; // short items nothing can cut
    programs: number;
    runs: number;
    sheets: number;
    machineSeconds: number;
    auditedPrograms: number;
  };
}

/** Does a raw-sheet name belong to the given finish? Reliable for MS/GI + SS grades;
 *  designer finishes match by name words (sparse sheet stock → often no match). */
function sheetMatchesFinish(sheetName: string, finish: string): boolean {
  const n = sheetName.toUpperCase();
  const f = finish.toUpperCase();
  if (f === "MS") return n.includes("MS");
  if (f === "GI") return n.includes("GI");
  if (f === "MS/GI") return n.includes("MS") || n.includes("GI");
  if (f.startsWith("SS ")) return n.includes(f.slice(3)); // grade number, e.g. "430"
  return f.split(/\s+/).filter(Boolean).every((w) => n.includes(w));
}

const _getCabinMrpUncached = async (excludeKeys: string[]): Promise<CabinMrpPlan> => {
  const supabase = createCacheClient();
  const excludeSet = new Set(excludeKeys);

  /* 1. Cabin demand: net cabin-job line qty against stock -> shortfall per item.
   *    Ready jobs are already built — their lines are excluded. */
  const readyIds = await readyCabinJobIds(supabase);
  const lines = await fetchAllRanged<{ item_id: string | null; qty: number }>((from, to, withCount) => {
    const base = supabase
      .from("cabin_job_lines")
      .select("item_id, qty", withCount ? { count: "exact" } : {})
      .not("item_id", "is", null);
    const q = readyIds.length ? base.not("cabin_job_id", "in", `(${readyIds.join(",")})`) : base;
    return q.range(from, to);
  });
  const demandByItem = new Map<string, number>();
  for (const l of lines) {
    if (!l.item_id) continue;
    demandByItem.set(l.item_id, (demandByItem.get(l.item_id) ?? 0) + (Number(l.qty) || 0));
  }
  const empty: CabinMrpPlan = {
    plan: [], sheets: [], blocked: [], excluded: excludeKeys,
    totals: { demandedItems: 0, inStock: 0, toCut: 0, makeable: 0, blocked: 0, programs: 0, runs: 0, sheets: 0, machineSeconds: 0, auditedPrograms: 0 },
  };
  if (demandByItem.size === 0) return empty;

  const itemIds = [...demandByItem.keys()];
  const itemInfo = new Map<string, { code: string; name: string; family: string | null; finish: string | null; category: string | null; stock: number }>();
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await supabase
      .from("items")
      .select("id, code, name, family, finish, category:item_categories!items_category_id_fkey(name), inventory(quantity)")
      .in("id", itemIds.slice(i, i + 200));
    for (const it of (data ?? []) as any[]) {
      const stock = Array.isArray(it.inventory) ? it.inventory.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0) : 0;
      const cat = Array.isArray(it.category) ? it.category[0] : it.category;
      itemInfo.set(it.id as string, {
        code: it.code as string,
        name: it.name as string,
        family: (it.family as string | null) ?? null,
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
  const demandByFamFinish = new Map<string, string>();
  for (const id of shortfall.keys()) {
    const info = itemInfo.get(id)!;
    if (info.family && info.finish) demandByFamFinish.set(`${info.family}|||${info.finish}`, id);
  }

  /* 2. Audited cabin programs + outputs + finishes + input sheet. */
  const { data: progRows } = await supabase
    .from("cabin_programs")
    .select(`*, input_sheet:items!cabin_programs_input_sheet_item_id_fkey(code, name)`)
    .eq("is_active", true)
    .not("audited_at", "is", null);
  const programs = (progRows ?? []) as any[];
  const auditedPrograms = programs.length;

  const progIds = programs.map((p) => p.id as string);
  const outsByProg = new Map<string, any[]>();
  const finsByProg = new Map<string, string[]>();
  if (progIds.length) {
    const [{ data: outs }, { data: fins }] = await Promise.all([
      supabase.from("cabin_program_outputs").select("*").in("cabin_program_id", progIds),
      supabase.from("cabin_program_finishes").select("cabin_program_id, finish").in("cabin_program_id", progIds),
    ]);
    for (const o of (outs ?? []) as any[]) {
      const arr = outsByProg.get(o.cabin_program_id as string) ?? [];
      arr.push(o);
      outsByProg.set(o.cabin_program_id as string, arr);
    }
    for (const f of (fins ?? []) as any[]) {
      const arr = finsByProg.get(f.cabin_program_id as string) ?? [];
      arr.push(f.finish as string);
      finsByProg.set(f.cabin_program_id as string, arr);
    }
  }

  /* 3. Sheet inventory for resolving "a sheet of finish F & thickness T". */
  const sheetRows = await fetchAllRanged<{ id: string; code: string; name: string }>((from, to, withCount) =>
    supabase
      .from("items")
      .select("id, code, name", withCount ? { count: "exact" } : {})
      .eq("is_active", true)
      .eq("item_type", "raw_material")
      .range(from, to),
  );
  const sheets = sheetRows.map((s) => ({ ...s, thickness: sheetThicknessMm(s.name) }));
  const resolveSheet = (
    finish: string,
    thickness: number | null,
    inputSheet: { id: string; code: string; name: string } | null,
  ): { id: string; code: string; name: string } | null => {
    // Prefer the program's OWN selected input sheet. A sheet whose name carries
    // finish tokens (e.g. "… MS/GI") must match the requested finish; an
    // untagged plain sheet (e.g. "1250x2500x1.2mm") is a base sheet used as-is.
    if (inputSheet?.id) {
      const tagged = CABIN_PROGRAM_FINISHES.some((f) => sheetMatchesFinish(inputSheet.name, f));
      if (!tagged || sheetMatchesFinish(inputSheet.name, finish)) return inputSheet;
    }
    // A genuinely different finish was requested: take a sheet of that finish at
    // the SAME thickness. Never substitute an arbitrary wrong-thickness sheet —
    // fall back to the program's own chosen sheet instead.
    const cands = sheets.filter((s) => sheetMatchesFinish(s.name, finish));
    const exact = cands.find((s) => thickness != null && s.thickness === thickness);
    return exact ?? inputSheet ?? cands[0] ?? null;
  };

  /* 4. Build finish-resolved candidates. */
  const progOut: OpOuts = new Map();
  const inputsOf = new Map<string, Map<string, number>>();
  const candMeta = new Map<string, { program: any; finish: string; sheet: { id: string; code: string; name: string }; sheetsPerRun: number }>();
  const coveredByProgram = new Set<string>();
  const coveredRunnable = new Set<string>();

  for (const p of programs) {
    const outs = outsByProg.get(p.id as string) ?? [];
    const fins = finsByProg.get(p.id as string) ?? [];
    const rawInput = Array.isArray(p.input_sheet) ? p.input_sheet[0] : p.input_sheet;
    const inputSheet =
      p.input_sheet_item_id && rawInput
        ? {
            id: p.input_sheet_item_id as string,
            code: (rawInput.code as string) ?? "",
            name: (rawInput.name as string) ?? "",
          }
        : null;
    const thickness = sheetThicknessMm(inputSheet?.name);
    const sheetsPerRun = Number(p.sheets_per_run ?? 1) || 1;

    for (const finish of fins) {
      const excludeKey = `${p.id}::${finish}`;
      const produced = new Map<string, number>();
      for (const o of outs) {
        const qty = Number(o.qty_per_run ?? 1) || 1;
        let itemId: string | null = null;
        if (o.family) itemId = demandByFamFinish.get(`${o.family}|||${finish}`) ?? null;
        else if (o.item_id && shortfall.has(o.item_id)) itemId = o.item_id as string;
        if (itemId && shortfall.has(itemId)) {
          produced.set(itemId, (produced.get(itemId) ?? 0) + qty);
          coveredByProgram.add(itemId);
        }
      }
      if (produced.size === 0) continue;
      if (excludeSet.has(excludeKey)) continue; // Don't-run: drop this candidate
      const sheet = resolveSheet(finish, thickness, inputSheet);
      if (!sheet) continue;

      progOut.set(excludeKey, produced);
      inputsOf.set(excludeKey, new Map([[sheet.id, sheetsPerRun]]));
      candMeta.set(excludeKey, { program: p, finish, sheet, sheetsPerRun });
      for (const id of produced.keys()) coveredRunnable.add(id);
    }
  }

  const leafProduce = new Map<string, number>();
  for (const [id, need] of shortfall) if (coveredRunnable.has(id)) leafProduce.set(id, need);

  let runs = new Map<string, number>();
  if (leafProduce.size > 0) runs = selectRuns(progOut, inputsOf, leafProduce).runs;

  /* 5. Allocate "used" smallest-producer-first (the 436A lesson) so surplus shows. */
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

  /* 6. Assemble program rows + sheet totals. */
  const plan: CabinPlanProgram[] = [];
  const sheetAgg = new Map<string, CabinPlanSheet>();
  let totalRuns = 0;
  let totalMachineSeconds = 0;
  for (const [cand, rc] of runs) {
    if (rc <= 0) continue;
    const meta = candMeta.get(cand)!;
    const p = meta.program;
    const outItems = progOut.get(cand)!;
    const usedMap = usedByCandItem.get(cand) ?? new Map();
    const outputs: CabinPlanOutput[] = [...outItems.entries()].map(([itemId, qpr]) => {
      const info = itemInfo.get(itemId)!;
      return { code: info.code, name: info.name, produced: Math.round(qpr * rc), used: Math.round(usedMap.get(itemId) ?? 0) };
    });
    outputs.sort((a, b) => b.produced - a.produced);
    const partsMade = outputs.reduce((s, o) => s + o.produced, 0);
    const extra = outputs.reduce((s, o) => s + (o.produced - o.used), 0);
    const thickness = sheetThicknessMm(meta.sheet.name);
    const sheetsForRun = Math.ceil(meta.sheetsPerRun * rc);
    const machine = (p.machine as string | null) ?? null;
    const mts = (p.machining_time_seconds as number | null) ?? null;
    const machineSeconds = mts != null ? mts * rc : null;
    if (machineSeconds != null) totalMachineSeconds += machineSeconds;
    totalRuns += rc;

    plan.push({
      excludeKey: cand,
      program_id: p.id as string,
      code: (p.code as string | null) ?? null,
      name: p.name as string,
      machine,
      category: p.category as string,
      finish: meta.finish,
      runs: rc,
      machineSeconds,
      inputs: [{ code: meta.sheet.code, name: meta.sheet.name, thicknessMm: thickness, total: sheetsForRun, perRun: meta.sheetsPerRun }],
      outputs,
      partsMade,
      extra,
    });

    const ex = sheetAgg.get(meta.sheet.id) ?? { code: meta.sheet.code, name: meta.sheet.name, finish: meta.finish, thicknessMm: thickness, total: 0 };
    ex.total += sheetsForRun;
    sheetAgg.set(meta.sheet.id, ex);
  }
  // Most-runs-first within a category (the client groups by category).
  plan.sort((a, b) => a.category.localeCompare(b.category) || b.runs - a.runs || a.name.localeCompare(b.name));

  const totalSheets = [...sheetAgg.values()].reduce((s, x) => s + x.total, 0);

  /* 7. Blocked / not mapped — short items no runnable candidate makes. */
  const blocked: CabinPlanBlocked[] = [];
  for (const [id, need] of shortfall) {
    if (makeableItems.has(id)) continue;
    const info = itemInfo.get(id)!;
    blocked.push({
      item_id: id, code: info.code, name: info.name, finish: info.finish, category: info.category,
      need: Math.round(need),
      reason: coveredByProgram.has(id) ? "no-sheet" : "no-program",
    });
  }
  blocked.sort((a, b) => b.need - a.need);

  return {
    plan,
    sheets: [...sheetAgg.values()].sort((a, b) => (a.thicknessMm ?? 99) - (b.thicknessMm ?? 99) || b.total - a.total),
    blocked,
    excluded: excludeKeys,
    totals: {
      demandedItems,
      inStock,
      toCut: shortfall.size,
      makeable: makeableItems.size,
      blocked: blocked.length,
      programs: plan.length,
      runs: totalRuns,
      sheets: totalSheets,
      machineSeconds: totalMachineSeconds,
      auditedPrograms,
    },
  };
};

/* ============================ Requirements ============================ */

export interface CabinReqRow {
  item_id: string;
  code: string;
  name: string;
  /** Cabin type (from the cabin-job line, e.g. Platform / Side Panel / Canopy). */
  type: string;
  finish: string | null;
  required: number;
  stock: number;
  shortfall: number;
  job_count: number;
}

const _getCabinRequirementsUncached = async (): Promise<CabinReqRow[]> => {
  const supabase = createCacheClient();
  const readyIds = await readyCabinJobIds(supabase);
  const lines = await fetchAllRanged<{ cabin_type: string; item_id: string | null; qty: number; cabin_job_id: string }>(
    (from, to, withCount) => {
      const base = supabase
        .from("cabin_job_lines")
        .select("cabin_type, item_id, qty, cabin_job_id", withCount ? { count: "exact" } : {})
        .not("item_id", "is", null);
      const q = readyIds.length ? base.not("cabin_job_id", "in", `(${readyIds.join(",")})`) : base;
      return q.range(from, to);
    },
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

export async function getCabinRequirements(): Promise<CabinReqRow[]> {
  return unstable_cache(_getCabinRequirementsUncached, ["cabin-requirements"], {
    revalidate: 300,
    tags: ["cabin-programs", "jobs", "items", "inventory-stock"],
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
  // Trailing bucket for cabin jobs with no linked dated Job — keeps their demand
  // (and finishes) visible & filterable instead of silently dropping off the board.
  weeks.push({
    index: 99, key: "undated", label: "Undated", title: "Undated",
    subtitle: "Cabin job has no linked dated Job",
    weekStartIso: null, isCurrent: false, isOverdue: false,
  });
  return weeks;
}

export interface CabinWeeklyRow {
  item_id: string;
  code: string;
  name: string;
  type: string;
  finish: string | null;
  perWeek: number[];
  cumulative: number[];
  total: number;
}
export interface CabinWeeklyPlan {
  weeks: WeekMeta[];
  rows: CabinWeeklyRow[];
  laterCount: number;
  undatedCount: number;
}

const _getCabinWeeklyUncached = async (): Promise<CabinWeeklyPlan> => {
  const supabase = createCacheClient();
  const today = istToday();
  const curWeek = startOfWeekSunday(today);
  const weeks = buildCabinWeeks(curWeek);
  const N = weeks.length;

  // cabin job -> linked elevator job's requirement_dispatch_date.
  const { data: cjobs } = await supabase.from("cabin_jobs").select("id, job_number");
  const cabinJobNumbers = (cjobs ?? []).map((c: any) => (c.job_number as string) ?? "");
  const { data: jobs } = await supabase
    .from("jobs")
    .select("job_number, requirement_dispatch_date")
    .in("job_number", cabinJobNumbers);
  const dateByNumber = new Map<string, string | null>();
  for (const j of jobs ?? []) dateByNumber.set(((j.job_number as string) ?? "").trim().toLowerCase(), (j.requirement_dispatch_date as string | null) ?? null);
  const dateByCabinJob = new Map<string, string | null>();
  for (const c of cjobs ?? []) dateByCabinJob.set(c.id as string, dateByNumber.get(((c.job_number as string) ?? "").trim().toLowerCase()) ?? null);

  // bucket position for a date: 0 = overdue, 1..N-1 = weeks; null = later/undated.
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

  const readyIds = await readyCabinJobIds(supabase);
  const lines = await fetchAllRanged<{ cabin_type: string; item_id: string | null; qty: number; cabin_job_id: string }>(
    (from, to, withCount) => {
      const base = supabase.from("cabin_job_lines").select("cabin_type, item_id, qty, cabin_job_id", withCount ? { count: "exact" } : {}).not("item_id", "is", null);
      const q = readyIds.length ? base.not("cabin_job_id", "in", `(${readyIds.join(",")})`) : base;
      return q.range(from, to);
    },
  );

  const demandByItemWeek = new Map<string, { type: string; arr: number[] }>();
  const laterJobs = new Set<string>();
  const undatedJobs = new Set<string>();
  const undatedPos = N - 1; // the appended "Undated" bucket is the last column
  for (const l of lines) {
    if (!l.item_id) continue;
    const b = bucketOf(dateByCabinJob.get(l.cabin_job_id) ?? null);
    if (b.later) { laterJobs.add(l.cabin_job_id); continue; } // dated beyond the horizon -> footnote only
    // Undated demand (no linked dated Job) goes in the trailing "Undated" column
    // so it stays visible & filterable rather than disappearing from the board.
    let pos = b.pos;
    if (b.undated) { undatedJobs.add(l.cabin_job_id); pos = undatedPos; }
    if (pos == null) continue;
    const ex = demandByItemWeek.get(l.item_id) ?? { type: l.cabin_type, arr: new Array(N).fill(0) };
    ex.arr[pos] += Number(l.qty) || 0;
    demandByItemWeek.set(l.item_id, ex);
  }

  const itemIds = [...demandByItemWeek.keys()];
  const info = new Map<string, { code: string; name: string; finish: string | null; stock: number }>();
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await supabase.from("items").select("id, code, name, finish, inventory(quantity)").in("id", itemIds.slice(i, i + 200));
    for (const it of (data ?? []) as any[]) {
      const stock = Array.isArray(it.inventory) ? it.inventory.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0) : 0;
      info.set(it.id as string, { code: it.code as string, name: it.name as string, finish: (it.finish as string | null) ?? null, stock });
    }
  }

  const rows: CabinWeeklyRow[] = [];
  for (const [id, d] of demandByItemWeek) {
    const it = info.get(id);
    if (!it) continue;
    // cumulative shortfall: gross cumulative demand minus stock (applied to earliest weeks).
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

export async function getCabinWeekly(): Promise<CabinWeeklyPlan> {
  return unstable_cache(_getCabinWeeklyUncached, ["cabin-weekly"], {
    revalidate: 300,
    tags: ["cabin-programs", "jobs", "items", "inventory-stock"],
  })();
}

export async function getCabinMrp(excludeKeys: string[] = []): Promise<CabinMrpPlan> {
  const key = excludeKeys.length ? [...excludeKeys].sort().join(",") : "__none__";
  return unstable_cache(() => _getCabinMrpUncached(excludeKeys), ["cabin-mrp", key], {
    revalidate: 300,
    tags: ["cabin-programs", "jobs", "items", "inventory-stock"],
  })();
}
