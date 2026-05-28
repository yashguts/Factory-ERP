"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag } from "next/cache";
import type { ItemType, TransactionType } from "@/lib/supabase/types";

export async function getItems() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .select(`
      *,
      category:item_categories!items_category_id_fkey(id, name, parent_id),
      uom:units_of_measurement(id, abbreviation)
    `)
    .order("code");

  if (error) throw error;
  return data;
}

const _getItemsWithStockUncached = async () => {
  const supabase = createCacheClient();

  const PAGE = 1000;
  let allItems: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("items")
      .select(`
        *,
        category:item_categories!items_category_id_fkey(id, name, parent_id, procurement_type),
        uom:units_of_measurement(id, abbreviation),
        inventory(quantity, warehouse_id)
      `)
      .eq("is_active", true)
      .order("code")
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    allItems = allItems.concat(data ?? []);
    if (!data || data.length < PAGE) break;
    offset += PAGE;
  }

  return allItems.map((item) => {
    const itemPT = (item.procurement_type as "make" | "trade" | null) ?? null;
    const catPT =
      (item.category?.procurement_type as "make" | "trade" | null) ?? null;
    return {
      id: item.id as string,
      code: item.code as string,
      name: item.name as string,
      lookup_key: item.lookup_key as string | null,
      description: item.description as string | null,
      item_type: item.item_type as ItemType,
      category_id: item.category_id as string | null,
      uom_id: item.uom_id as string,
      minimum_stock: Number(item.minimum_stock),
      reorder_point: Number(item.reorder_point),
      lead_time_days: Number(item.lead_time_days),
      cost_price: Number(item.cost_price),
      is_active: item.is_active as boolean,
      /** Per-item override. NULL = inherit from category. */
      procurement_type: itemPT,
      /** The (sub-)category's default — used by the form's "Inherit (X)" label. */
      category_procurement_type: catPT,
      /** Effective value = item override ?? category default. NULL only if neither is set. */
      effective_procurement_type: (itemPT ??
        catPT) as "make" | "trade" | null,
      /** Up to 5 free-text supplier names. */
      suppliers: Array.isArray(item.suppliers)
        ? (item.suppliers as string[])
        : [],
      category: item.category as {
        id: string;
        name: string;
        parent_id: string | null;
        procurement_type: "make" | "trade" | null;
      } | null,
      uom: item.uom as { id: string; abbreviation: string } | null,
      total_stock: (item.inventory ?? []).reduce(
        (sum: number, inv: { quantity: number }) => sum + Number(inv.quantity),
        0,
      ),
    };
  });
};

export const getItemsWithStock = unstable_cache(
  _getItemsWithStockUncached,
  ["items-with-stock"],
  { revalidate: 60, tags: ["items", "inventory-stock"] },
);

export async function createItem(data: {
  code: string;
  name: string;
  description?: string;
  item_type: ItemType;
  category_id?: string;
  uom_id: string;
  minimum_stock: number;
  reorder_point: number;
  lead_time_days: number;
  cost_price: number;
  /** Make/Trade override. NULL/undefined = inherit from category. */
  procurement_type?: "make" | "trade" | null;
  /** Up to 5 supplier names (only meaningful for Trade items). */
  suppliers?: string[];
}) {
  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from("items")
    .insert({
      code: data.code,
      name: data.name,
      // Keep lookup_key in sync with name — see updateItem for context.
      lookup_key: data.name,
      description: data.description || null,
      item_type: data.item_type,
      category_id: data.category_id || null,
      uom_id: data.uom_id,
      minimum_stock: data.minimum_stock,
      reorder_point: data.reorder_point,
      lead_time_days: data.lead_time_days,
      cost_price: data.cost_price,
      procurement_type: data.procurement_type ?? null,
      suppliers: normalizeSuppliers(data.suppliers),
    })
    .select()
    .single();

  if (error) throw error;
  revalidateTag("items");
  return item;
}

