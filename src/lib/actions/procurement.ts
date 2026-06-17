"use server";

import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { recordTransaction } from "@/lib/actions/inventory";
import { getMrpData } from "@/lib/actions/mrp";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import type {
  PurchaseOrder,
  PurchaseOrderStatus,
  FieldChange,
  PoChangeAction,
  PoChangeLog,
} from "@/lib/supabase/types";

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
  /** Original line description from the source PO (may differ from the catalog
   *  item name — the same code can carry several descriptions on one order). */
  description: string | null;
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
      `id, item_id, qty, unit_cost, received_qty, sort_order, description,
       item:items(code, name, reorder_point, uom:units_of_measurement!items_uom_id_fkey(abbreviation))`,
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
      description: (l.description as string | null) ?? null,
      uom_abbreviation: uom?.abbreviation ?? null,
      on_hand: onHand.get(l.item_id) ?? 0,
      reorder_point: item?.reorder_point != null ? Number(item.reorder_point) : null,
    };
  });

  return { po: po as PurchaseOrder, lines };
}

// ── Aggregated views (Orders / By item / By supplier) ───────────────────────

export interface ProcItemRow {
  item_id: string;
  code: string;
  name: string;
  uom: string | null;
  ordered: number;     // total qty across non-cancelled POs
  received: number;    // qty already received
  on_order: number;    // still to receive (Σ max(0, qty − received))
  po_count: number;
  suppliers: string[];
}
export interface ProcSupplierRow {
  supplier: string;
  po_count: number;
  line_count: number;
  ordered: number;
  on_order: number;
  est_cost: number;
  draft: number;
  ordered_n: number;
  received_n: number;
}
export interface ProcurementData {
  orders: PoListRow[];
  byItem: ProcItemRow[];
  bySupplier: ProcSupplierRow[];
}

export async function getProcurementData(): Promise<ProcurementData> {
  return unstable_cache(_getProcurementDataUncached, ["procurement-data"], {
    revalidate: 120,
    tags: ["purchase-orders"],
  })();
}

