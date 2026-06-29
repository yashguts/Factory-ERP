"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";

export interface CategoryNode {
  id: string;
  name: string;
  parent_id: string | null;
}

/** Fetch the full flat category list (cached — categories rarely change). */
const _getAllCategoriesUncached = async (): Promise<CategoryNode[]> => {
  const supabase = createCacheClient();
  const { data, error } = await supabase
    .from("item_categories")
    .select("id, name, parent_id")
    .order("name");
  if (error) throw error;
  return (data ?? []) as CategoryNode[];
};

export const getAllCategories = unstable_cache(
  _getAllCategoriesUncached,
  ["all-categories"],
  { revalidate: 300, tags: ["categories"] },
);

/**
 * Map every category id → its { category, subCategory } pair for the 2-level
 * tree (Category = top-level, Sub-Category = its direct child):
 *   category    = top-level (root) ancestor name
 *   subCategory = the leaf's own name when it has a parent, else "" (it IS the
 *                 top-level Category, so there is no sub-category)
 * Walks to the root, so a stray deeper nesting still yields a sensible
 * top-level. Backed by the cached getAllCategories (categories tag).
 */
export async function getCategoryLineageMap(): Promise<
  Map<string, { category: string; subCategory: string }>
> {
  const all = await getAllCategories();
  const byId = new Map(all.map((c) => [c.id, c]));
  const out = new Map<string, { category: string; subCategory: string }>();
  for (const c of all) {
    let root = c;
    while (root.parent_id) {
      const p = byId.get(root.parent_id);
      if (!p) break;
      root = p;
    }
    out.set(c.id, {
      category: root.name,
      subCategory: root.id === c.id ? "" : c.name,
    });
  }
  return out;
}

/**
 * Resolve a list of category PATH strings (e.g. "Large Purchased Items > Guide Rail")
 * to category IDs. Unknown paths are silently skipped.
 *
 * A single-segment path matches a top-level category by name.
 * Multi-segment paths walk down parent→child relationships.
 */
export async function resolveCategoryPaths(
  paths: string[],
): Promise<string[]> {
  if (paths.length === 0) return [];
  const all = await getAllCategories();
  const byParent = new Map<string | null, CategoryNode[]>();
  for (const cat of all) {
    const arr = byParent.get(cat.parent_id) ?? [];
    arr.push(cat);
    byParent.set(cat.parent_id, arr);
  }

  const ids: string[] = [];
  for (const path of paths) {
    const segments = path.split(">").map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) continue;

    let parentId: string | null = null;
    let matched: CategoryNode | null = null;
    for (const seg of segments) {
      const siblings: CategoryNode[] = byParent.get(parentId) ?? [];
      const found: CategoryNode | undefined = siblings.find(
        (c: CategoryNode) => c.name.toLowerCase() === seg.toLowerCase(),
      );
      if (!found) {
        matched = null;
        break;
      }
      matched = found;
      parentId = found.id;
    }
    if (matched) ids.push(matched.id);
  }
  return ids;
}

/**
 * Check which of the given category PATH strings resolve to a real
 * category in the DB. Returns the subset that resolved. Used by the
 * job form to flag BOM sections whose mappings are broken.
 */
export async function checkCategoryPaths(
  paths: string[],
): Promise<{ resolved: string[] }> {
  if (paths.length === 0) return { resolved: [] };
  const all = await getAllCategories();
  const byParent = new Map<string | null, CategoryNode[]>();
  for (const cat of all) {
    const arr = byParent.get(cat.parent_id) ?? [];
    arr.push(cat);
    byParent.set(cat.parent_id, arr);
  }

  const resolved: string[] = [];
  for (const path of paths) {
    const segments = path.split(">").map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) continue;
    let parentId: string | null = null;
    let ok = true;
    for (const seg of segments) {
      const siblings: CategoryNode[] = byParent.get(parentId) ?? [];
      const found: CategoryNode | undefined = siblings.find(
        (c: CategoryNode) => c.name.toLowerCase() === seg.toLowerCase(),
      );
      if (!found) {
        ok = false;
        break;
      }
      parentId = found.id;
    }
    if (ok) resolved.push(path);
  }
  return { resolved };
}

/**
 * Given a list of category IDs, return the full set including all descendants.
 * Used to scope search to a parent + every sub-category beneath it.
 */
export async function expandCategoryDescendants(
  rootIds: string[],
): Promise<string[]> {
  if (rootIds.length === 0) return [];
  const all = await getAllCategories();
  const childrenByParent = new Map<string, CategoryNode[]>();
  for (const cat of all) {
    if (!cat.parent_id) continue;
    const arr = childrenByParent.get(cat.parent_id) ?? [];
    arr.push(cat);
    childrenByParent.set(cat.parent_id, arr);
  }

  const out = new Set<string>(rootIds);
  const queue = [...rootIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const children = childrenByParent.get(id) ?? [];
    for (const child of children) {
      if (!out.has(child.id)) {
        out.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return Array.from(out);
}
