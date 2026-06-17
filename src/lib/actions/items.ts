"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import {
  resolveCategoryPaths,
  expandCategoryDescendants,
  getAllCategories,
} from "@/lib/actions/categories";

export interface SearchableItem {
  id: string;
  code: string;
  name: string;
  /** Optional human-friendly key. Often more useful to show than `name`. */
  lookup_key: string | null;
  category_name: string | null;
  /** Full "Top › Sub" category path for display (so category matches are clear). */
  category_path: string | null;
  uom_abbreviation: string;
  /** Sum of inventory.quantity across all warehouses for this item. */
  total_stock: number;
  /** Finish-variant grouping (for BOM finish-rule resolution). */
  family: string | null;
  finish: string | null;
  /** Make/Trade: item override, else the category default. */
  effective_procurement_type: "make" | "trade" | null;
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
 * Each word in `query` (AND logic) must match the item's name, lookup key, code,
 * OR its category / sub-category name (typing a category name returns every item
 * under it, including its sub-categories).
 */
export async function searchItems(
  query: string,
  categoryPaths?: string[],
  limit = 50,
  opts?: { excludeCabin?: boolean },
): Promise<SearchableItem[]> {
  // Use the cache-friendly anon client (no cookies). The SSR client's
  // cookie session can go stale on long-open tabs, which used to make
  // searches silently fail. This is a public, RLS-light read, so
  // dropping the cookie dependency is safe and more robust.
  const supabase = createCacheClient();

  // Category lookup (cached) — powers search-by-category/sub-category + the
  // "Top › Sub" path shown in results. Typing a category name matches every item
  // under it, including all sub-categories.
  const allCats = await getAllCategories();
  const catById = new Map(allCats.map((c) => [c.id, c]));
  const childrenByParent = new Map<string, string[]>();
  for (const c of allCats) {
    if (c.parent_id) {
      const arr = childrenByParent.get(c.parent_id) ?? [];
      arr.push(c.id);
      childrenByParent.set(c.parent_id, arr);
    }
  }
  const descendantsOf = (rootId: string): string[] => {
    const out: string[] = [];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      for (const ch of childrenByParent.get(id) ?? []) {
        out.push(ch);
        stack.push(ch);
      }
    }
    return out;
  };
  const categoryIdsMatching = (token: string): string[] => {
    const roots = allCats.filter((c) => c.name.toLowerCase().includes(token)).map((c) => c.id);
    if (roots.length === 0) return [];
    const set = new Set<string>(roots);
    for (const r of roots) for (const d of descendantsOf(r)) set.add(d);
    return Array.from(set);
  };
  const catPath = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const parts: string[] = [];
    let cur = catById.get(id);
    let guard = 0;
    while (cur && guard++ < 12) {
      parts.unshift(cur.name);
      cur = cur.parent_id ? catById.get(cur.parent_id) : undefined;
    }
    return parts.length ? parts.join(" › ") : null;
  };

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
      `id, code, name, lookup_key, family, finish, procurement_type, category_id,
      category:item_categories!items_category_id_fkey(name, procurement_type),
      uom:units_of_measurement!items_uom_id_fkey(abbreviation),
      inventory(quantity)`,
    )
    .eq("is_active", true);

  if (categoryIds && categoryIds.length > 0) {
    q = q.in("category_id", categoryIds);
  }

  // Optionally exclude the whole "Cabin" category subtree (cabin items live in
  // their own /cabin-inventory section). Mirrors getItemsWithStock's exclusion —
  // used by the Stock Adjustment picker so it stays scoped to main inventory.
  if (opts?.excludeCabin) {
    const { data: allCats } = await supabase
      .from("item_categories")
      .select("id, name, parent_id");
    const childrenOf = new Map<string, string[]>();
    for (const c of allCats ?? []) {
      if (c.parent_id) {
        const arr = childrenOf.get(c.parent_id as string) ?? [];
        arr.push(c.id as string);
        childrenOf.set(c.parent_id as string, arr);
      }
    }
    const root = (allCats ?? []).find(
      (c) => c.name === "Cabin" && c.parent_id === null,
    );
    const cabinIds: string[] = [];
    if (root) {
      const stack = [root.id as string];
      while (stack.length) {
        const cid = stack.pop() as string;
        cabinIds.push(cid);
        for (const ch of childrenOf.get(cid) ?? []) stack.push(ch);
      }
    }
    if (cabinIds.length > 0) {
      q = q.or(`category_id.is.null,category_id.not.in.(${cabinIds.join(",")})`);
    }
  }

  // Multi-token AND search. Each token must match name / lookup_key / code OR the
  // item's category / sub-category name.
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
      const conds = [
        `name.ilike.%${safe}%`,
        `lookup_key.ilike.%${safe}%`,
        `code.ilike.%${safe}%`,
      ];
      // Category / sub-category match: items whose category (or any ancestor) name
      // contains the token. Skipped when a token is so generic it matches a huge
      // slice of the 400+ category tree, to keep the request URL bounded — the
      // name/code match still applies for that token.
      const catIds = categoryIdsMatching(safe);
      if (catIds.length > 0 && catIds.length <= 250) {
        conds.push(`category_id.in.(${catIds.join(",")})`);
      }
      q = q.or(conds.join(","));
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
    const catProcurement = Array.isArray(row.category)
      ? (row.category[0]?.procurement_type ?? null)
      : (row.category?.procurement_type ?? null);
    return {
      id: row.id as string,
      code: row.code as string,
      name: row.name as string,
      lookup_key: (row.lookup_key as string | null) ?? null,
      category_name: Array.isArray(row.category)
        ? (row.category[0]?.name ?? null)
        : (row.category?.name ?? null),
      category_path: catPath(row.category_id as string | null),
      uom_abbreviation: Array.isArray(row.uom)
        ? (row.uom[0]?.abbreviation ?? "")
        : (row.uom?.abbreviation ?? ""),
      total_stock,
      family: (row.family as string | null) ?? null,
      finish: (row.finish as string | null) ?? null,
      effective_procurement_type:
        ((row.procurement_type ?? catProcurement) as "make" | "trade" | null) ??
        null,
    };
  });
}
