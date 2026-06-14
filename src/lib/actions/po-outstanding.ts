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
  const lines = await fetchAllRanged<{ po_id: string; item_id: string; qty: number; received_qty: number }>((from, to, wc) =>
    supabase
      .from("purchase_order_lines")
      .select("po_id, item_id, qty, received_qty", wc ? { count: "exact" } : {})
      .range(from, to),
  );
  const out: Record<string, number> = {};
  for (const l of lines) {
    if (cancelledSet.has(l.po_id)) continue;
    const v = Math.max(0, (Number(l.qty) || 0) - (Number(l.received_qty) || 0));
    if (v > 0) out[l.item_id] = (out[l.item_id] ?? 0) + v;
  }
  return out;
}

export async function getOutstandingByItem(): Promise<Record<string, number>> {
  return unstable_cache(_getOutstandingByItemUncached, ["po-outstanding-by-item"], {
    revalidate: 120,
    tags: ["purchase-orders"],
  })();
}
