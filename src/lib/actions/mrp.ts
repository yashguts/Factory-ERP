"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { getItemsWithStock } from "@/lib/actions/inventory";

export interface MrpRow {
  item_id: string;
  item_code: string;
  item_name: string;
  item_type: string;
  category_name: string | null;
  uom_abbreviation: string | null;
  total_required: number;
  total_stock: number;
  shortfall: number;
  job_count: number;
  /**
   * Effective procurement type. items.procurement_type takes precedence;
   * falls back to the (sub-)category's procurement_type. NULL only when
   * neither is set (shouldn't happen with current data but guarded for
   * future categories that haven't been classified yet).
   */
  procurement_type: "make" | "trade" | null;
}

export async function getMrpData(cutoffDate?: string): Promise<MrpRow[]> {
  const key = cutoffDate ?? "__all__";
  return unstable_cache(
    _getMrpDataUncached,
    ["mrp-data", key],
    { revalidate: 60, tags: ["jobs", "bom-lines", "items", "inventory-stock"] },
  )(cutoffDate);
}

async function _getMrpDataUncached(cutoffDate?: string): Promise<MrpRow[]> {
  const supabase = createCacheClient();

  let jobIdsFilter: string[] | null = null;

  if (cutoffDate) {
    const PAGE = 1000;
    let allJobs: any[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("jobs")
        .select("id")
        .lte("requirement_dispatch_date", cutoffDate)
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      allJobs = allJobs.concat(data ?? []);
      if (!data || data.length < PAGE) break;
      offset += PAGE;
    }
    jobIdsFilter = allJobs.map((j) => j.id);
    if (jobIdsFilter.length === 0) return [];
  }

  let bomHeaderIds: string[] | null = null;
  if (jobIdsFilter) {
    const PAGE = 1000;
    let allHeaders: any[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("job_bom_headers")
        .select("id")
        .in("job_id", jobIdsFilter)
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      allHeaders = allHeaders.concat(data ?? []);
      if (!data || data.length < PAGE) break;
      offset += PAGE;
    }
    bomHeaderIds = allHeaders.map((h) => h.id);
    if (bomHeaderIds.length === 0) return [];
  }

  const PAGE = 1000;
  let allLines: any[] = [];
  let offset = 0;
  while (true) {
    let query = supabase
      .from("job_bom_lines")
      .select("id, item_id, required_quantity, job_bom_id")
      .not("item_id", "is", null)
      .gt("required_quantity", 0);

    if (bomHeaderIds) {
      query = query.in("job_bom_id", bomHeaderIds);
    }

    const { data, error } = await query.range(offset, offset + PAGE - 1);
    if (error) throw error;
    allLines = allLines.concat(data ?? []);
    if (!data || data.length < PAGE) break;
    offset += PAGE;
  }

  // Dispatched-so-far per BOM line. Dispatch (any phase: first/second/full) is
  // netted out of MRP demand, so already-shipped material stops showing as
  // "required". Keyed by job_bom_line_id — the same definition the dispatch
  // panel uses for "Remaining" (getJobDispatchSummary). Ad-hoc dispatch lines
  // (null job_bom_line_id) aren't tied to a BOM line, so they don't reduce demand.
  const dispatchedByLine = new Map<string, number>();
  {
    const PAGE_D = 1000;
    let offsetD = 0;
    while (true) {
      const { data, error } = await supabase
        .from("job_dispatch_lines")
        .select("job_bom_line_id, qty")
        .not("job_bom_line_id", "is", null)
        .range(offsetD, offsetD + PAGE_D - 1);
      if (error) throw error;
      for (const d of data ?? []) {
        const lineId = d.job_bom_line_id as string;
        dispatchedByLine.set(
          lineId,
          (dispatchedByLine.get(lineId) ?? 0) + (Number(d.qty) || 0),
        );
      }
      if (!data || data.length < PAGE_D) break;
      offsetD += PAGE_D;
    }
  }

  // total = sum of NET required_quantity across all BOM lines for the item,
  // where net = required − dispatched (floored at 0). Lines fully dispatched
  // contribute nothing; an item whose lines all net to 0 drops out entirely.
  const reqMap = new Map<string, { total: number; bomIds: Set<string> }>();
  for (const line of allLines) {
    const required = Number(line.required_quantity) || 0;
    const dispatched = dispatchedByLine.get(line.id) ?? 0;
    const qty = Math.max(0, required - dispatched);
    if (qty <= 0) continue; // fully dispatched — no remaining demand
    const existing = reqMap.get(line.item_id);
    if (existing) {
      existing.total += qty;
      existing.bomIds.add(line.job_bom_id);
    } else {
      reqMap.set(line.item_id, {
        total: qty,
        bomIds: new Set([line.job_bom_id]),
      });
    }
  }

  if (reqMap.size === 0) return [];

  const itemIds = Array.from(reqMap.keys());

  // Collect all BOM header IDs we need to resolve
  const allBomIds = new Set<string>();
  for (const entry of reqMap.values()) {
    for (const bid of entry.bomIds) allBomIds.add(bid);
  }
  const bomIdArr = Array.from(allBomIds);

  // Fetch items AND header-to-job mapping IN PARALLEL (both are batched)
  const [allItems, headerToJob] = await Promise.all([
    // Items with inventory stock
    (async () => {
      const batches = [];
      for (let i = 0; i < itemIds.length; i += 200) {
        batches.push(
          supabase
            .from("items")
            .select(`
              id, code, name, item_type, procurement_type,
              category:item_categories!items_category_id_fkey(name, procurement_type),
              uom:units_of_measurement(abbreviation),
              inventory(quantity)
            `)
            .in("id", itemIds.slice(i, i + 200)),
        );
      }
      const results = await Promise.all(batches);
      const items: any[] = [];
      for (const r of results) {
        if (r.error) throw r.error;
        items.push(...(r.data ?? []));
      }
      return items;
    })(),
    // BOM header → job mapping
    (async () => {
      const map = new Map<string, string>();
      const batches = [];
      for (let i = 0; i < bomIdArr.length; i += 200) {
        batches.push(
          supabase
            .from("job_bom_headers")
            .select("id, job_id")
            .in("id", bomIdArr.slice(i, i + 200)),
        );
      }
      const results = await Promise.all(batches);
      for (const r of results) {
        if (r.error) throw r.error;
        for (const h of r.data ?? []) {
          map.set(h.id, h.job_id);
        }
      }
      return map;
    })(),
  ]);

  const rows: MrpRow[] = allItems.map((item) => {
    const req = reqMap.get(item.id)!;
    const totalStock = (item.inventory ?? []).reduce(
      (sum: number, inv: { quantity: number }) => sum + Number(inv.quantity),
      0,
    );
    const jobIds = new Set<string>();
    for (const bid of req.bomIds) {
      const jid = headerToJob.get(bid);
      if (jid) jobIds.add(jid);
    }

    // Effective procurement type: item-level override wins, else
    // inherit from the (sub-)category. Null if neither is set.
    const procurement_type: "make" | "trade" | null =
      (item.procurement_type as "make" | "trade" | null) ??
      ((item.category?.procurement_type ?? null) as
        | "make"
        | "trade"
        | null);

    return {
      item_id: item.id,
      item_code: item.code,
      item_name: item.name,
      item_type: item.item_type,
      category_name: item.category?.name ?? null,
      uom_abbreviation: item.uom?.abbreviation ?? null,
      total_required: req.total,
      total_stock: totalStock,
      shortfall: Math.max(0, req.total - totalStock),
      job_count: jobIds.size,
      procurement_type,
    };
  });

  rows.sort((a, b) => b.shortfall - a.shortfall);
  return rows;
}

