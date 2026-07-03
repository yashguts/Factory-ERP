"use server";

/**
 * Stock-aware reader for the Cabin Inventory type pages. Same RPC + return shape
 * as cabin.ts's getCabinTypePage, but passes the new p_stock filter (migration
 * 055) so the page can filter by stock state exactly like /inventory. Kept in a
 * separate file so the (parallel-edited) cabin.ts is left untouched.
 */
import { createCacheClient } from "@/lib/supabase/cache-client";
import type { CabinTypePageResult } from "@/lib/actions/cabin";

export interface CabinTypeViewQuery {
  typeId: string;
  search?: string;
  sub?: string; // sub-category NAME | "all"
  stock?: string; // all | in_stock | zero
  sort?: string; // code | name | stock
  dir?: string; // asc | desc
  page?: number;
  pageSize?: number;
}

export async function getCabinTypeView(
  q: CabinTypeViewQuery,
): Promise<CabinTypePageResult> {
  if (!q.typeId) return { rows: [], total: 0, inStock: 0, typeTotal: 0 };
  const pageSize = q.pageSize ?? 100;
  const page = Math.max(1, q.page ?? 1);

  const supabase = createCacheClient();
  const { data, error } = await supabase.rpc("search_cabin_type", {
    p_type_category_id: q.typeId,
    p_search: q.search?.trim() ? q.search.trim() : null,
    p_sub: q.sub && q.sub !== "all" ? q.sub : null,
    p_stock: q.stock && q.stock !== "all" ? q.stock : null,
    p_sort: q.sort ?? "name",
    p_dir: q.dir ?? "asc",
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) throw error;

  const rows = (data ?? []) as Record<string, unknown>[];
  const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
  const inStock = rows.length > 0 ? Number(rows[0].in_stock_count ?? 0) : 0;
  const typeTotal = rows.length > 0 ? Number(rows[0].type_total ?? 0) : 0;
  return {
    total,
    inStock,
    typeTotal,
    rows: rows.map((r) => ({
      id: r.id as string,
      code: r.code as string,
      name: r.name as string,
      sub_category: (r.sub_category_name as string | null) ?? null,
      uom: (r.uom_abbreviation as string | null) ?? "",
      total_stock: Number(r.total_stock ?? 0),
      stock_behaviour: (r.stock_behaviour as string | null) ?? "stocked",
    })),
  };
}