async function _getProcurementDataUncached(): Promise<ProcurementData> {
  const supabase = createCacheClient();
  const pos = await fetchAllRanged<PurchaseOrder>((from, to, wc) =>
    supabase
      .from("purchase_orders")
      .select("*", wc ? { count: "exact" } : {})
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  const lines = await fetchAllRanged<{
    po_id: string;
    item_id: string;
    qty: number;
    unit_cost: number | null;
    received_qty: number;
    item: { code: string; name: string; uom: { abbreviation: string } | { abbreviation: string }[] | null } | { code: string; name: string; uom: { abbreviation: string } | { abbreviation: string }[] | null }[] | null;
  }>((from, to, wc) =>
    supabase
      .from("purchase_order_lines")
      .select(
        "po_id, item_id, qty, unit_cost, received_qty, item:items(code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation))",
        wc ? { count: "exact" } : {},
      )
      .range(from, to),
  );
  const poById = new Map(pos.map((p) => [p.id, p]));

  // Orders (one row per PO, with aggregates) — same shape as getPurchaseOrders.
  const agg = new Map<string, { line_count: number; total_qty: number; total_cost: number; received_lines: number }>();
  for (const l of lines) {
    const a = agg.get(l.po_id) ?? { line_count: 0, total_qty: 0, total_cost: 0, received_lines: 0 };
    const qty = Number(l.qty) || 0, cost = Number(l.unit_cost) || 0, rec = Number(l.received_qty) || 0;
    a.line_count += 1; a.total_qty += qty; a.total_cost += qty * cost;
    if (rec >= qty && qty > 0) a.received_lines += 1;
    agg.set(l.po_id, a);
  }
  const orders: PoListRow[] = pos.map((o) => ({
    ...o,
    ...(agg.get(o.id) ?? { line_count: 0, total_qty: 0, total_cost: 0, received_lines: 0 }),
  }));

  // By item (cancelled POs excluded).
  const itemAgg = new Map<string, { code: string; name: string; uom: string | null; ordered: number; received: number; on_order: number; pos: Set<string>; sups: Set<string> }>();
  for (const l of lines) {
    const po = poById.get(l.po_id);
    if (!po || po.status === "cancelled") continue;
    const item = Array.isArray(l.item) ? l.item[0] : l.item;
    const uomRel = item?.uom;
    const uom = Array.isArray(uomRel) ? uomRel[0] : uomRel;
    let r = itemAgg.get(l.item_id);
    if (!r) {
      r = { code: item?.code ?? "—", name: item?.name ?? "—", uom: uom?.abbreviation ?? null, ordered: 0, received: 0, on_order: 0, pos: new Set(), sups: new Set() };
      itemAgg.set(l.item_id, r);
    }
    const qty = Number(l.qty) || 0, rec = Number(l.received_qty) || 0;
    r.ordered += qty; r.received += rec; r.on_order += Math.max(0, qty - rec);
    r.pos.add(l.po_id);
    if (po.supplier_name) r.sups.add(po.supplier_name);
  }
  const byItem: ProcItemRow[] = [...itemAgg.entries()]
    .map(([item_id, r]) => ({ item_id, code: r.code, name: r.name, uom: r.uom, ordered: r.ordered, received: r.received, on_order: r.on_order, po_count: r.pos.size, suppliers: [...r.sups].sort() }))
    .sort((a, b) => b.on_order - a.on_order || a.code.localeCompare(b.code));

  // By supplier.
  const supAgg = new Map<string, { po: Set<string>; line_count: number; ordered: number; on_order: number; est_cost: number; draft: number; ordered_n: number; received_n: number }>();
  for (const o of pos) {
    const key = o.supplier_name || "Unassigned";
    let s = supAgg.get(key);
    if (!s) { s = { po: new Set(), line_count: 0, ordered: 0, on_order: 0, est_cost: 0, draft: 0, ordered_n: 0, received_n: 0 }; supAgg.set(key, s); }
    s.po.add(o.id);
    if (o.status === "draft") s.draft += 1;
    else if (o.status === "ordered") s.ordered_n += 1;
    else if (o.status === "received") s.received_n += 1;
  }
  for (const l of lines) {
    const po = poById.get(l.po_id);
    if (!po) continue;
    const s = supAgg.get(po.supplier_name || "Unassigned");
    if (!s) continue;
    const qty = Number(l.qty) || 0, cost = Number(l.unit_cost) || 0, rec = Number(l.received_qty) || 0;
    s.line_count += 1; s.ordered += qty; s.est_cost += qty * cost;
    if (po.status !== "cancelled") s.on_order += Math.max(0, qty - rec);
  }
  const bySupplier: ProcSupplierRow[] = [...supAgg.entries()]
    .map(([supplier, s]) => ({ supplier, po_count: s.po.size, line_count: s.line_count, ordered: s.ordered, on_order: s.on_order, est_cost: s.est_cost, draft: s.draft, ordered_n: s.ordered_n, received_n: s.received_n }))
    .sort((a, b) => b.on_order - a.on_order || a.supplier.localeCompare(b.supplier));

  return { orders, byItem, bySupplier };
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

    // Order only the NET gap (to_buy = shortfall − on-order). Items already
    // fully covered by an open PO have to_buy === 0 and are skipped. A newly
    // created draft PO itself counts as on-order, so re-running won't pile up
    // duplicate lines.
    const candidates = rows.filter((r) => r.to_buy > 0);
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
        qty: Math.ceil(r.to_buy),
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

// ── PO change log (audit trail) ──────────────────────────────────────────────
// Every create/edit/audit on a PO writes a row to `po_change_log` so the PO
// detail page can show a history, mirroring item_change_log. Log writes are
// best-effort: a logging failure must never block the user's real edit.

const PO_HEADER_FIELDS = [
  "po_number", "supplier_name", "status", "order_date", "expected_date", "note",
] as const;

function poNorm(v: unknown): unknown {
  return v === "" || v === undefined ? null : v;
}

function poFieldChanges(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of PO_HEADER_FIELDS) {
    if (!(f in patch)) continue;
    const o = before[f] ?? null;
    const n = patch[f] ?? null;
    if (poNorm(o) !== poNorm(n)) out.push({ field: f, old: o ?? null, new: n ?? null });
  }
  return out;
}

async function logPoChange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: {
    po_id: string | null;
    po_number: string | null;
    supplier_name: string | null;
    action: PoChangeAction;
    changes: FieldChange[];
    note?: string | null;
  },
): Promise<void> {
  try {
    const { error } = await supabase.from("po_change_log").insert({
      po_id: row.po_id,
      po_number: row.po_number,
      supplier_name: row.supplier_name,
      action: row.action,
      changes: row.changes,
      note: row.note ?? null,
    });
    if (error) console.error("[po_change_log] insert failed:", error.message);
  } catch (e) {
    console.error("[po_change_log] insert threw:", e);
  }
}

