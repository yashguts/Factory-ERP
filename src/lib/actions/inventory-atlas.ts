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

  if (error) return { ok: false, error: error.message };

  revalidateTag("categories");
  revalidatePath("/inventory/atlas");
  return { ok: true, id: data.id, name: data.name };
}
