"use server";

/**
 * CABIN MRP — programs to cut for the cabin demand, using the SAME owner-locked
 * optimiser as Make MRP (selectRuns from make-plan-core). The finish dimension is
 * resolved here, BEFORE the optimiser: each cabin program × each demanded finish
 * becomes a concrete candidate (output = the family+finish panel item, input = the
 * sheet of that finish & thickness). The optimiser then minimises sheets across all
 * those finish-specific candidates. Demanded items with no audited program, or a
 * finish with no matching sheet, surface as "not currently mapped".
 */
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { selectRuns, type OpOuts } from "@/lib/actions/make-plan-core";
import { sheetThicknessMm } from "@/lib/cabin/cabin-program-meta";

export interface CabinPlanMake {
  code: string;
  name: string;
  finish: string;
  qty: number;
}
export interface CabinPlanProgram {
  program_id: string;
  code: string | null;
  name: string;
  category: string;
  finish: string;
  runs: number;
  sheet_code: string | null;
  sheet_name: string | null;
  thickness_mm: number | null;
  makes: CabinPlanMake[];
}
export interface CabinPlanSheet {
  code: string;
  name: string;
  finish: string;
  thickness_mm: number | null;
  sheets: number;
}
export interface CabinPlanUnmapped {
  item_id: string;
  code: string;
  name: string;
  finish: string | null;
  need: number;
  /** "no-program" = nothing produces this item+finish; "no-sheet" = a program does
   *  but no sheet of that finish/thickness exists to cut from. */
  reason: "no-program" | "no-sheet";
}
export interface CabinMrpPlan {
  programs: CabinPlanProgram[];
  sheets: CabinPlanSheet[];
  unmapped: CabinPlanUnmapped[];
  totals: { runs: number; sheets: number; demandedItems: number; coveredItems: number; auditedPrograms: number };
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
  // designer finish: every word must appear in the sheet name
  return f.split(/\s+/).filter(Boolean).every((w) => n.includes(w));
}