/* ================================================================== */
/*  Multi-level explosion -> raw-material / purchased buy list         */
/*                                                                    */
/*  Walks job demand top-down: each make item explodes through its    */
/*  parts list (item_bom_lines, finish-resolved) and/or the program   */
/*  that cuts it, down to raw sheets + purchased parts. Phantoms are   */
/*  byproducts of a run and never appear as demand, so they drop out   */
/*  naturally. NOTE: nesting/yield optimisation is intentionally NOT   */
/*  solved — sheet demand is rolled up per program at whole runs,      */
/*  which is conservative (never under-orders). Treat as an estimate   */
/*  to validate by hand against one door's program.                   */
/* ================================================================== */

export interface PlanLeaf {
  item_id: string;
  code: string;
  name: string;
  uom: string | null;
  qty: number;
  in_stock: number;
  shortfall: number;
}
export interface ProductionPlan {
  cutoffDate: string | null;
  /** Raw sheets / materials to buy (program inputs + un-recipe'd raw items). */
  rawMaterials: PlanLeaf[];
  /** Purchased (trade) parts to buy. */
  purchased: PlanLeaf[];
  /** Make items with no program and no parts list — can't explode (flag). */
  unresolved: { item_id: string; code: string; name: string; qty: number }[];
  /** Program run counts (for reference / shop scheduling). */
  programRuns: { program_id: string; code: string | null; name: string; runs: number }[];
}

