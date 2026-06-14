"use server";

import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { recordTransaction } from "@/lib/actions/inventory";
import { getMrpData } from "@/lib/actions/mrp";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import type { PurchaseOrder, PurchaseOrderStatus } from "@/lib/supabase/types";

// Receiving posts opening/replenishment stock into the same warehouse the rest
// of the app uses for inbound (cabin opening stock, etc.).
const MAIN_STORE = "0ebcfb80-19e2-43e7-b15c-e6020bd5506d";

const OPEN_STATUSES: PurchaseOrderStatus[] = ["draft", "ordered"];

export interface PoListRow extends PurchaseOrder {
  line_count: number;
  total_qty: number;
  total_cost: number;
  received_lines: number;
}

export interface PoLineDetail {
  id: string;
  item_id: string;
  qty: number;
  unit_cost: number | null;
  received_qty: number;
  sort_order: number;
  item_code: string;
  item_name: string;
  uom_abbreviation: string | null;
  on_hand: number;
  reorder_point: number | null;
}

type SaveResult = { ok: true } | { ok: false; error: string };

function msg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getPurchaseOrders(): Promise<PoListRow[]> {
  return unstable_cache(_getPurchaseOrdersUncached, ["purchase-orders"], {
    revalidate: 120,
    tags: ["purchase-orders"],
  })();
}

async function _getPurchaseOrdersUncached(): Promise<PoListRow[]> {
  const supabase = createCacheClient();
  // Paged: a single supabase-js select caps at 1000 rows, and the lines table
  // can exceed that across many POs — un-ranged reads would silently
  // under-report every list aggregate (the documented PostgREST cap gotcha).
  const orders = await fetchAllRanged<PurchaseOrder>((from, to, withCount) =>
    supabase
      .from("purchase_orders")
      .select("*", withCount ? { count: "exact" } : {})
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  if (orders.length === 0) return [];

  const lines = await fetchAllRanged<{
    po_id: string;
    qty: number;
    unit_cost: number | null;
    received_qty: number;
  }>((from, to, withCount) =>
    supabase
      .from("purchase_order_lines")
      .select("po_id, qty, unit_cost, received_qty", withCount ? { count: "exact" } : {})
      .range(from, to),
  );

  const agg = new Map<
    string,
    { line_count: number; total_qty: number; total_cost: number; received_lines: number }
  >();
  for (const l of lines) {
    const a = agg.get(l.po_id) ?? { line_count: 0, total_qty: 0, total_cost: 0, received_lines: 0 };
    a.line_count += 1;
    a.total_qty += Number(l.qty) || 0;
    a.total_cost += (Number(l.qty) || 0) * (Number(l.unit_cost) || 0);
    if (Number(l.received_qty) >= Number(l.qty) && Number(l.qty) > 0) a.received_lines += 1;
    agg.set(l.po_id, a);
  }

  return orders.map((o) => ({
    ...o,
    ...(agg.get(o.id) ?? { line_count: 0, total_qty: 0, total_cost: 0, received_lines: 0 }),
  }));
}

export async function getPurchaseOrder(
  id: string,
): Promise<{ po: PurchaseOrder; lines: PoLineDetail[] } | null> {
  return unstable_cache(_getPurchaseOrderUncached, ["purchase-order", id], {
    revalidate: 120,
    tags: ["purchase-orders"],
  })(id);
}

async function _getPurchaseOrderUncached(
  id: string,
): Promise<{ po: PurchaseOrder; lines: PoLineDetail[] } | null> {
  const supabase = createCacheClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !po) return null;

  const { data: rawLines, error: lErr } = await supabase
    .from("purchase_order_lines")
    .select(
      `id, item_id, qty, unit_cost, received_qty, sort_order,
       item:items(code, name, reorder_point, uom:units_of_measurement(abbreviation))`,
    )
    .eq("po_id", id)
    .order("sort_order");
  if (lErr) throw lErr;

  const itemIds = (rawLines ?? []).map((l) => l.item_id);
  const onHand = new Map<string, number>();
  if (itemIds.length > 0) {
    const { data: inv } = await supabase
      .from("inventory")
      .select("item_id, quantity")
      .in("item_id", itemIds);
    for (const r of inv ?? [])
      onHand.set(r.item_id, (onHand.get(r.item_id) ?? 0) + (Number(r.quantity) || 0));
  }

  const lines: PoLineDetail[] = (rawLines ?? []).map((l) => {
    const item = Array.isArray(l.item) ? l.item[0] : l.item;
    const uomRel = item?.uom;
    const uom = Array.isArray(uomRel) ? uomRel[0] : uomRel;
    return {
      id: l.id,
      item_id: l.item_id,
      qty: Number(l.qty) || 0,
      unit_cost: l.unit_cost != null ? Number(l.unit_cost) : null,
      received_qty: Number(l.received_qty) || 0,
      sort_order: l.sort_order,
      item_code: item?.code ?? "—",
      item_name: item?.name ?? "—",
      uom_abbreviation: uom?.abbreviation ?? null,
      on_hand: onHand.get(l.item_id) ?? 0,
      reorder_point: item?.reorder_point != null ? Number(item.reorder_point) : null,
    };
  });

  return { po: po as PurchaseOrder, lines };
}

// ── Generate drafts from the Trade shortfall ────────────────────────────────