const _getCabinMrpUncached = async (): Promise<CabinMrpPlan> => {
  const supabase = createCacheClient();

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
  if (demandByItem.size === 0) {
    return { programs: [], sheets: [], unmapped: [], totals: { runs: 0, sheets: 0, demandedItems: 0, coveredItems: 0, auditedPrograms: 0 } };
  }

  // Item identity + stock for the demanded items.
  const itemIds = [...demandByItem.keys()];
  const itemInfo = new Map<string, { code: string; name: string; family: string | null; finish: string | null; stock: number }>();
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await supabase
      .from("items")
      .select("id, code, name, family, finish, inventory(quantity)")
      .in("id", itemIds.slice(i, i + 200));
    for (const it of (data ?? []) as any[]) {
      const stock = Array.isArray(it.inventory) ? it.inventory.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0) : 0;
      itemInfo.set(it.id as string, {
        code: it.code as string,
        name: it.name as string,
        family: (it.family as string | null) ?? null,
        finish: (it.finish as string | null) ?? null,
        stock,
      });
    }
  }

  // Shortfall demand (what actually needs cutting).
  const shortfall = new Map<string, number>();
  for (const [id, dem] of demandByItem) {
    const info = itemInfo.get(id);
    if (!info) continue;
    const need = Math.max(0, dem - info.stock);
    if (need > 0) shortfall.set(id, need);
  }
  // Resolver: demanded item by (family, finish) — lets a program output (a family)
  // map to the concrete demanded panel for a finish.
  const demandByFamFinish = new Map<string, string>();
  for (const id of shortfall.keys()) {
    const info = itemInfo.get(id)!;
    if (info.family && info.finish) demandByFamFinish.set(`${info.family}|||${info.finish}`, id);
  }

  /* 2. Audited cabin programs + their outputs, finishes, input sheet. */
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

  /* 3. Sheet inventory, for resolving "a sheet of finish F & thickness T". */
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

  /* 4. Build finish-resolved candidates and feed the optimiser. */
  const progOut: OpOuts = new Map();
  const inputsOf = new Map<string, Map<string, number>>();
  // candidate meta + which demanded items each candidate can produce
  const candMeta = new Map<string, { program: any; finish: string; sheet: { id: string; code: string; name: string } | null }>();
  // track coverage so we can classify unmapped items
  const coveredByProgram = new Set<string>(); // item_ids a program could produce IF a sheet existed
  const coveredRunnable = new Set<string>(); // item_ids a runnable candidate produces

  for (const p of programs) {
    const outs = outsByProg.get(p.id as string) ?? [];
    const fins = finsByProg.get(p.id as string) ?? [];
    const inputSheet = Array.isArray(p.input_sheet) ? p.input_sheet[0] : p.input_sheet;
    const thickness = sheetThicknessMm(inputSheet?.name);
    const sheetsPerRun = Number(p.sheets_per_run ?? 1) || 1;

    for (const finish of fins) {
      // resolve this candidate's produced DEMANDED items
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
      if (produced.size === 0) continue; // produces nothing demanded in this finish

      const sheet = resolveSheet(finish, thickness);
      if (!sheet) continue; // no sheet for this finish -> not runnable (flagged below)

      const candId = `${p.id}::${finish}`;
      progOut.set(candId, produced);
      inputsOf.set(candId, new Map([[sheet.id, sheetsPerRun]]));
      candMeta.set(candId, { program: p, finish, sheet });
      for (const id of produced.keys()) coveredRunnable.add(id);
    }
  }

  // leafProduce = demanded items that SOME runnable candidate can make.
  const leafProduce = new Map<string, number>();
  for (const [id, need] of shortfall) if (coveredRunnable.has(id)) leafProduce.set(id, need);

  let runs = new Map<string, number>();
  if (leafProduce.size > 0) {
    const r = selectRuns(progOut, inputsOf, leafProduce);
    runs = r.runs;
  }

  /* 5. Assemble the result. */
  const programsOut: CabinPlanProgram[] = [];
  const sheetAgg = new Map<string, CabinPlanSheet>();
  for (const [candId, runCount] of runs) {
    if (runCount <= 0) continue;
    const meta = candMeta.get(candId)!;
    const p = meta.program;
    const outItems = progOut.get(candId)!;
    const makes: CabinPlanMake[] = [...outItems.entries()].map(([itemId, qpr]) => {
      const info = itemInfo.get(itemId)!;
      return { code: info.code, name: info.name, finish: meta.finish, qty: Math.round(qpr * runCount) };
    });
    const thickness = sheetThicknessMm(meta.sheet?.name);
    programsOut.push({
      program_id: p.id as string,
      code: (p.code as string | null) ?? null,
      name: p.name as string,
      category: p.category as string,
      finish: meta.finish,
      runs: runCount,
      sheet_code: meta.sheet?.code ?? null,
      sheet_name: meta.sheet?.name ?? null,
      thickness_mm: thickness,
      makes: makes.sort((a, b) => b.qty - a.qty),
    });
    if (meta.sheet) {
      const sheetsPerRun = Number(p.sheets_per_run ?? 1) || 1;
      const key = meta.sheet.id;
      const ex = sheetAgg.get(key) ?? { code: meta.sheet.code, name: meta.sheet.name, finish: meta.finish, thickness_mm: thickness, sheets: 0 };
      ex.sheets += Math.ceil(sheetsPerRun * runCount);
      sheetAgg.set(key, ex);
    }
  }
  programsOut.sort((a, b) => a.category.localeCompare(b.category) || b.runs - a.runs || a.name.localeCompare(b.name));

  // Unmapped: demanded items not produced by any runnable candidate.
  const unmapped: CabinPlanUnmapped[] = [];
  for (const [id, need] of shortfall) {
    if (coveredRunnable.has(id)) continue;
    const info = itemInfo.get(id)!;
    unmapped.push({
      item_id: id,
      code: info.code,
      name: info.name,
      finish: info.finish,
      need: Math.round(need),
      reason: coveredByProgram.has(id) ? "no-sheet" : "no-program",
    });
  }
  unmapped.sort((a, b) => b.need - a.need);

  const totalRuns = [...runs.values()].reduce((s, x) => s + x, 0);
  const totalSheets = [...sheetAgg.values()].reduce((s, x) => s + x.sheets, 0);
  return {
    programs: programsOut,
    sheets: [...sheetAgg.values()].sort((a, b) => b.sheets - a.sheets),
    unmapped,
    totals: {
      runs: totalRuns,
      sheets: totalSheets,
      demandedItems: shortfall.size,
      coveredItems: coveredRunnable.size,
      auditedPrograms,
    },
  };
};

export async function getCabinMrp(): Promise<CabinMrpPlan> {
  return unstable_cache(_getCabinMrpUncached, ["cabin-mrp"], {
    revalidate: 300,
    tags: ["cabin-programs", "jobs", "items", "inventory-stock"],
  })();
}