/**
 * Trim, drop empties, dedupe, cap at 5. Matches the CHECK constraint
 * on the column and keeps storage tidy.
 */
function normalizeSuppliers(input: string[] | null | undefined): string[] {
  if (!input) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= 5) break;
  }
  return out;
}

export async function updateItem(
  id: string,
  data: {
    code?: string;
    name?: string;
    description?: string;
    item_type?: ItemType;
    category_id?: string | null;
    uom_id?: string;
    minimum_stock?: number;
    reorder_point?: number;
    lead_time_days?: number;
    cost_price?: number;
    is_active?: boolean;
    /**
     * Make/Trade override. Pass `null` explicitly to clear the override
     * (item then inherits from category). Omit to leave unchanged.
     */
    procurement_type?: "make" | "trade" | null;
    /** Up to 5 supplier names. Pass `[]` to clear all. Omit to leave unchanged. */
    suppliers?: string[];
  },
) {
  const supabase = await createClient();

  // The codebase treats items.name as the single source of truth for the
  // display label. `lookup_key` is legacy data that the search fallback
  // still reads from, so we keep it in lock-step with `name` whenever
  // the user edits the name — that way edited names show immediately
  // and the search index doesn't drift.
  const payload: Record<string, unknown> = { ...data };
  if (typeof data.name === "string") {
    payload.lookup_key = data.name;
  }
  if (data.suppliers !== undefined) {
    payload.suppliers = normalizeSuppliers(data.suppliers);
  }

  const { data: item, error } = await supabase
    .from("items")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  revalidateTag("items");
  return item;
}

export async function recordTransaction(data: {
  item_id: string;
  warehouse_id: string;
  transaction_type: TransactionType;
  quantity: number;
  notes?: string;
}) {
  const supabase = await createClient();

  const isOutbound = ["production_out", "scrap"].includes(data.transaction_type);
  const isAdjustment = data.transaction_type === "adjustment";
  const delta = isAdjustment ? data.quantity : isOutbound ? -Math.abs(data.quantity) : Math.abs(data.quantity);

  // Insert transaction record AND check existing inventory in parallel
  const [txnResult, existingResult] = await Promise.all([
    supabase.from("inventory_transactions").insert(data),
    supabase
      .from("inventory")
      .select("id, quantity")
      .eq("item_id", data.item_id)
      .eq("warehouse_id", data.warehouse_id)
      .single(),
  ]);

  if (txnResult.error) throw txnResult.error;

  if (existingResult.data) {
    const { error } = await supabase
      .from("inventory")
      .update({ quantity: Number(existingResult.data.quantity) + delta })
      .eq("id", existingResult.data.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("inventory")
      .insert({
        item_id: data.item_id,
        warehouse_id: data.warehouse_id,
        quantity: delta,
      });
    if (error) throw error;
  }

  revalidateTag("inventory-stock");
}

export const getCategories = unstable_cache(
  async () => {
    const supabase = createCacheClient();
    const { data, error } = await supabase
      .from("item_categories")
      .select("id, name, parent_id, description, created_at, procurement_type")
      .order("name");
    if (error) throw error;
    return data ?? [];
  },
  ["categories"],
  { revalidate: 300, tags: ["categories"] },
);

export const getUnits = unstable_cache(
  async () => {
    const supabase = createCacheClient();
    const { data, error } = await supabase
      .from("units_of_measurement")
      .select("*")
      .order("name");
    if (error) throw error;
    return data ?? [];
  },
  ["units"],
  { revalidate: 300, tags: ["units"] },
);

export const getWarehouses = unstable_cache(
  async () => {
    const supabase = createCacheClient();
    const { data, error } = await supabase
      .from("warehouses")
      .select("*")
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return data ?? [];
  },
  ["warehouses"],
  { revalidate: 300, tags: ["warehouses"] },
);

export async function getRecentTransactions(limit = 20) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_transactions")
    .select(`
      *,
      item:items(code, name),
      warehouse:warehouses(name)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
