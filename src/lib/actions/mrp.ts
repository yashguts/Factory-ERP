"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";

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
      .select("item_id, required_quantity, job_bom_id")
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

  // total = sum of required_quantity across all BOM lines for the item
  // (previously this just counted lines, which under-reported requirements
  // whenever a job needed more than 1 of something).
  const reqMap = new Map<string, { total: number; bomIds: Set<string> }>();
  for (const line of allLines) {
    const qty = Number(line.required_quantity) || 0;
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
    job_bom_id: string;
    required_quantity: number;
  }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("job_bom_lines")
      .select("job_bom_id, required_quantity")
      .eq("item_id", itemId)
      .gt("required_quantity", 0)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    allLines = allLines.concat(data ?? []);
    if (!data || data.length < PAGE) break;
    offset += PAGE;
  }
  if (allLines.length === 0) return [];

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
    const agg = byJob.get(jobId) ?? { line_count: 0, total_quantity: 0 };
    agg.line_count += 1;
    agg.total_quantity += Number(line.required_quantity);
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
