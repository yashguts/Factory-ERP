"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import {
  resolveCategoryPaths,
  expandCategoryDescendants,
} from "@/lib/actions/categories";

export interface SearchableItem {
  id: string;
  code: string;
  name: string;
  /** Optional human-friendly key. Often more useful to show than `name`. */
  lookup_key: string | null;
  category_name: string | null;
  uom_abbreviation: string;
  /** Sum of inventory.quantity across all warehouses for this item. */
  total_stock: number;
  /** Finish-variant grouping (for BOM finish-rule resolution). */
  family: string | null;
  finish: string | null;
}

/**
 * Search inventory items with multi-token fuzzy matching, optionally scoped
 * to a set of category PATHS (e.g. "Large Purchased Items > Guide Rail").
 *
 * When `categoryPaths` is provided, the search:
 *  1. Resolves each path to a category ID.
 *  2. Expands each ID to include all descendant sub-categories.
 *  3. Filters items whose `category_id` is in that expanded set.
 *
 * So passing `["Filler Weight"]` returns items in `Filler Weight > Filler
 * Weight` AND `Filler Weight > Filler Weight Locking Bracket`.
 *
 * Each word in `query` must appear in the item name (AND logic).
 */
export async function searchItems(
  query: string,
  categoryPaths?: string[],
  limit = 50,
): Promise<SearchableItem[]> {
  // Use the cache-friendly anon client (no cookies). The SSR client's
  // cookie session can go stale on long-open tabs, which used to make
  // searches silently fail. This is a public, RLS-light read, so
  // dropping the cookie dependency is safe and more robust.
  const supabase = createCacheClient();

  // Resolve paths → IDs → IDs+descendants
  let categoryIds: string[] | undefined;
  if (categoryPaths && categoryPaths.length > 0) {
    const rootIds = await resolveCategoryPaths(categoryPaths);
    if (rootIds.length === 0) {
      // No paths matched — return empty rather than search globally
      return [];
    }
    categoryIds = await expandCategoryDescendants(rootIds);
  }

  let q = supabase
    .from("items")
    .select(
      `id, code, name, lookup_key, family, finish,
      category:item_categories!items_category_id_fkey(name),
      uom:units_of_measurement(abbreviation),
      inventory(quantity)`,
    )
    .eq("is_active", true);

  if (categoryIds && categoryIds.length > 0) {
    q = q.in("category_id", categoryIds);
  }

  // Multi-token AND search. Each token must appear in name OR lookup_key OR code.
  if (query.trim()) {
    const tokens = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    for (const token of tokens) {
      // Strip PostgREST-special chars (%, comma, parentheses) from each token.
      // Item names like "... (LHS Glass)" contain "(", which otherwise breaks the
      // or-filter parser and makes the search return zero results.
      const safe = token.replace(/[%,()]/g, "");
      if (!safe) continue;
      // ilike with OR across the three text columns
      q = q.or(
        `name.ilike.%${safe}%,lookup_key.ilike.%${safe}%,code.ilike.%${safe}%`,
      );
    }
  }

  q = q.order("name").limit(limit);

  const { data, error } = await q;
  if (error) throw error;

  // Flatten PostgREST joined arrays into flat objects, and sum inventory.
  return (data ?? []).map((row: any) => {
    const invRows: Array<{ quantity: number }> = Array.isArray(row.inventory)
      ? row.inventory
      : [];
    const total_stock = invRows.reduce(
      (sum, r) => sum + Number(r.quantity ?? 0),
      0,
    );
    return {
      id: row.id as string,
      code: row.code as string,
      name: row.name as string,
      lookup_key: (row.lookup_key as string | null) ?? null,
      category_name: Array.isArray(row.category)
        ? (row.category[0]?.name ?? null)
        : (row.category?.name ?? null),
      uom_abbreviation: Array.isArray(row.uom)
        ? (row.uom[0]?.abbreviation ?? "")
        : (row.uom?.abbreviation ?? ""),
      total_stock,
      family: (row.family as string | null) ?? null,
      finish: (row.finish as string | null) ?? null,
    };
  });
}