async function fetchAllRows(
  build: (offset: number, page: number) => PromiseLike<{ data: any[] | null; error: any }>,
): Promise<any[]> {
  const PAGE = 1000;
  let all: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await build(offset, PAGE);
    if (error) throw error;
    all = all.concat(data ?? []);
    if (!data || data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export async function getProductionPlan(
  cutoffDate?: string,
): Promise<ProductionPlan> {
  const key = cutoffDate ?? "__all__";
  return unstable_cache(
    _getProductionPlanUncached,
    ["production-plan", key],
    { revalidate: 60, tags: ["jobs", "bom-lines", "items", "inventory-stock", "operations"] },
  )(cutoffDate);
}

async function _getProductionPlanUncached(
  cutoffDate?: string,
): Promise<ProductionPlan> {
  const supabase = createCacheClient();

  // Top-level demand + every active item (procurement, family/finish, stock).
  const [demand, items] = await Promise.all([
    getMrpData(cutoffDate),
    getItemsWithStock(),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));

  // item -> the program that produces it + that output's qty/run. Includes
  // both 'component' outputs (stocked make-items) and 'cut_part' outputs that
  // link to a phantom item, so a phantom loose-part child of an assembly still
  // explodes through the program that cuts it down to its sheet.
  const outRows = await fetchAllRows((off, page) =>
    supabase
      .from("operation_outputs")
      .select("operation_id, item_id, qty_per_run")
      .in("role", ["component", "cut_part"])
      .not("item_id", "is", null)
      .range(off, off + page - 1),
  );
  const itemToProgram = new Map<string, { programId: string; outQty: number }>();
  for (const o of outRows) {
    if (!itemToProgram.has(o.item_id)) {
      itemToProgram.set(o.item_id, {
        programId: o.operation_id,
        outQty: Number(o.qty_per_run) || 1,
      });
    }
  }

  // program -> its input lines (sheets/bought).
  const inRows = await fetchAllRows((off, page) =>
    supabase
      .from("operation_inputs")
      .select("operation_id, item_id, qty_per_run")
      .not("item_id", "is", null)
      .range(off, off + page - 1),
  );
  const programInputs = new Map<string, { item_id: string; qty: number }[]>();
  for (const i of inRows) {
    const arr = programInputs.get(i.operation_id) ?? [];
    arr.push({ item_id: i.item_id, qty: Number(i.qty_per_run) || 0 });
    programInputs.set(i.operation_id, arr);
  }

  // assembly parts lists.
  const bomRows = await fetchAllRows((off, page) =>
    supabase
      .from("item_bom_lines")
      .select("parent_item_id, child_item_id, child_family, qty, finish_rule, pinned_finish")
      .range(off, off + page - 1),
  );
  const bomByParent = new Map<string, any[]>();
  for (const b of bomRows) {
    const arr = bomByParent.get(b.parent_item_id) ?? [];
    arr.push(b);
    bomByParent.set(b.parent_item_id, arr);
  }

  // family+finish -> item, for inherit/pinned resolution.
  const familyFinishToItem = new Map<string, string>();
  for (const it of items) {
    if (it.family && it.finish) {
      familyFinishToItem.set(`${it.family}|||${it.finish}`, it.id);
    }
  }

  // program-name lookup (only needed for the few programs we actually run).
  const programIdsUsed = new Set<string>();

  const programRuns = new Map<string, number>();
  const purchased = new Map<string, number>();
  const rawLeaf = new Map<string, number>();
  const unresolved = new Map<string, number>();

  const resolveChild = (line: any, parentFinish: string | null): string | null => {
    if (line.finish_rule === "neutral") return line.child_item_id;
    const fam = line.child_family;
    const finish = line.finish_rule === "pinned" ? line.pinned_finish : parentFinish;
    if (fam && finish) {
      const hit = familyFinishToItem.get(`${fam}|||${finish}`);
      if (hit) return hit;
    }
    return line.child_item_id; // fall back to the representative child
  };

  const explode = (
    itemId: string,
    qty: number,
    parentFinish: string | null,
    visited: Set<string>,
    depth: number,
  ): void => {
    const it = itemById.get(itemId);
    if (!it) return; // inactive/unknown — ignore
    if (depth > 12 || visited.has(itemId)) {
      unresolved.set(itemId, (unresolved.get(itemId) ?? 0) + qty);
      return;
    }
    if (it.effective_procurement_type === "trade") {
      purchased.set(itemId, (purchased.get(itemId) ?? 0) + qty);
      return;
    }
    const bom = bomByParent.get(itemId);
    if (bom && bom.length > 0) {
      const nv = new Set(visited);
      nv.add(itemId);
      for (const line of bom) {
        const childId = resolveChild(line, it.finish);
        if (childId) explode(childId, qty * (Number(line.qty) || 0), it.finish, nv, depth + 1);
      }
      return;
    }
    const prog = itemToProgram.get(itemId);
    if (prog) {
      const runs = qty / (prog.outQty || 1);
      programRuns.set(prog.programId, Math.max(programRuns.get(prog.programId) ?? 0, runs));
      programIdsUsed.add(prog.programId);
      return;
    }
    // make/unset with no recipe: raw material -> buy it; otherwise flag.
    if (it.item_type === "raw_material") {
      rawLeaf.set(itemId, (rawLeaf.get(itemId) ?? 0) + qty);
    } else {
      unresolved.set(itemId, (unresolved.get(itemId) ?? 0) + qty);
    }
  };

  for (const d of demand) {
    explode(d.item_id, d.total_required, itemById.get(d.item_id)?.finish ?? null, new Set(), 0);
  }

  // Roll up program input sheets at whole runs.
  const rawDemand = new Map<string, number>(rawLeaf);
  for (const [pid, runs] of programRuns) {
    const wholeRuns = Math.ceil(runs - 1e-9);
    for (const inp of programInputs.get(pid) ?? []) {
      const it = itemById.get(inp.item_id);
      const add = wholeRuns * inp.qty;
      if (it && it.effective_procurement_type === "trade") {
        purchased.set(inp.item_id, (purchased.get(inp.item_id) ?? 0) + add);
      } else {
        rawDemand.set(inp.item_id, (rawDemand.get(inp.item_id) ?? 0) + add);
      }
    }
  }

  const toLeaf = (m: Map<string, number>): PlanLeaf[] =>
    Array.from(m.entries())
      .map(([id, qty]) => {
        const it = itemById.get(id);
        const in_stock = it?.total_stock ?? 0;
        return {
          item_id: id,
          code: it?.code ?? "—",
          name: it?.name ?? "(unknown item)",
          uom: it?.uom?.abbreviation ?? null,
          qty,
          in_stock,
          shortfall: Math.max(0, qty - in_stock),
        };
      })
      .sort((a, b) => b.shortfall - a.shortfall);

  // Program names for the runs list.
  const usedIds = Array.from(programIdsUsed);
  const progNames = new Map<string, { code: string | null; name: string }>();
  for (let i = 0; i < usedIds.length; i += 200) {
    const { data } = await supabase
      .from("operations")
      .select("id, code, name")
      .in("id", usedIds.slice(i, i + 200));
    for (const p of data ?? []) progNames.set(p.id, { code: p.code ?? null, name: p.name });
  }

  return {
    cutoffDate: cutoffDate ?? null,
    rawMaterials: toLeaf(rawDemand),
    purchased: toLeaf(purchased),
    unresolved: Array.from(unresolved.entries())
      .map(([id, qty]) => {
        const it = itemById.get(id);
        return { item_id: id, code: it?.code ?? "—", name: it?.name ?? "(unknown)", qty };
      })
      .sort((a, b) => b.qty - a.qty),
    programRuns: Array.from(programRuns.entries())
      .map(([pid, runs]) => ({
        program_id: pid,
        code: progNames.get(pid)?.code ?? null,
        name: progNames.get(pid)?.name ?? "(program)",
        runs: Math.ceil(runs - 1e-9),
      }))
      .sort((a, b) => b.runs - a.runs),
  };
}

/* ================================================================== */
/*  Per-item job breakdown (hover popover on MRP table)               */
/* ================================================================== */

export interface MrpJobBreakdown {
  job_id: string;
  job_number: string;
  customer_name: string | null;
  requirement_dispatch_date: string | null;
  /** Number of BOM lines on this job that reference the item. */
  line_count: number;
  /** Sum of required_quantity across those lines. */
  total_quantity: number;
}

/**
 * For a given item, return every job whose BOM has at least one line
 * referencing that item (with required_quantity > 0), along with the
 * per-job count of lines and the sum of required quantities.
 *
 * Honors the same cutoffDate filter as `getMrpData` so the breakdown
 * stays consistent with the table the user is looking at.
 */
export async function getMrpItemJobs(
  itemId: string,
  cutoffDate?: string,
): Promise<MrpJobBreakdown[]> {
  const key = `${itemId}:${cutoffDate ?? "__all__"}`;
  return unstable_cache(
    (id: string, date?: string) => _getMrpItemJobsUncached(id, date),
    ["mrp-item-jobs", key],
    { revalidate: 60, tags: ["jobs", "bom-lines"] },
  )(itemId, cutoffDate);
}

async function _getMrpItemJobsUncached(
  itemId: string,
  cutoffDate?: string,
): Promise<MrpJobBreakdown[]> {
  const supabase = createCacheClient();

  // 1) Fetch BOM lines referencing this item with qty > 0.
  const PAGE = 1000;
  let allLines: Array<{
    id: string;
    job_bom_id: string;
    required_quantity: number;
  }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("job_bom_lines")
      .select("id, job_bom_id, required_quantity")
      .eq("item_id", itemId)
      .gt("required_quantity", 0)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    allLines = allLines.concat(data ?? []);
    if (!data || data.length < PAGE) break;
    offset += PAGE;
  }
  if (allLines.length === 0) return [];

  // Net out dispatched qty per BOM line (any phase), same as getMrpData, so a
  // fully-dispatched job stops appearing for this item and partials show only
  // the remaining qty.
  const dispatchedByLine = new Map<string, number>();
  const lineIds = allLines.map((l) => l.id);
  for (let i = 0; i < lineIds.length; i += 200) {
    const { data, error } = await supabase
      .from("job_dispatch_lines")
      .select("job_bom_line_id, qty")
      .in("job_bom_line_id", lineIds.slice(i, i + 200));
    if (error) throw error;
    for (const d of data ?? []) {
      const lid = d.job_bom_line_id as string;
      dispatchedByLine.set(lid, (dispatchedByLine.get(lid) ?? 0) + (Number(d.qty) || 0));
    }
  }

  // 2) Resolve BOM headers → job_id (in batches).
  const headerIds = Array.from(new Set(allLines.map((l) => l.job_bom_id)));
  const headerToJob = new Map<string, string>();
  for (let i = 0; i < headerIds.length; i += 200) {
    const { data, error } = await supabase
      .from("job_bom_headers")
      .select("id, job_id")
      .in("id", headerIds.slice(i, i + 200));
    if (error) throw error;
    for (const h of data ?? []) headerToJob.set(h.id, h.job_id);
  }

  // 3) Aggregate per job_id.
  const byJob = new Map<
    string,
    { line_count: number; total_quantity: number }
  >();
  for (const line of allLines) {
    const jobId = headerToJob.get(line.job_bom_id);
    if (!jobId) continue;
    const net = Math.max(
      0,
      (Number(line.required_quantity) || 0) - (dispatchedByLine.get(line.id) ?? 0),
    );
    if (net <= 0) continue; // fully dispatched on this line
    const agg = byJob.get(jobId) ?? { line_count: 0, total_quantity: 0 };
    agg.line_count += 1;
    agg.total_quantity += net;
    byJob.set(jobId, agg);
  }
  if (byJob.size === 0) return [];

  // 4) Fetch job metadata (optionally filtered by cutoff date).
  const jobIds = Array.from(byJob.keys());
  let jobs: Array<{
    id: string;
    job_number: string;
    customer_name: string | null;
    requirement_dispatch_date: string | null;
  }> = [];
  for (let i = 0; i < jobIds.length; i += 200) {
    let q = supabase
      .from("jobs")
      .select("id, job_number, customer_name, requirement_dispatch_date")
      .in("id", jobIds.slice(i, i + 200));
    if (cutoffDate) q = q.lte("requirement_dispatch_date", cutoffDate);
    const { data, error } = await q;
    if (error) throw error;
    jobs = jobs.concat(data ?? []);
  }

  // 5) Merge and return, sorted by largest contribution first.
  const out: MrpJobBreakdown[] = jobs.map((job) => {
    const agg = byJob.get(job.id)!;
    return {
      job_id: job.id,
      job_number: job.job_number,
      customer_name: job.customer_name,
      requirement_dispatch_date: job.requirement_dispatch_date,
      line_count: agg.line_count,
      total_quantity: agg.total_quantity,
    };
  });
  out.sort((a, b) => b.line_count - a.line_count);
  return out;
}