export async function getPoChangeLog(poId: string): Promise<PoChangeLog[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("po_change_log")
    .select("*")
    .eq("po_id", poId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PoChangeLog[];
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface NewPoLineInput {
  item_id: string;
  qty: number;
  unit_cost?: number | null;
  description?: string | null;
}

/** Create a PO from scratch (manual "Add PO"). Inserts a draft header + lines. */
export async function createPurchaseOrder(input: {
  po_number?: string | null;
  supplier_name?: string | null;
  order_date?: string | null;
  expected_date?: string | null;
  note?: string | null;
  lines: NewPoLineInput[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const lines = (input.lines ?? []).filter((l) => l.item_id && Number(l.qty) > 0);
    if (lines.length === 0)
      return { ok: false, error: "Add at least one line item with a quantity." };

    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .insert({
        po_number: input.po_number?.trim() || null,
        supplier_name: input.supplier_name?.trim() || null,
        order_date: input.order_date || null,
        expected_date: input.expected_date || null,
        note: input.note?.trim() || null,
        status: "draft",
      })
      .select("id, po_number, supplier_name")
      .single();
    if (poErr || !po) throw poErr ?? new Error("Could not create the purchase order");

    const rows = lines.map((l, i) => ({
      po_id: po.id,
      item_id: l.item_id,
      qty: Math.max(1, Math.ceil(Number(l.qty))),
      unit_cost: l.unit_cost != null && (l.unit_cost as unknown) !== "" ? Number(l.unit_cost) : null,
      description: l.description?.trim() || null,
      sort_order: i,
    }));
    const { error: lErr } = await supabase.from("purchase_order_lines").insert(rows);
    if (lErr) {
      await supabase.from("purchase_orders").delete().eq("id", po.id); // rollback empty header
      throw lErr;
    }

    await logPoChange(supabase, {
      po_id: po.id as string,
      po_number: (po.po_number as string | null) ?? null,
      supplier_name: (po.supplier_name as string | null) ?? null,
      action: "create",
      changes: [],
      note: `Created with ${rows.length} line${rows.length === 1 ? "" : "s"}`,
    });

    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    return { ok: true, id: po.id as string };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not create the purchase order") };
  }
}

export async function updatePurchaseOrder(
  id: string,
  patch: Partial<Pick<PurchaseOrder, "po_number" | "supplier_name" | "status" | "order_date" | "expected_date" | "note">>,
): Promise<SaveResult> {
  try {
    const supabase = await createClient();
    const { data: before } = await supabase
      .from("purchase_orders")
      .select("po_number, supplier_name, status, order_date, expected_date, note")
      .eq("id", id)
      .single();
    const { error } = await supabase
      .from("purchase_orders")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    if (before) {
      const changes = poFieldChanges(before as Record<string, unknown>, patch as Record<string, unknown>);
      if (changes.length > 0) {
        await logPoChange(supabase, {
          po_id: id,
          po_number: (patch.po_number ?? (before as { po_number: string | null }).po_number) ?? null,
          supplier_name: (patch.supplier_name ?? (before as { supplier_name: string | null }).supplier_name) ?? null,
          action: "update",
          changes,
        });
      }
    }
    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    revalidatePath(`/procurement/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not update the purchase order") };
  }
}

/** Toggle the audit/verified sign-off on a PO. */
export async function setPoAudited(poId: string, audited: boolean): Promise<SaveResult> {
  try {
    const supabase = await createClient();
    const { data: po } = await supabase
      .from("purchase_orders")
      .select("po_number, supplier_name")
      .eq("id", poId)
      .single();
    const { error } = await supabase
      .from("purchase_orders")
      .update({
        audited_at: audited ? new Date().toISOString() : null,
        audited_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", poId);
    if (error) throw error;
    await logPoChange(supabase, {
      po_id: poId,
      po_number: po?.po_number ?? null,
      supplier_name: po?.supplier_name ?? null,
      action: audited ? "audit" : "unaudit",
      changes: [],
      note: audited ? "Marked audited" : "Audit cleared",
    });
    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    revalidatePath(`/procurement/${poId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not update audit status") };
  }
}

export async function updatePoLine(
  id: string,
  poId: string,
  patch: { qty?: number; unit_cost?: number | null },
): Promise<SaveResult> {
  try {
    const supabase = await createClient();
    const { data: before } = await supabase
      .from("purchase_order_lines")
      .select("qty, unit_cost, item:items(code)")
      .eq("id", id)
      .single();
    const { error } = await supabase.from("purchase_order_lines").update(patch).eq("id", id);
    if (error) throw error;
    if (before) {
      const rel = (before as { item?: { code?: string } | { code?: string }[] | null }).item;
      const itemRel = Array.isArray(rel) ? rel[0] : rel;
      const code = itemRel?.code ?? "line";
      const changes: FieldChange[] = [];
      const b = before as { qty: number; unit_cost: number | null };
      if (patch.qty !== undefined && Number(patch.qty) !== Number(b.qty))
        changes.push({ field: `${code} · qty`, old: Number(b.qty), new: Number(patch.qty) });
      if (patch.unit_cost !== undefined) {
        const o = b.unit_cost != null ? Number(b.unit_cost) : null;
        const n = patch.unit_cost != null ? Number(patch.unit_cost) : null;
        if (o !== n) changes.push({ field: `${code} · rate`, old: o, new: n });
      }
      if (changes.length > 0) {
        const { data: po } = await supabase
          .from("purchase_orders").select("po_number, supplier_name").eq("id", poId).single();
        await logPoChange(supabase, {
          po_id: poId, po_number: po?.po_number ?? null, supplier_name: po?.supplier_name ?? null,
          action: "update", changes,
        });
      }
    }
    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    revalidatePath(`/procurement/${poId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not update the line") };
  }
}

/** Add a new line item to an existing PO (the detail-page "Add item" bar). */
export async function addPoLine(
  poId: string,
  input: { item_id: string; qty: number; unit_cost?: number | null },
): Promise<SaveResult> {
  try {
    if (!poId) return { ok: false, error: "Missing purchase order" };
    if (!input.item_id) return { ok: false, error: "Pick an item to add." };
    if (!(Number(input.qty) > 0)) return { ok: false, error: "Enter a quantity greater than zero." };

    const supabase = await createClient();
    const { data: po } = await supabase
      .from("purchase_orders")
      .select("status, po_number, supplier_name")
      .eq("id", poId)
      .single();
    if (!po) return { ok: false, error: "Purchase order not found." };
    if (po.status === "received")
      return { ok: false, error: "This purchase order is fully received and can't be edited." };

    // Next sort_order = max existing + 1.
    const { data: existing } = await supabase
      .from("purchase_order_lines")
      .select("sort_order")
      .eq("po_id", poId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextSort = ((existing?.[0]?.sort_order as number | undefined) ?? -1) + 1;

    const qty = Math.max(1, Math.ceil(Number(input.qty)));
    const { error } = await supabase.from("purchase_order_lines").insert({
      po_id: poId,
      item_id: input.item_id,
      qty,
      unit_cost: input.unit_cost != null && (input.unit_cost as unknown) !== "" ? Number(input.unit_cost) : null,
      sort_order: nextSort,
    });
    if (error) throw error;

    const { data: item } = await supabase
      .from("items").select("code").eq("id", input.item_id).single();
    const code = (item?.code as string | null) ?? "item";
    await logPoChange(supabase, {
      po_id: poId,
      po_number: po.po_number ?? null,
      supplier_name: po.supplier_name ?? null,
      action: "update",
      changes: [{ field: "added line", old: null, new: `${code} × ${qty}` }],
    });

    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    revalidatePath(`/procurement/${poId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not add the line") };
  }
}

export async function deletePoLine(id: string, poId: string): Promise<SaveResult> {
  try {
    const supabase = await createClient();
    const { data: before } = await supabase
      .from("purchase_order_lines")
      .select("qty, item:items(code)")
      .eq("id", id)
      .single();
    const { error } = await supabase.from("purchase_order_lines").delete().eq("id", id);
    if (error) throw error;
    if (before) {
      const rel = (before as { item?: { code?: string } | { code?: string }[] | null }).item;
      const itemRel = Array.isArray(rel) ? rel[0] : rel;
      const label = itemRel?.code ?? "line";
      const { data: po } = await supabase
        .from("purchase_orders").select("po_number, supplier_name").eq("id", poId).single();
      await logPoChange(supabase, {
        po_id: poId, po_number: po?.po_number ?? null, supplier_name: po?.supplier_name ?? null,
        action: "update",
        changes: [{ field: "removed line", old: `${label} × ${Number((before as { qty: number }).qty)}`, new: null }],
      });
    }
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
    const { data: before } = await supabase
      .from("purchase_orders").select("po_number, supplier_name").eq("id", id).single();
    // Log before delete (po_id FK is ON DELETE SET NULL, so it nulls afterward).
    await logPoChange(supabase, {
      po_id: id, po_number: before?.po_number ?? null, supplier_name: before?.supplier_name ?? null,
      action: "delete", changes: [], note: "PO deleted",
    });
    const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
    if (error) throw error;
    revalidateTag("purchase-orders");
    revalidatePath("/procurement");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not delete the purchase order") };
  }
}

/* ================================================================== */
/*  Goods receipts (partial, dated, with invoice + actual rates)       */
/* ================================================================== */

const INVOICE_BUCKET = "po-invoices";
const INVOICE_MAX_BYTES = 50 * 1024 * 1024;
const INVOICE_MIME = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp",
]);

export interface PoReceiptLineDetail {
  id: string;
  po_line_id: string | null;
  item_id: string;
  item_code: string;
  item_name: string;
  uom_abbreviation: string | null;
  qty: number;
  unit_rate: number | null;
}
export interface PoReceipt {
  id: string;
  po_id: string;
  receipt_date: string;
  invoice_number: string | null;
  invoice_url: string | null;
  invoice_filename: string | null;
  invoice_uploaded_at: string | null;
  note: string | null;
  created_at: string;
  lines: PoReceiptLineDetail[];
}

export async function getPoReceipts(poId: string): Promise<PoReceipt[]> {
  return unstable_cache(_getPoReceiptsUncached, ["po-receipts", poId], {
    revalidate: 120,
    tags: ["purchase-orders"],
  })(poId);
}

async function _getPoReceiptsUncached(poId: string): Promise<PoReceipt[]> {
  const supabase = createCacheClient();
  const { data: receipts, error } = await supabase
    .from("purchase_order_receipts")
    .select("*")
    .eq("po_id", poId)
    .order("receipt_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!receipts || receipts.length === 0) return [];

  const { data: rawLines, error: lErr } = await supabase
    .from("purchase_order_receipt_lines")
    .select(
      "id, receipt_id, po_line_id, item_id, qty, unit_rate, item:items(code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation))",
    )
    .in("receipt_id", receipts.map((r) => r.id));
  if (lErr) throw lErr;

  const byReceipt = new Map<string, PoReceiptLineDetail[]>();
  for (const l of rawLines ?? []) {
    const item = Array.isArray(l.item) ? l.item[0] : l.item;
    const uomRel = item?.uom;
    const uom = Array.isArray(uomRel) ? uomRel[0] : uomRel;
    const arr = byReceipt.get(l.receipt_id) ?? [];
    arr.push({
      id: l.id,
      po_line_id: (l.po_line_id as string | null) ?? null,
      item_id: l.item_id,
      item_code: item?.code ?? "—",
      item_name: item?.name ?? "—",
      uom_abbreviation: uom?.abbreviation ?? null,
      qty: Number(l.qty) || 0,
      unit_rate: l.unit_rate != null ? Number(l.unit_rate) : null,
    });
    byReceipt.set(l.receipt_id, arr);
  }

  return receipts.map((r) => ({
    id: r.id,
    po_id: r.po_id,
    receipt_date: r.receipt_date,
    invoice_number: (r.invoice_number as string | null) ?? null,
    invoice_url: (r.invoice_url as string | null) ?? null,
    invoice_filename: (r.invoice_filename as string | null) ?? null,
    invoice_uploaded_at: (r.invoice_uploaded_at as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    created_at: r.created_at,
    lines: byReceipt.get(r.id) ?? [],
  }));
}

/**
 * Record a (possibly partial) goods receipt against a PO: insert the receipt +
 * its lines, post the received qty into Main Store stock (the one stock writer),
 * accumulate each PO line's received_qty, set the latest paid rate as the item's
 * cost price (owner: "latest wins"), and flip the PO to 'received' only when every
 * line is fully in. Idempotent it is NOT — each call posts its own stock once.
 */
export async function recordReceipt(input: {
  poId: string;
  receiptDate: string;
  invoiceNumber?: string | null;
  note?: string | null;
  lines: { poLineId: string | null; itemId: string; qty: number; unitRate?: number | null }[];
}): Promise<{ ok: true; receiptId: string; lines: number } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const valid = input.lines.filter((l) => l.itemId && Number(l.qty) > 0);
    if (valid.length === 0) {
      return { ok: false, error: "Add at least one item with a quantity to receive." };
    }

    // 1. Receipt header.
    const { data: receipt, error: rErr } = await supabase
      .from("purchase_order_receipts")
      .insert({
        po_id: input.poId,
        receipt_date: input.receiptDate || new Date().toISOString().slice(0, 10),
        invoice_number: input.invoiceNumber?.trim() || null,
        note: input.note?.trim() || null,
      })
      .select("id")
      .single();
    if (rErr || !receipt) throw rErr ?? new Error("Could not create the receipt");

    // 2. Receipt lines.
    const { error: rlErr } = await supabase.from("purchase_order_receipt_lines").insert(
      valid.map((l) => ({
        receipt_id: receipt.id,
        po_line_id: l.poLineId || null,
        item_id: l.itemId,
        qty: l.qty,
        unit_rate: l.unitRate != null ? l.unitRate : null,
      })),
    );
    if (rlErr) throw rlErr;

    // 3. Post stock + accumulate received_qty + latest rate -> cost price.
    const poLineIds = [...new Set(valid.map((l) => l.poLineId).filter(Boolean))] as string[];
    const recvByLine = new Map<string, number>();
    if (poLineIds.length > 0) {
      const { data: cur } = await supabase
        .from("purchase_order_lines")
        .select("id, received_qty")
        .in("id", poLineIds);
      for (const c of cur ?? []) recvByLine.set(c.id, Number(c.received_qty) || 0);
    }
    for (const l of valid) {
      await recordTransaction({
        item_id: l.itemId,
        warehouse_id: MAIN_STORE,
        transaction_type: "purchase_in",
        quantity: l.qty,
        notes: `PO receipt${input.invoiceNumber ? ` · inv ${input.invoiceNumber.trim()}` : ""}`,
        reference_type: "po_receipt",
        reference_id: receipt.id,
      });
      if (l.poLineId) {
        const next = (recvByLine.get(l.poLineId) ?? 0) + l.qty;
        recvByLine.set(l.poLineId, next);
        const { error: uErr } = await supabase
          .from("purchase_order_lines")
          .update({ received_qty: next })
          .eq("id", l.poLineId);
        if (uErr) throw uErr;
      }
      // Latest paid wins: the entered rate becomes the item's current cost price.
      if (l.unitRate != null && l.unitRate >= 0) {
        await supabase
          .from("items")
          .update({ cost_price: l.unitRate, updated_at: new Date().toISOString() })
          .eq("id", l.itemId);
      }
    }

    // 4. Status: 'received' only when every line is fully in, else 'ordered'.
    const { data: allLines } = await supabase
      .from("purchase_order_lines")
      .select("qty, received_qty")
      .eq("po_id", input.poId);
    const fullyReceived =
      (allLines ?? []).length > 0 &&
      (allLines ?? []).every((l) => Number(l.received_qty) >= Number(l.qty));
    await supabase
      .from("purchase_orders")
      .update({ status: fullyReceived ? "received" : "ordered", updated_at: new Date().toISOString() })
      .eq("id", input.poId);

    revalidateTag("purchase-orders");
    revalidateTag("inventory-stock");
    revalidateTag("items");
    revalidatePath("/procurement");
    revalidatePath(`/procurement/${input.poId}`);
    return { ok: true, receiptId: receipt.id, lines: valid.length };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not record the receipt") };
  }
}

/** Attach (or replace) the invoice file on a receipt. FormData: receiptId, poId, file. */
export async function uploadReceiptInvoice(
  formData: FormData,
): Promise<{ ok: true; url: string; filename: string } | { ok: false; error: string }> {
  try {
    const receiptId = formData.get("receiptId");
    const poId = formData.get("poId");
    const file = formData.get("file");
    if (typeof receiptId !== "string" || !receiptId) throw new Error("Missing receipt");
    if (typeof poId !== "string" || !poId) throw new Error("Missing purchase order");
    if (!(file instanceof File)) throw new Error("Missing file");
    if (file.size === 0) throw new Error("File is empty");
    if (file.size > INVOICE_MAX_BYTES)
      throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 50 MB.`);
    if (!INVOICE_MIME.has(file.type))
      throw new Error(`Unsupported file type "${file.type}". Use PDF, PNG, JPG, or WebP.`);

    const supabase = await createClient();
    // Best-effort cleanup of any previous invoice on this receipt.
    const { data: existing } = await supabase
      .from("purchase_order_receipts")
      .select("invoice_url")
      .eq("id", receiptId)
      .single();
    const prev = (existing?.invoice_url as string | null) ?? null;
    if (prev) {
      const p = extractInvoicePath(prev);
      if (p) await supabase.storage.from(INVOICE_BUCKET).remove([p]);
    }

    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = `${poId}/${receiptId}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from(INVOICE_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw upErr;
    const { data: { publicUrl } } = supabase.storage.from(INVOICE_BUCKET).getPublicUrl(path);

    const { error: uErr } = await supabase
      .from("purchase_order_receipts")
      .update({
        invoice_url: publicUrl,
        invoice_filename: file.name,
        invoice_uploaded_at: new Date().toISOString(),
      })
      .eq("id", receiptId);
    if (uErr) throw uErr;

    revalidateTag("purchase-orders");
    revalidatePath(`/procurement/${poId}`);
    return { ok: true, url: publicUrl, filename: file.name };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not upload the invoice") };
  }
}

/* ================================================================== */
/*  PO PDF copy — the supplier's/printed PO document on the PO header   */
/*  The browser uploads the bytes straight to the `po-invoices` bucket  */
/*  (path `${poId}/po-document/...`), bypassing the serverless body cap */
/*  for big PDFs; these actions just record / clear the stored path.    */
/* ================================================================== */

/** Record a PO PDF the browser already uploaded to storage at `path`. */
export async function recordPoDocument(input: {
  poId: string;
  path: string;
  filename: string;
}): Promise<{ ok: true; url: string; filename: string } | { ok: false; error: string }> {
  try {
    const { poId, path, filename } = input;
    if (!poId) throw new Error("Missing purchase order");
    if (!path || !path.startsWith(`${poId}/`)) throw new Error("Invalid storage path for this PO");
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("purchase_orders")
      .select("po_pdf_url, po_number, supplier_name")
      .eq("id", poId)
      .single();
    const prev = (existing?.po_pdf_url as string | null) ?? null;
    if (prev) {
      const p = extractInvoicePath(prev);
      if (p && p !== path) await supabase.storage.from(INVOICE_BUCKET).remove([p]);
    }

    const { data: { publicUrl } } = supabase.storage.from(INVOICE_BUCKET).getPublicUrl(path);
    const { error } = await supabase
      .from("purchase_orders")
      .update({
        po_pdf_url: publicUrl,
        po_pdf_filename: filename,
        po_pdf_uploaded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", poId);
    if (error) throw error;

    await logPoChange(supabase, {
      po_id: poId,
      po_number: existing?.po_number ?? null,
      supplier_name: existing?.supplier_name ?? null,
      action: "update",
      changes: [{ field: "PO PDF", old: existing?.po_pdf_url ? "(file)" : null, new: filename }],
      note: "PO PDF attached",
    });

    revalidateTag("purchase-orders");
    revalidatePath(`/procurement/${poId}`);
    return { ok: true, url: publicUrl, filename };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not record the PO document") };
  }
}

/** Remove the PO PDF copy from a PO (deletes the storage object + clears columns). */
export async function deletePoDocument(poId: string): Promise<SaveResult> {
  try {
    if (!poId) throw new Error("Missing purchase order");
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("purchase_orders")
      .select("po_pdf_url, po_pdf_filename, po_number, supplier_name")
      .eq("id", poId)
      .single();
    const url = (row?.po_pdf_url as string | null) ?? null;
    if (url) {
      const p = extractInvoicePath(url);
      if (p) await supabase.storage.from(INVOICE_BUCKET).remove([p]);
    }
    const { error } = await supabase
      .from("purchase_orders")
      .update({
        po_pdf_url: null,
        po_pdf_filename: null,
        po_pdf_uploaded_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", poId);
    if (error) throw error;
    await logPoChange(supabase, {
      po_id: poId,
      po_number: row?.po_number ?? null,
      supplier_name: row?.supplier_name ?? null,
      action: "update",
      changes: [{ field: "PO PDF", old: row?.po_pdf_filename ?? "(file)", new: null }],
      note: "PO PDF removed",
    });
    revalidateTag("purchase-orders");
    revalidatePath(`/procurement/${poId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not remove the PO document") };
  }
}

/**
 * Undo a receipt: reverse its stock (negative adjustment per line), decrement the
 * PO lines' received_qty, delete the invoice file + the receipt (cascade lines),
 * and reopen the PO if it was fully received. cost_price is NOT reverted — the
 * price book keeps the last entered rate (edit the item if it was wrong).
 */
export async function deleteReceipt(receiptId: string, poId: string): Promise<SaveResult> {
  try {
    const supabase = await createClient();
    const { data: lines, error } = await supabase
      .from("purchase_order_receipt_lines")
      .select("po_line_id, item_id, qty")
      .eq("receipt_id", receiptId);
    if (error) throw error;

    const decByLine = new Map<string, number>();
    for (const l of lines ?? []) {
      await recordTransaction({
        item_id: l.item_id,
        warehouse_id: MAIN_STORE,
        transaction_type: "adjustment",
        quantity: -(Number(l.qty) || 0),
        notes: "PO receipt undone",
        reference_type: "po_receipt_undo",
        reference_id: receiptId,
      });
      if (l.po_line_id)
        decByLine.set(l.po_line_id, (decByLine.get(l.po_line_id) ?? 0) + (Number(l.qty) || 0));
    }
    if (decByLine.size > 0) {
      const { data: cur } = await supabase
        .from("purchase_order_lines")
        .select("id, received_qty")
        .in("id", [...decByLine.keys()]);
      for (const c of cur ?? []) {
        const next = Math.max(0, (Number(c.received_qty) || 0) - (decByLine.get(c.id) ?? 0));
        await supabase.from("purchase_order_lines").update({ received_qty: next }).eq("id", c.id);
      }
    }

    const { data: rec } = await supabase
      .from("purchase_order_receipts")
      .select("invoice_url")
      .eq("id", receiptId)
      .single();
    const url = (rec?.invoice_url as string | null) ?? null;
    if (url) {
      const p = extractInvoicePath(url);
      if (p) await supabase.storage.from(INVOICE_BUCKET).remove([p]);
    }

    const { error: dErr } = await supabase
      .from("purchase_order_receipts")
      .delete()
      .eq("id", receiptId);
    if (dErr) throw dErr;

    const { data: allLines } = await supabase
      .from("purchase_order_lines")
      .select("qty, received_qty")
      .eq("po_id", poId);
    const fullyReceived =
      (allLines ?? []).length > 0 &&
      (allLines ?? []).every((l) => Number(l.received_qty) >= Number(l.qty));
    await supabase
      .from("purchase_orders")
      .update({ status: fullyReceived ? "received" : "ordered", updated_at: new Date().toISOString() })
      .eq("id", poId);

    revalidateTag("purchase-orders");
    revalidateTag("inventory-stock");
    revalidatePath("/procurement");
    revalidatePath(`/procurement/${poId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Could not undo the receipt") };
  }
}

function extractInvoicePath(url: string): string | null {
  const marker = `/object/public/${INVOICE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}
