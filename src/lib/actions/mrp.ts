"use server";

import { createClient } from "@/lib/supabase/server";

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
}

export async function getMrpData(cutoffDate?: string): Promise<MrpRow[]> {
  const supabase = await createClient();

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

  const reqMap = new Map<string, { total: number; bomIds: Set<string> }>();
  for (const line of allLines) {
    const existing = reqMap.get(line.item_id);
    if (existing) {
      existing.total += Number(line.required_quantity);
      existing.bomIds.add(line.job_bom_id);
    } else {
      reqMap.set(line.item_id, {
        total: Number(line.required_quantity),
        bomIds: new Set([line.job_bom_id]),
      });
    }
  }

  if (reqMap.size === 0) return [];

  const itemIds = Array.from(reqMap.keys());

  let allItems: any[] = [];
  for (let i = 0; i < itemIds.length; i += 200) {
    const batch = itemIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("items")
      .select(`
        id, code, name, item_type,
        category:item_categories!items_category_id_fkey(name),
        uom:units_of_measurement(abbreviation),
        inventory(quantity)
      `)
      .in("id", batch);
    if (error) throw error;
    allItems = allItems.concat(data ?? []);
  }

  // Count jobs per bom_header_id
  let headerToJob = new Map<string, string>();
  const allBomIds = new Set<string>();
  for (const entry of reqMap.values()) {
    for (const bid of entry.bomIds) allBomIds.add(bid);
  }
  const bomIdArr = Array.from(allBomIds);
  for (let i = 0; i < bomIdArr.length; i += 200) {
    const batch = bomIdArr.slice(i, i + 200);
    const { data, error } = await supabase
      .from("job_bom_headers")
      .select("id, job_id")
      .in("id", batch);
    if (error) throw error;
    for (const h of data ?? []) {
      headerToJob.set(h.id, h.job_id);
    }
  }

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
    };
  });

  rows.sort((a, b) => b.shortfall - a.shortfall);
  return rows;
}
