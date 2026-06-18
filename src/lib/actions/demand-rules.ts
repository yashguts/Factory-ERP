"use server";

/* ------------------------------------------------------------------ *
 * Demand formula rules (item_demand_rules) — the "where does demand come
 * from?" editor. A rule says: for every demanded unit of PARENT, also demand
 * `qty` of CHILD (e.g. 4 guide shoes per safety frame). These are DEMAND-ONLY
 * (folded into MRP's reqMap; the production plan never sees them). Until now the
 * table was read-only (SQL-inserted); this adds create/delete so the team can
 * define formulas for items that have no direct job-BOM demand.
 * ------------------------------------------------------------------ */

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidateTag, revalidatePath } from "next/cache";

export interface DemandRuleRow {
  id: string;
  parent_item_id: string;
  parent_code: string;
  parent_name: string;
  qty: number;
  note: string | null;
}
export type DemandRuleResult = { ok: true } | { ok: false; error: string };

/** Rules by which THIS item (the child) acquires demand — one per parent. */
export async function getDemandRulesForChild(childItemId: string): Promise<DemandRuleRow[]> {
  if (!childItemId) return [];
  const supabase = createCacheClient();
  const { data: rules } = await supabase
    .from("item_demand_rules")
    .select("id, parent_item_id, qty, note")
    .eq("child_item_id", childItemId);
  const list = (rules ?? []) as Record<string, unknown>[];
  if (!list.length) return [];
  const parentIds = [...new Set(list.map((r) => r.parent_item_id as string))];
  const { data: parents } = await supabase.from("items").select("id, code, name").in("id", parentIds);
  const byId = new Map((parents ?? []).map((p: Record<string, unknown>) => [p.id as string, p]));
  return list.map((r) => {
    const p = byId.get(r.parent_item_id as string);
    return {
      id: r.id as string,
      parent_item_id: r.parent_item_id as string,
      parent_code: (p?.code as string) ?? "—",
      parent_name: (p?.name as string) ?? "—",
      qty: Number(r.qty),
      note: (r.note as string | null) ?? null,
    };
  });
}

function revalidateDemand() {
  for (const t of ["items", "inventory-stock", "bom-lines"]) revalidateTag(t);
  revalidatePath("/demand");
  revalidatePath("/inventory");
  revalidatePath("/mrp");
  revalidatePath("/mrp/trade");
}

export async function createDemandRule(input: {
  childItemId: string;
  parentItemId: string;
  qty: number;
  note?: string | null;
}): Promise<DemandRuleResult> {
  const { childItemId, parentItemId, qty } = input;
  if (!childItemId || !parentItemId) return { ok: false, error: "Pick both the item and the parent it's demanded per." };
  if (parentItemId === childItemId) return { ok: false, error: "An item can't be demanded per itself." };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "Quantity must be greater than 0." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("item_demand_rules")
    .select("id")
    .eq("child_item_id", childItemId)
    .eq("parent_item_id", parentItemId)
    .limit(1);
  if (existing && existing.length)
    return { ok: false, error: "A rule for this item + parent already exists — delete it first to change the quantity." };

  const { error } = await supabase.from("item_demand_rules").insert({
    child_item_id: childItemId,
    parent_item_id: parentItemId,
    qty,
    note: input.note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidateDemand();
  return { ok: true };
}

export async function deleteDemandRule(id: string): Promise<DemandRuleResult> {
  if (!id) return { ok: false, error: "Missing rule id." };
  const supabase = await createClient();
  const { error } = await supabase.from("item_demand_rules").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateDemand();
  return { ok: true };
}
