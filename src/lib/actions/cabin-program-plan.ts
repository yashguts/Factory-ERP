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
import { sheetThicknessMm } from "@/lib/cabin/cabin-program-meta";

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

  /* 1. Cabin demand: net cabin-job line qty against stock -> shortfall per item. */
  const lines = await fetchAllRanged<{ item_id: string | null; qty: number }>((from, to, withCount) =>
    supabase
      .from("cabin_job_lines")
      .select("item_id, qty", withCount ? { count: "exact" } : {})
      .not("item_id", "is", null)
      .range(from, to),
  );
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
  const resolveSheet = (finish: string, thickness: number | null): { id: string; code: string; name: string } | null => {
    const cands = sheets.filter((s) => sheetMatchesFinish(s.name, finish));
    if (cands.length === 0) return null;
    const exact = cands.find((s) => thickness != null && s.thickness === thickness);
    return exact ?? cands[0];
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
    const inputSheet = Array.isArray(p.input_sheet) ? p.input_sheet[0] : p.input_sheet;
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
      const sheet = resolveSheet(finish, thickness);
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

export async function getCabinMrp(excludeKeys: string[] = []): Promise<CabinMrpPlan> {
  const key = excludeKeys.length ? [...excludeKeys].sort().join(",") : "__none__";
  return unstable_cache(() => _getCabinMrpUncached(excludeKeys), ["cabin-mrp", key], {
    revalidate: 300,
    tags: ["cabin-programs", "jobs", "items", "inventory-stock"],
  })();
}
