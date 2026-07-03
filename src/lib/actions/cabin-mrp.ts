"use server";

/**
 * CABIN MRP — "programs to cut" for the cabin-job backlog.
 *
 * Rebuilt 2026-07-03. The original Cabin MRP planned against the standalone
 * `cabin_programs` tables (a finish-aware model: one program × a finish-set).
 * On 2026-06-27 cabin programs were folded into the main Programs catalogue
 * (`operations`, label 'Cabin Items') and are now maintained there as concrete,
 * per-finish programs — so `cabin_programs` is a frozen snapshot. This reader
 * therefore draws candidates from the **entire audited-programs universe**
 * (any audited, active `operations` program whose component outputs include a
 * demanded cabin item), then hands them to the SAME owner-locked optimiser
 * (`selectRuns` from make-plan-core) to pick the fewest sheets.
 *
 * Demand still comes from Cabin Jobs (`cabin_job_lines`), netted against stock
 * to a shortfall — identical to the old reader's demand side. The finish-set /
 * sheet-matching machinery is gone: a candidate is now a concrete program with
 * concrete output items and its own recorded sheet input(s).
 *
 * Deliberately a NEW file: the dormant `cabin-program-plan.ts` (still used by
 * the Requirements + Weekly demand views and Cabin Jobs) is left untouched.
 */
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { selectRuns, type OpOuts } from "@/lib/actions/make-plan-core";
import { sheetThicknessMm } from "@/lib/cabin/cabin-program-meta";
import type {
  CabinMrpPlan,
  CabinPlanProgram,
  CabinPlanSheet,
  CabinPlanBlocked,
  CabinPlanInput,
  CabinPlanOutput,
} from "@/lib/actions/cabin-program-plan";

/** Cabin jobs flagged "ready" are already built — their lines are excluded from
 *  the cutting demand. Returns the ids to filter out. */
async function readyCabinJobIds(
  supabase: ReturnType<typeof createCacheClient>,
): Promise<string[]> {
  const { data } = await supabase
    .from("cabin_jobs")
    .select("id")
    .not("marked_ready_at", "is", null);
  return (data ?? []).map((r: any) => r.id as string);
}

interface ItemInfo {
  code: string;
  name: string;
  finish: string | null;
  category: string | null;
  stock: number;
}

const _getCabinMrpUncached = async (excludeKeys: string[]): Promise<CabinMrpPlan> => {
  const supabase = createCacheClient();
  const excludeSet = new Set(excludeKeys);

  const empty: CabinMrpPlan = {
    plan: [], sheets: [], blocked: [], excluded: excludeKeys,
    totals: { demandedItems: 0, inStock: 0, toCut: 0, makeable: 0, blocked: 0, programs: 0, runs: 0, sheets: 0, machineSeconds: 0, auditedPrograms: 0 },
  };

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
      producedRows.push({
        operation_id: r.operation_id as string,
        item_id: r.item_id as string,
        qty_per_run: Number(r.qty_per_run ?? 1) || 1,
      });
    }
  }
  if (producedRows.length === 0) {
    // Demand exists but no program produces any of it — everything is blocked.
    const blocked: CabinPlanBlocked[] = [...shortfall].map(([id, need]) => {
      const info = itemInfo.get(id)!;
      return { item_id: id, code: info.code, name: info.name, finish: info.finish, category: info.category, need: Math.round(need), reason: "no-program" as const };
    }).sort((a, b) => b.need - a.need);
    return {
      plan: [], sheets: [], blocked, excluded: excludeKeys,
      totals: { demandedItems, inStock, toCut: shortfall.size, makeable: 0, blocked: blocked.length, programs: 0, runs: 0, sheets: 0, machineSeconds: 0, auditedPrograms: 0 },
    };
  }

  /* 4. Keep only AUDITED + active operations. Load their meta + sheet inputs. */
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
    const blocked: CabinPlanBlocked[] = [...shortfall].map(([id, need]) => {
      const info = itemInfo.get(id)!;
      return { item_id: id, code: info.code, name: info.name, finish: info.finish, category: info.category, need: Math.round(need), reason: "no-program" as const };
    }).sort((a, b) => b.need - a.need);
    return {
      plan: [], sheets: [], blocked, excluded: excludeKeys,
      totals: { demandedItems, inStock, toCut: shortfall.size, makeable: 0, blocked: blocked.length, programs: 0, runs: 0, sheets: 0, machineSeconds: 0, auditedPrograms: 0 },
    };
  }

  // Sheet inputs for the audited candidates.
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

  // Sheet item identity (code / name / thickness) for display.
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
    if (excludeSet.has(excludeKey)) continue; // Don't-run: drop this candidate

    // Grouping category + finish come from the demanded item this program makes
    // most of (its primary output), so a program lands in one section.
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
      excludeKey: cand,
      program_id: cm.opId,
      code: meta.code,
      name: meta.name,
      machine: meta.machine,
      category: cm.category,
      finish: cm.finish,
      runs: rc,
      machineSeconds,
      inputs,
      outputs,
      partsMade,
      extra,
    });
  }
  // Most-runs-first within a category (the client groups by category).
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
  return unstable_cache(() => _getCabinMrpUncached(excludeKeys), ["cabin-mrp-universe", key], {
    revalidate: 300,
    tags: ["cabin-programs", "operations", "jobs", "items", "inventory-stock"],
  })();
}
