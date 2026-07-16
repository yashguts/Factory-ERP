"use server";

import { unstable_cache } from "next/cache";
import { _getMrpDataUncached } from "@/lib/actions/mrp";
import { computeMakePlanCore } from "@/lib/actions/make-plan-core";

/**
 * Make-shortfall PRODUCTION PLAN: the fewest-SHEETS set of AUDITED program runs
 * to cover the Make-type MRP shortfall. The owner-tuned selection optimiser now
 * lives in `make-plan-core.ts` (shared with the Weekly MRP board); this module
 * is the cached entry point + the presentation layer that turns the optimiser's
 * run set into the page's program/cover/output/blocked view.
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

export async function getMakeProductionPlan(
  cutoffDate?: string,
  excludeCodes?: string[],
  /** Optional explicit job scope (the MRP job picker): the plan is optimised
   *  for exactly these jobs' demand (status + cutoff ignored — owner picked). */
  jobIds?: string[],
): Promise<MakeProductionPlan> {
  const excl = [...new Set((excludeCodes ?? []).map((c) => c.trim()).filter(Boolean))].sort();
  const scope = jobIds && jobIds.length ? [...jobIds].sort().join(",") : "__all__";
  const key = `${cutoffDate ?? "__all__"}|${excl.join("§")}|${scope}`;
  return unstable_cache(_getPlanUncached, ["make-production-plan", key], {
    revalidate: 1800,
    // "cabin-jobs": Car Linton demand (from cabin_job_lines) folds into the MRP
    // rows this plan consumes, so cabin edits must refresh the plan.
    tags: ["jobs", "bom-lines", "items", "inventory-stock", "operations", "cabin-jobs"],
  })(cutoffDate, excl, jobIds);
}

async function _getPlanUncached(cutoffDate?: string, excludeCodes: string[] = [], jobIds?: string[]): Promise<MakeProductionPlan> {
  // Un-nested read: this fn is wrapped in unstable_cache, and calling the cached
  // getMrpData here would nest unstable_cache and make the OUTER make-plan cache
  // degrade to pass-through — re-running the whole optimiser on every request.
  // Passed UN-awaited: the core launches its own prefetches first, so the MRP
  // chain's round-trips overlap them instead of running strictly before.
  const mrp = _getMrpDataUncached(cutoffDate, false, jobIds && jobIds.length ? jobIds : null);
  const core = await computeMakePlanCore(excludeCodes, mrp);
  if (core.empty) return empty(cutoffDate ?? null, excludeCodes);

  const {
    short, makeable, statusOf, pend, itemInfo, catProc, ops,
    leafProduce, progOut, progOutOriginal, inputsOf, fullOut, finishedByLeaf,
    runs, runsSheets, sheetsSimple,
  } = core;

  // Presentation helpers (rebuilt from the core's itemInfo + category tree).
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

  const plan: PlanProgram[] = [];
  // Global need allocation for the outputs view: each part's need is handed
  // out ONCE across all selected programs (no double counting), crediting the
  // SMALLEST contributors first.
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
    const opOuts = progOut.get(op) ?? progOutOriginal.get(op) ?? new Map<string, number>();
    const coverParts = [...opOuts.keys()].filter((p) => leafProduce.has(p));
    const used = coverParts.reduce((s, p) => s + Math.min(leafProduce.get(p)!, r * (opOuts.get(p) ?? 0)), 0);
    const covers: PlanCover[] = coverParts
      .map((p) => {
        const perRun = opOuts.get(p) ?? 0;
        const qty = Math.min(leafProduce.get(p) ?? 0, r * perRun);
        const feeds: PlanFeed[] = [...(finishedByLeaf.get(p) ?? [])]
          .filter((f) => f !== p)
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
