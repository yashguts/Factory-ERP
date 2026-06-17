"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";

/**
 * Outstanding (on-order, not-yet-received) purchase-order quantity per item id,
 * from NON-cancelled POs: Σ max(0, qty − received_qty). Received lines
 * contribute 0; cancelled POs are ignored. This is the "incoming material"
 * that MRP nets against demand (To buy = shortfall − on order).
 *
 * Two forms, mirroring getMrpData: the cached public one for pages, and the
 * un-nested `_…Uncached` one for callers that are THEMSELVES inside an
 * unstable_cache (getMrpData) — nesting unstable_cache breaks the outer cache.
 */
export async function _getOutstandingByItemUncached(): Promise<Record<string, number>> {
  const supabase = createCacheClient();
  const cancelled = await fetchAllRanged<{ id: string }>((from, to, wc) =>
    supabase
      .from("purchase_orders")
      .select("id", wc ? { count: "exact" } : {})
      .eq("status", "cancelled")
      .range(from, to),
  );
  const cancelledSet = new Set(cancelled.map((c) => c.id));
  const lines = await fetchAllRanged<{
    po_id: string;
    item_id: string;
    qty: number;
    received_qty: number;
    purchase_uom_id: string | null;
    tentative_stock_qty: number | null;
    received_stock_qty: number | null;
  }>((from, to, wc) =>
    supabase
      .from("purchase_order_lines")
      .select(
        "po_id, item_id, qty, received_qty, purchase_uom_id, tentative_stock_qty, received_stock_qty",
        wc ? { count: "exact" } : {},
      )
      .range(from, to),
  );
  const out: Record<string, number> = {};
  for (const l of lines) {
    if (cancelledSet.has(l.po_id)) continue;
    const v = onOrderStock(l);
    if (v > 0) out[l.item_id] = (out[l.item_id] ?? 0) + v;
  }
  return out;
}

/**
 * Incoming material for one PO line, in STOCK units. Dual-UOM lines (Purchase
 * UOM ≠ stock UOM) order in the purchase unit and carry a tentative stock
 * estimate + the actual stock received so far; same-UOM lines coalesce straight
 * back to (qty − received_qty). A line whose PURCHASE side is fully received
 * contributes 0 (its tentative estimate is now superseded by the real count).
 */
function onOrderStock(l: {
  qty: number;
  received_qty: number;
  purchase_uom_id: string | null;
  tentative_stock_qty: number | null;
  received_stock_qty: number | null;
}): number {
  const qty = Number(l.qty) || 0;
  const receivedQty = Number(l.received_qty) || 0;
  if (qty > 0 && receivedQty >= qty) return 0; // fully received (order side)
  const dual = !!l.purchase_uom_id;
  // For a dual line, qty is in the purchase unit — NOT a stock figure. Use the
  // tentative estimate; if none was given, contribute 0 (don't guess a unit).
  // Same-UOM lines coalesce straight back to (qty − received_qty).
  const tentative =
    l.tentative_stock_qty != null ? Number(l.tentative_stock_qty) : dual ? 0 : qty;
  const receivedStock =
    l.received_stock_qty != null ? Number(l.received_stock_qty) : dual ? 0 : receivedQty;
  return Math.max(0, tentative - receivedStock);
}

export async function getOutstandingByItem(): Promise<Record<string, number>> {
  return unstable_cache(_getOutstandingByItemUncached, ["po-outstanding-by-item"], {
    revalidate: 120,
    tags: ["purchase-orders"],
  })();
}

/**
 * Outstanding PO lines with the PO's expected-arrival date — for time-phasing
 * incoming trade material in the weekly plan. One entry per item per open PO
 * line (on_order > 0); expected_date is null when not yet entered (the caller
 * then treats it as arriving now / covering the nearest demand).
 */
export async function _getOutstandingLinesUncached(): Promise<
  { item_id: string; expected_date: string | null; on_order: number }[]
> {
  const supabase = createCacheClient();
  const pos = await fetchAllRanged<{ id: string; status: string; expected_date: string | null }>((from, to, wc) =>
    supabase
      .from("purchase_orders")
      .select("id, status, expected_date", wc ? { count: "exact" } : {})
      .range(from, to),
  );
  const meta = new Map(pos.map((p) => [p.id, p]));
  const lines = await fetchAllRanged<{
    po_id: string;
    item_id: string;
    qty: number;
    received_qty: number;
    purchase_uom_id: string | null;
    tentative_stock_qty: number | null;
    received_stock_qty: number | null;
  }>((from, to, wc) =>
    supabase
      .from("purchase_order_lines")
      .select(
        "po_id, item_id, qty, received_qty, purchase_uom_id, tentative_stock_qty, received_stock_qty",
        wc ? { count: "exact" } : {},
      )
      .range(from, to),
  );
  const out: { item_id: string; expected_date: string | null; on_order: number }[] = [];
  for (const l of lines) {
    const po = meta.get(l.po_id);
    if (!po || po.status === "cancelled") continue;
    const oo = onOrderStock(l);
    if (oo > 0) out.push({ item_id: l.item_id, expected_date: po.expected_date, on_order: oo });
  }
  return out;
}