export async function generateDraftPosFromShortfall(
  cutoffDate?: string,
): Promise<{ ok: true; orders: number; lines: number; skipped: number } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const rows = (await getMrpData(cutoffDate)).filter(
      (r) => r.procurement_type === "trade" && r.shortfall > 0,
    );
    if (rows.length === 0) return { ok: true, orders: 0, lines: 0, skipped: 0 };

    // Skip items already sitting on an open (draft/ordered) PO so repeated
    // clicks don't pile up duplicate lines.
    const { data: openPos } = await supabase
      .from("purchase_orders")
      .select("id")
      .in("status", OPEN_STATUSES);
    const openIds = (openPos ?? []).map((p) => p.id);
    const onOpenPo = new Set<string>();
    if (openIds.length > 0) {
      const { data: openLines } = await supabase
        .from("purchase_order_lines")
        .select("item_id")
        .in("po_id", openIds);
      for (const l of openLines ?? []) onOpenPo.add(l.item_id);
    }

    const candidates = rows.filter((r) => !onOpenPo.has(r.item_id));
    const skipped = rows.length - candidates.length;
    if (candidates.length === 0) return { ok: true, orders: 0, lines: 0, skipped };

    // Supplier + cost come off the item (suppliers[0] is the default vendor).
    const { data: items } = await supabase
      .from("items")
      .select("id, suppliers, cost_price")
      .in("id", candidates.map((r) => r.item_id));
    const meta = new Map<string, { supplier: string | null; cost: number | null }>();
    for (const it of items ?? []) {
      const supplier = Array.isArray(it.suppliers) && it.suppliers.length > 0 ? it.suppliers[0] : null;
      meta.set(it.id, { supplier, cost: it.cost_price != null ? Number(it.cost_price) : null });
    }

    // Group by supplier (null/unassigned share one bucket).
    const bySupplier = new Map<string, typeof candidates>();
    for (const r of candidates) {
      const supplier = meta.get(r.item_id)?.supplier ?? "";
      const arr = bySupplier.get(supplier) ?? [];
      arr.push(r);
      bySupplier.set(supplier, arr);
    }

    let orders = 0;
    let lineCount = 0;
    for (const [supplier, group] of bySupplier.entries()) {
      const { data: po, error: poErr } = await supabase
        .from("purchase_orders")
        .insert({ supplier_name: supplier || null, status: "draft" })
        .select("id")
        .single();
      if (poErr || !po) throw poErr ?? new Error("Could not create PO");
      const lines = group.map((r, i) => ({
        po_id: po.id,
        item_id: r.item_id,
        qty: Math.ceil(r.shortfall),
        unit_cost: meta.get(r.item_id)?.cost ?? null,
        sort_order: i,
      }));
      const { error: lErr } = await supabase.from("purchase_order_lines").insert(lines);
      if (lErr) throw lErr;
      orders += 1;
      lineCount += lines.length;
    }

    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    return { ok: true, orders, lines: lineCount, skipped };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not generate purchase orders") };
  }
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function updatePurchaseOrder(
  id: string,
  patch: Partial<Pick<PurchaseOrder, "supplier_name" | "status" | "order_date" | "expected_date" | "note">>,
): Promise<SaveResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("purchase_orders")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    revalidatePath(`/procurement/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not update the purchase order") };
  }
}

export async function updatePoLine(
  id: string,
  poId: string,
  patch: { qty?: number; unit_cost?: number | null },
): Promise<SaveResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("purchase_order_lines").update(patch).eq("id", id);
    if (error) throw error;
    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    revalidatePath(`/procurement/${poId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not update the line") };
  }
}

export async function deletePoLine(id: string, poId: string): Promise<SaveResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("purchase_order_lines").delete().eq("id", id);
    if (error) throw error;
    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    revalidatePath(`/procurement/${poId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not remove the line") };
  }
}

export async function deletePurchaseOrder(id: string): Promise<SaveResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
    if (error) throw error;
    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not delete the purchase order") };
  }
}

/**
 * Receive a PO: for every line, post the UNRECEIVED quantity into inventory via
 * recordTransaction (purchase_in) — the one and only stock-writing path — then
 * mark the line fully received and the PO 'received'. Idempotent: a line already
 * received posts nothing, so re-receiving is a no-op.
 */
export async function receivePurchaseOrder(
  id: string,
): Promise<{ ok: true; posted: number } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const { data: lines, error } = await supabase
      .from("purchase_order_lines")
      .select("id, item_id, qty, received_qty")
      .eq("po_id", id);
    if (error) throw error;

    let posted = 0;
    for (const l of lines ?? []) {
      const delta = (Number(l.qty) || 0) - (Number(l.received_qty) || 0);
      if (delta <= 0) continue;
      await recordTransaction({
        item_id: l.item_id,
        warehouse_id: MAIN_STORE,
        transaction_type: "purchase_in",
        quantity: delta,
        notes: "PO received",
        reference_type: "purchase_order",
        reference_id: id,
      });
      const { error: uErr } = await supabase
        .from("purchase_order_lines")
        .update({ received_qty: Number(l.qty) || 0 })
        .eq("id", l.id);
      if (uErr) throw uErr;
      posted += 1;
    }

    const { error: sErr } = await supabase
      .from("purchase_orders")
      .update({ status: "received", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (sErr) throw sErr;

    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    revalidatePath(`/procurement/${id}`);
    return { ok: true, posted };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not receive the purchase order") };
  }
}
