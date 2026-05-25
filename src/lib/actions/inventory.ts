"use server";

import { createClient } from "@/lib/supabase/server";
import type { ItemType, TransactionType } from "@/lib/supabase/types";

export async function getItems() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .select(`
      *,
      category:item_categories(id, name),
      uom:units_of_measurement(id, abbreviation)
    `)
    .order("code");

  if (error) throw error;
  return data;
}

export async function getItemsWithStock() {
  const supabase = await createClient();

  const { data: items, error: itemsErr } = await supabase
    .from("items")
    .select(`
      *,
      category:item_categories(id, name),
      uom:units_of_measurement(id, abbreviation),
      inventory(quantity, warehouse_id)
    `)
    .eq("is_active", true)
    .order("code");

  if (itemsErr) throw itemsErr;

  return (items ?? []).map((item) => ({
    id: item.id as string,
    code: item.code as string,
    name: item.name as string,
    description: item.description as string | null,
    item_type: item.item_type as ItemType,
    category_id: item.category_id as string | null,
    uom_id: item.uom_id as string,
    minimum_stock: Number(item.minimum_stock),
    reorder_point: Number(item.reorder_point),
    lead_time_days: Number(item.lead_time_days),
    cost_price: Number(item.cost_price),
    is_active: item.is_active as boolean,
    category: item.category as { id: string; name: string } | null,
    uom: item.uom as { id: string; abbreviation: string } | null,
    total_stock: (item.inventory ?? []).reduce(
      (sum: number, inv: { quantity: number }) => sum + Number(inv.quantity),
      0
    ),
  }));
}

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
}) {
  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from("items")
    .insert({
      code: data.code,
      name: data.name,
      description: data.description || null,
      item_type: data.item_type,
      category_id: data.category_id || null,
      uom_id: data.uom_id,
      minimum_stock: data.minimum_stock,
      reorder_point: data.reorder_point,
      lead_time_days: data.lead_time_days,
      cost_price: data.cost_price,
    })
    .select()
    .single();

  if (error) throw error;
  return item;
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
  }
) {
  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from("items")
    .update(data)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
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

  const { error: txnError } = await supabase
    .from("inventory_transactions")
    .insert(data);

  if (txnError) throw txnError;

  const isOutbound = ["production_out", "scrap"].includes(data.transaction_type);
  const delta = isOutbound ? -Math.abs(data.quantity) : Math.abs(data.quantity);

  const { data: existing } = await supabase
    .from("inventory")
    .select("id, quantity")
    .eq("item_id", data.item_id)
    .eq("warehouse_id", data.warehouse_id)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("inventory")
      .update({ quantity: Number(existing.quantity) + delta })
      .eq("id", existing.id);
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
}

export async function getCategories() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("item_categories")
    .select("*")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getUnits() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units_of_measurement")
    .select("*")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getWarehouses() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

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
