"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag } from "next/cache";

export interface UnmatchedPattern {
  category: string;
  variant: string | null;
  value_text: string | null;
  count: number;
  jobs_affected: number;
  sample_job_numbers: string[];
}

export interface ItemOption {
  id: string;
  code: string;
  name: string;
  lookup_key: string | null;
  item_type: string;
  category_name: string | null;
}

/** Get all unique unmatched BOM patterns (item_id IS NULL), grouped */
export async function getUnmatchedBomSummary(): Promise<UnmatchedPattern[]> {
  const supabase = await createClient();

  // Fetch all unmatched lines with their job info
  const PAGE = 1000;
  let allLines: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("job_bom_lines")
      .select(`
        category, variant, value_text,
        job_bom_header:job_bom_headers!inner(
          job:jobs!inner(job_number)
        )
      `)
      .is("item_id", null)
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    allLines = allLines.concat(data ?? []);
    if (!data || data.length < PAGE) break;
    offset += PAGE;
  }

  // Group by (category, variant, value_text)
  const groups = new Map<string, {
    category: string;
    variant: string | null;
    value_text: string | null;
    count: number;
    jobNumbers: Set<string>;
  }>();

  for (const line of allLines) {
    const key = `${line.category}||${line.variant}||${line.value_text}`;
    if (!groups.has(key)) {
      groups.set(key, {
        category: line.category,
        variant: line.variant,
        value_text: line.value_text,
        count: 0,
        jobNumbers: new Set(),
      });
    }
    const g = groups.get(key)!;
    g.count++;
    const jobNum = line.job_bom_header?.job?.job_number;
    if (jobNum) g.jobNumbers.add(jobNum);
  }

  return Array.from(groups.values())
    .map((g) => ({
      category: g.category,
      variant: g.variant,
      value_text: g.value_text,
      count: g.count,
      jobs_affected: g.jobNumbers.size,
      sample_job_numbers: Array.from(g.jobNumbers).slice(0, 5),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Get total count of unmatched BOM lines */
export const getUnmatchedCount = unstable_cache(
  async (): Promise<number> => {
    const supabase = createCacheClient();
    const { count, error } = await supabase
      .from("job_bom_lines")
      .select("id", { count: "exact", head: true })
      .is("item_id", null);

    if (error) throw error;
    return count ?? 0;
  },
  ["unmatched-count"],
  { revalidate: 600, tags: ["bom-lines"] },
);

/** Search inventory items by name/code/lookup_key */
export async function searchItemsForMapping(query: string): Promise<ItemOption[]> {
  const supabase = await createClient();
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabase
    .from("items")
    .select(`
      id, code, name, lookup_key, item_type,
      category:item_categories(name)
    `)
    .or(`name.ilike.%${q}%,code.ilike.%${q}%,lookup_key.ilike.%${q}%`)
    .limit(20);

  if (error) throw error;

  return (data ?? []).map((item: any) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    lookup_key: item.lookup_key,
    item_type: item.item_type,
    category_name: item.category?.name ?? null,
  }));
}

/** Map all BOM lines matching a pattern to an inventory item */
export async function bulkMapBomLines(
  category: string,
  variant: string | null,
  valueText: string | null,
  itemId: string,
): Promise<{ updated: number }> {
  const supabase = await createClient();

  // Build query to find matching lines
  let query = supabase
    .from("job_bom_lines")
    .select("id")
    .is("item_id", null)
    .eq("category", category);

  if (variant === null) {
    query = query.is("variant", null);
  } else {
    query = query.eq("variant", variant);
  }

  if (valueText === null) {
    query = query.is("value_text", null);
  } else {
    query = query.eq("value_text", valueText);
  }

  const { data: lines, error: fetchErr } = await query;
  if (fetchErr) throw fetchErr;
  if (!lines || lines.length === 0) return { updated: 0 };

  // Update in batches
  const BATCH = 200;
  let updated = 0;
  for (let i = 0; i < lines.length; i += BATCH) {
    const ids = lines.slice(i, i + BATCH).map((l) => l.id);
    const { error: updateErr } = await supabase
      .from("job_bom_lines")
      .update({ item_id: itemId })
      .in("id", ids);
    if (updateErr) throw updateErr;
    updated += ids.length;
  }

  revalidateTag("bom-lines");
  return { updated };
}

/** Create a new inventory item and map all matching BOM lines to it */
export async function createItemAndMap(
  itemData: {
    name: string;
    code: string;
    lookup_key: string;
    item_type: string;
  },
  category: string,
  variant: string | null,
  valueText: string | null,
): Promise<{ itemId: string; updated: number }> {
  const supabase = await createClient();

  // Default UoM = Pieces
  const PIECES_UOM_ID = "9ed3b796-f2a3-4336-8479-6db47c7a95ef";

  const { data: item, error: itemErr } = await supabase
    .from("items")
    .insert({
      name: itemData.name,
      code: itemData.code,
      lookup_key: itemData.lookup_key,
      item_type: itemData.item_type,
      uom_id: PIECES_UOM_ID,
      is_active: true,
      minimum_stock: 0,
      reorder_point: 0,
      lead_time_days: 0,
      cost_price: 0,
    })
    .select("id")
    .single();

  if (itemErr) throw itemErr;

  const { updated } = await bulkMapBomLines(category, variant, valueText, item.id);
  revalidateTag("items");
  return { itemId: item.id, updated };
}
