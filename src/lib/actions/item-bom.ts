"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import type { FinishRule, StockBehaviour } from "@/lib/supabase/types";

/* ------------------------------------------------------------------ *
 * Item multi-level parts list ("Built from"), with finish propagation.
 *
 * An assembly item owns a list of child lines. Each line resolves to a
 * concrete child at explode time per its finish_rule:
 *   neutral  -> child_item_id directly (one SKU, no finish dimension)
 *   inherit  -> the member of child_family whose finish = parent's finish
 *   pinned   -> the member of child_family whose finish = pinned_finish
 * Reads cached under "bom-lines" + "items"; mutations revalidate both.
 * ------------------------------------------------------------------ */

export interface ItemForBom {
  id: string;
  code: string;
  name: string;
  stock_behaviour: StockBehaviour;
  procurement_type: "make" | "trade" | null;
  category_procurement_type: "make" | "trade" | null;
  effective_procurement_type: "make" | "trade" | null;
  family: string | null;
  finish: string | null;
  uom_abbreviation: string;
}

export interface ItemBomLineDetail {
  id: string;
  child_item_id: string | null;
  child_family: string | null;
  qty: number;
  finish_rule: FinishRule;
  pinned_finish: string | null;
  sort_order: number;
  /** Resolved display for the (representative) child item. */
  child_code: string | null;
  child_name: string | null;
  child_uom: string | null;
  /** The child item's own family/finish (lets the editor rebuild the row). */
  child_item_family: string | null;
  child_item_finish: string | null;
}

export interface ItemBomResult {
  item: ItemForBom;
  lines: ItemBomLineDetail[];
}

/** A line as supplied by the editor when saving. */
export interface ItemBomLineInput {
  child_item_id: string | null;
  child_family: string | null;
  qty: number;
  finish_rule: FinishRule;
  pinned_finish: string | null;
}

export type ItemBomSaveResult = { ok: true } | { ok: false; error: string };

function flatten<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return (rel[0] as T) ?? null;
  return (rel as T) ?? null;
}

const _getItemBomUncached = async (
  itemId: string,
): Promise<ItemBomResult | null> => {
  const supabase = createCacheClient();

  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select(
      `id, code, name, stock_behaviour, procurement_type, family, finish,
       category:item_categories!items_category_id_fkey(procurement_type),
       uom:units_of_measurement(abbreviation)`,
    )
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr) throw itemErr;
  if (!item) return null;

  const { data: rows, error: lineErr } = await supabase
    .from("item_bom_lines")
    .select(
      `id, child_item_id, child_family, qty, finish_rule, pinned_finish, sort_order,
       child:items!item_bom_lines_child_item_id_fkey(code, name, family, finish, uom:units_of_measurement(abbreviation))`,
    )
    .eq("parent_item_id", itemId)
    .order("sort_order");
  if (lineErr) throw lineErr;

  const itemPT = (item.procurement_type as "make" | "trade" | null) ?? null;
  const catPT =
    (flatten<any>(item.category)?.procurement_type as
      | "make"
      | "trade"
      | null) ?? null;

  const lines: ItemBomLineDetail[] = (rows ?? []).map((r: any) => {
    const child = flatten<any>(r.child);
    const cuom = flatten<any>(child?.uom);
    return {
      id: r.id as string,
      child_item_id: (r.child_item_id as string | null) ?? null,
      child_family: (r.child_family as string | null) ?? null,
      qty: Number(r.qty ?? 0),
      finish_rule: (r.finish_rule as FinishRule) ?? "neutral",
      pinned_finish: (r.pinned_finish as string | null) ?? null,
      sort_order: Number(r.sort_order ?? 0),
      child_code: (child?.code as string) ?? null,
      child_name: (child?.name as string) ?? null,
      child_uom: (cuom?.abbreviation as string) ?? null,
      child_item_family: (child?.family as string | null) ?? null,
      child_item_finish: (child?.finish as string | null) ?? null,
    };
  });

  return {
    item: {
      id: item.id as string,
      code: item.code as string,
      name: item.name as string,
      stock_behaviour: (item.stock_behaviour as StockBehaviour) ?? "stocked",
      procurement_type: itemPT,
      category_procurement_type: catPT,
      effective_procurement_type: itemPT ?? catPT,
      family: (item.family as string | null) ?? null,
      finish: (item.finish as string | null) ?? null,
      uom_abbreviation:
        (flatten<any>(item.uom)?.abbreviation as string) ?? "",
    },
    lines,
  };
};

export async function getItemBom(itemId: string): Promise<ItemBomResult | null> {
  if (!itemId) return null;
  const cached = unstable_cache(
    () => _getItemBomUncached(itemId),
    ["item-bom", itemId],
    { revalidate: 60, tags: ["bom-lines", "items"] },
  );
  return cached();
}

/**
 * Replace the entire parts list for one parent item (form is source of truth,
 * same approach as saveBomSection / replaceLines). Validates each line.
 */
export async function saveItemBom(
  parentItemId: string,
  lines: ItemBomLineInput[],
): Promise<ItemBomSaveResult> {
  if (!parentItemId) return { ok: false, error: "Missing item id." };

  // Validate + normalise; drop blank lines (no target).
  const clean: Array<{
    parent_item_id: string;
    child_item_id: string | null;
    child_family: string | null;
    qty: number;
    finish_rule: FinishRule;
    pinned_finish: string | null;
    sort_order: number;
  }> = [];
  let idx = 0;
  for (const l of lines) {
    // Every line is anchored to a concrete picked item (the representative,
    // and the resolved child for 'neutral'). Skip blank rows.
    if (!l.child_item_id) continue;
    const rule = l.finish_rule;
    if (rule !== "neutral" && !l.child_family) {
      return {
        ok: false,
        error:
          "Inherit/pinned parts must belong to a finish family — pick a finish-variant item or use 'This exact item'.",
      };
    }
    if (rule === "pinned" && !l.pinned_finish) {
      return { ok: false, error: "A pinned line needs a finish to pin to." };
    }
    if (!(Number(l.qty) > 0)) {
      return { ok: false, error: "Every part needs a quantity greater than 0." };
    }
    if (l.child_item_id === parentItemId) {
      return { ok: false, error: "An item can't be a part of itself." };
    }
    clean.push({
      parent_item_id: parentItemId,
      // child_item_id is always the picked item — the resolved child for
      // 'neutral', or a representative of the family for inherit/pinned.
      child_item_id: l.child_item_id,
      child_family: rule === "neutral" ? null : l.child_family,
      qty: Number(l.qty),
      finish_rule: rule,
      pinned_finish: rule === "pinned" ? l.pinned_finish : null,
      sort_order: idx++,
    });
  }

  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("item_bom_lines")
    .delete()
    .eq("parent_item_id", parentItemId);
  if (delErr) return { ok: false, error: delErr.message };

  if (clean.length > 0) {
    const { error: insErr } = await supabase
      .from("item_bom_lines")
      .insert(clean);
    if (insErr) return { ok: false, error: insErr.message };
  }

  revalidateTag("bom-lines");
  revalidateTag("items");
  revalidatePath(`/inventory/${parentItemId}`);
  revalidatePath("/inventory");
  return { ok: true };
}
