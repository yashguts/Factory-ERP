"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidateTag, revalidatePath } from "next/cache";

/**
 * Inventory Atlas — structural mutations for the category/item management
 * workbench (/inventory/atlas). Recategorise items in bulk and create
 * categories. Item creation reuses `createItem` from inventory.ts.
 *
 * These return a discriminated result (never throw user-facing errors) so the
 * client can surface a clean toast — see §5 of CLAUDE.md.
 */

export type AtlasResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/**
 * Move a batch of items into a target category (recategorise). A plain
 * category_id UPDATE — fully reversible by moving them back.
 */
export async function moveItemsToCategory(
  itemIds: string[],
  targetCategoryId: string,
): Promise<AtlasResult<{ moved: number }>> {
  if (!itemIds.length) return { ok: false, error: "No items selected." };
  if (!targetCategoryId) return { ok: false, error: "Pick a destination category." };

  const supabase = await createClient();

  // Confirm the target exists (a stale client could send a deleted id).
  const { data: target, error: targetErr } = await supabase
    .from("item_categories")
    .select("id")
    .eq("id", targetCategoryId)
    .single();
  if (targetErr || !target) {
    return { ok: false, error: "Destination category no longer exists. Refresh and retry." };
  }

  const { error } = await supabase
    .from("items")
    .update({ category_id: targetCategoryId })
    .in("id", itemIds);

  if (error) return { ok: false, error: error.message };

  revalidateTag("items");
  revalidateTag("categories");
  revalidatePath("/inventory/atlas");
  return { ok: true, moved: itemIds.length };
}

/**
 * Create a new category. `parentId = null` makes a top-level category;
 * otherwise it nests under the given parent. New categories inherit Make/Trade
 * from their parent at read time (procurement_type left null = inherit).
 */
export async function createCategory(
  name: string,
  parentId: string | null,
): Promise<AtlasResult<{ id: string; name: string; parent_id: string | null }>> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Category name is required." };

  const supabase = await createClient();

  // Guard against an exact duplicate under the same parent (case-insensitive).
  const dupQuery = supabase
    .from("item_categories")
    .select("id")
    .ilike("name", clean);
  const { data: siblings } = parentId
    ? await dupQuery.eq("parent_id", parentId)
    : await dupQuery.is("parent_id", null);
  if (siblings && siblings.length > 0) {
    return { ok: false, error: `A category named "${clean}" already exists here.` };
  }

  const { data, error } = await supabase
    .from("item_categories")
    .insert({ name: clean, parent_id: parentId })
    .select("id, name, parent_id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidateTag("categories");
  revalidatePath("/inventory/atlas");
  return { ok: true, id: data.id, name: data.name, parent_id: data.parent_id };
}

/**
 * Rename a category in place. Used by the inline edit affordance in the tree.
 */
export async function renameCategory(
  id: string,
  name: string,
): Promise<AtlasResult<{ id: string; name: string }>> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Category name cannot be empty." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("item_categories")
    .update({ name: clean })
    .eq("id", id)
    .select("id, name")
    .single();

  if (error) {
    if (error.code === "23505")
      return { ok: false, error: `A sibling category is already named "${clean}".` };
    return { ok: false, error: error.message };
  }

  revalidateTag("categories");
  revalidatePath("/inventory/atlas");
  return { ok: true, id: data.id, name: data.name };
}

/**
 * Delete a category and its (empty) sub-categories. Refuses if ANY item in the
 * subtree still references a category — items would be orphaned (the FK would
 * block it anyway). Move the items out first. Returns the deleted ids so the
 * client can prune its tree optimistically.
 */
export async function deleteCategory(
  id: string,
): Promise<AtlasResult<{ deletedIds: string[]; itemsBlocking: number }>> {
  const supabase = await createClient();

  // Build the subtree id set from the full (small) category list.
  const { data: all, error: catErr } = await supabase
    .from("item_categories")
    .select("id, parent_id");
  if (catErr) return { ok: false, error: catErr.message };

  const childrenOf = new Map<string, string[]>();
  for (const c of all ?? []) {
    if (!c.parent_id) continue;
    (childrenOf.get(c.parent_id) ?? childrenOf.set(c.parent_id, []).get(c.parent_id)!).push(c.id);
  }
  const subtree: string[] = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    subtree.push(cur);
    for (const ch of childrenOf.get(cur) ?? []) queue.push(ch);
  }

  // Block if any item lives anywhere in the subtree.
  const { count } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .in("category_id", subtree);
  if (count && count > 0) {
    return {
      ok: true,
      deletedIds: [],
      itemsBlocking: count,
    };
  }

  // Safe to delete the whole empty subtree in one statement (FK is NO ACTION,
  // checked at statement end → parent+children together is fine).
  const { error } = await supabase.from("item_categories").delete().in("id", subtree);
  if (error) return { ok: false, error: error.message };

  revalidateTag("categories");
  revalidatePath("/inventory/atlas");
  return { ok: true, deletedIds: subtree, itemsBlocking: 0 };
}

/**
 * Bulk-set common fields on a batch of items. Each field is optional — only
 * provided keys are written ("leave unchanged" maps to omitting the key).
 * `procurement_type: null` means "inherit from category". Setting Make clears
 * suppliers, mirroring updateItem.
 *
 * NOTE: this is a direct UPDATE — it does NOT write item_change_log entries the
 * way updateItem does, so bulk edits won't appear in Daily Changes (acceptable
 * for structural batch edits; revisit if per-item history becomes important).
 */
export async function bulkUpdateItems(
  itemIds: string[],
  patch: {
    item_type?: string;
    procurement_type?: "make" | "trade" | null;
    uom_id?: string;
  },
): Promise<AtlasResult<{ updated: number }>> {
  if (!itemIds.length) return { ok: false, error: "No items selected." };

  const update: Record<string, unknown> = {};
  if (patch.item_type !== undefined) update.item_type = patch.item_type;
  if (patch.uom_id !== undefined) update.uom_id = patch.uom_id;
  if (patch.procurement_type !== undefined) {
    update.procurement_type = patch.procurement_type; // null = inherit
    if (patch.procurement_type === "make") update.suppliers = [];
  }
  if (Object.keys(update).length === 0)
    return { ok: false, error: "Choose at least one field to change." };

  const supabase = await createClient();
  const { error } = await supabase.from("items").update(update).in("id", itemIds);
  if (error) return { ok: false, error: error.message };

  revalidateTag("items");
  revalidatePath("/inventory/atlas");
  return { ok: true, updated: itemIds.length };
}
