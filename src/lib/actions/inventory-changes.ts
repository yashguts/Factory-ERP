"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidateTag } from "next/cache";
import { getCategories, getUnits, deleteItem, recordTransaction } from "./inventory";
import {
  ITEM_FIELD_LABELS,
  type FieldChange,
  type ItemChangeLog,
  type ItemChangeRow,
  type StockChangeRow,
  type InventoryChangeRow,
  type TransactionType,
} from "@/lib/supabase/types";
import { appliedDelta } from "@/lib/inventory/transactions";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";

/**
 * The business runs in India (IST, UTC+05:30). The date picker hands us a
 * calendar day; we translate it to the matching UTC window so "changes on
 * 29 May" means the IST day, not the UTC day.
 */
const IST_OFFSET = "+05:30";

function istDayRange(date: string): { startIso: string; endIso: string } {
  const start = new Date(`${date}T00:00:00${IST_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** PostgREST embeds can come back as object or single-element array. */
function flattenOne<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

function humanizeEnum(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Render a tracked field's stored value as a readable string for the diff UI. */
function formatFieldValue(
  field: string,
  value: unknown,
  maps: { cat: Map<string, string>; uom: Map<string, string> },
): string {
  if (value === null || value === undefined || value === "") {
    // A null Make/Trade override means the item inherits from its category.
    return field === "procurement_type" ? "Inherit from category" : "—";
  }
  switch (field) {
    case "category_id":
      return maps.cat.get(String(value)) ?? "(unknown category)";
    case "uom_id":
      return maps.uom.get(String(value)) ?? "(unknown unit)";
    case "is_active":
      return value ? "Active" : "Inactive";
    case "procurement_type":
      return value === "make" ? "Make" : value === "trade" ? "Trade" : "Inherit from category";
    case "item_type":
      return humanizeEnum(value);
    case "suppliers":
      return Array.isArray(value) && value.length > 0
        ? (value as string[]).join(", ")
        : "—";
    default:
      return String(value);
  }
}

function enrichChanges(
  changes: FieldChange[],
  maps: { cat: Map<string, string>; uom: Map<string, string> },
): FieldChange[] {
  if (!Array.isArray(changes)) return [];
  return changes.map((c) => ({
    ...c,
    label: ITEM_FIELD_LABELS[c.field] ?? c.field,
    old_display: formatFieldValue(c.field, c.old, maps),
    new_display: formatFieldValue(c.field, c.new, maps),
  }));
}

/**
 * Daily summary of every inventory change on a given IST calendar date:
 * item create/update/delete entries (with before→after diffs) merged with
 * stock movements. Uncached so edits/undos reflect immediately.
 */
export async function getInventoryChanges(
  from: string,
  to?: string,
): Promise<InventoryChangeRow[]> {
  const supabase = await createClient();
  const startIso = istDayRange(from).startIso;
  const endIso = istDayRange(to ?? from).endIso;

  // Page through the full window (fetchAllRanged) so a multi-day range — or a
  // busy single day — returns every row instead of being silently capped at
  // Supabase's 1000-row default.
  const [logData, txnData, cats, units] = await Promise.all([
    fetchAllRanged<ItemChangeLog>((lo, hi, wc) =>
      supabase
        .from("item_change_log")
        .select("*", wc ? { count: "exact" } : {})
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .order("created_at", { ascending: false })
        .range(lo, hi),
    ),
    fetchAllRanged<Record<string, unknown>>((lo, hi, wc) =>
      supabase
        .from("inventory_transactions")
        .select(
          `id, created_at, item_id, warehouse_id, transaction_type, quantity, notes, reference_type, reference_id,
           item:items(code, name),
           warehouse:warehouses(name)`,
          wc ? { count: "exact" } : {},
        )
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .order("created_at", { ascending: false })
        .range(lo, hi),
    ),
    getCategories(),
    getUnits(),
  ]);

  const maps = {
    cat: new Map<string, string>((cats ?? []).map((c) => [c.id, c.name])),
    uom: new Map<string, string>(
      (units ?? []).map((u) => [u.id, u.abbreviation as string]),
    ),
  };

  return assembleRows(supabase, logData, txnData, maps);
}

/**
 * Full change history for ONE item across all dates (newest first): its
 * create/update/delete log entries merged with its stock movements. Powers
 * the item-history search on the Daily Changes page.
 */
export async function getItemChangeHistory(
  itemId: string,
  from?: string,
  to?: string,
): Promise<InventoryChangeRow[]> {
  if (!itemId) return [];
  const supabase = await createClient();

  let logQuery = supabase
    .from("item_change_log")
    .select("*")
    .eq("item_id", itemId);
  let txnQuery = supabase
    .from("inventory_transactions")
    .select(
      `id, created_at, item_id, warehouse_id, transaction_type, quantity, notes, reference_type, reference_id,
       item:items(code, name),
       warehouse:warehouses(name)`,
    )
    .eq("item_id", itemId);

  // Optional IST date-range bounds (YYYY-MM-DD). Same day-window helper as the
  // single-day feed, so the range is inclusive of both calendar days in IST.
  if (from) {
    const startIso = istDayRange(from).startIso;
    logQuery = logQuery.gte("created_at", startIso);
    txnQuery = txnQuery.gte("created_at", startIso);
  }
  if (to) {
    const endIso = istDayRange(to).endIso;
    logQuery = logQuery.lt("created_at", endIso);
    txnQuery = txnQuery.lt("created_at", endIso);
  }

  const [logRes, txnRes, cats, units] = await Promise.all([
    logQuery.order("created_at", { ascending: false }).limit(300),
    txnQuery.order("created_at", { ascending: false }).limit(300),
    getCategories(),
    getUnits(),
  ]);

  if (logRes.error) throw logRes.error;
  if (txnRes.error) throw txnRes.error;

  const maps = {
    cat: new Map<string, string>((cats ?? []).map((c) => [c.id, c.name])),
    uom: new Map<string, string>(
      (units ?? []).map((u) => [u.id, u.abbreviation as string]),
    ),
  };

  return assembleRows(
    supabase,
    (logRes.data ?? []) as ItemChangeLog[],
    (txnRes.data ?? []) as Array<Record<string, unknown>>,
    maps,
  );
}

/**
 * Build the unified, sorted change-row list from raw log + transaction rows,
 * flagging which stock movements already have a reversal posted (any date).
 */
async function assembleRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  logRows: ItemChangeLog[],
  txns: Array<Record<string, unknown>>,
  maps: { cat: Map<string, string>; uom: Map<string, string> },
): Promise<InventoryChangeRow[]> {
  const txnIds = txns.map((t) => t.id as string);

  // The three resolution blocks below read only from the already-fetched txns —
  // independent of each other, so their round-trip chains run concurrently.
  const [reversedIds, poByReceipt, jobByDispatch] = await Promise.all([
    // Look up which of these were reversed. Chunk the id list (batches of 300): a
    // single .in() with thousands of UUIDs would overflow the request URL on a
    // wide date range. Batches run in parallel, so this stays one round-trip deep.
    (async () => {
      const reversedIds = new Set<string>();
      if (txnIds.length > 0) {
        const batches: string[][] = [];
        for (let i = 0; i < txnIds.length; i += 300) batches.push(txnIds.slice(i, i + 300));
        const results = await Promise.all(
          batches.map((batch) =>
            supabase
              .from("inventory_transactions")
              .select("reference_id")
              .eq("reference_type", "txn_reversal")
              .in("reference_id", batch),
          ),
        );
        for (const { data } of results)
          for (const r of data ?? []) {
            const ref = r.reference_id as string | null;
            if (ref) reversedIds.add(ref);
          }
      }
      return reversedIds;
    })(),

    // Resolve the source PO (number + id) for "po_receipt" movements so the feed
    // can show + filter by PO number. txn.reference_id is the receipt id →
    // purchase_order_receipts.po_id → purchase_orders.po_number.
    (async () => {
      const receiptIds = [
        ...new Set(
          txns
            .filter((t) => t.reference_type === "po_receipt")
            .map((t) => t.reference_id as string | null)
            .filter((x): x is string => !!x),
        ),
      ];
      const poByReceipt = new Map<string, { po_id: string; po_number: string | null }>();
      if (receiptIds.length > 0) {
        const { data: receipts } = await supabase
          .from("purchase_order_receipts")
          .select("id, po_id")
          .in("id", receiptIds);
        const poIds = [...new Set((receipts ?? []).map((r) => r.po_id as string).filter(Boolean))];
        const poNum = new Map<string, string | null>();
        if (poIds.length > 0) {
          const { data: pos } = await supabase
            .from("purchase_orders")
            .select("id, po_number")
            .in("id", poIds);
          for (const p of pos ?? []) poNum.set(p.id as string, (p.po_number as string | null) ?? null);
        }
        for (const r of receipts ?? [])
          poByReceipt.set(r.id as string, {
            po_id: r.po_id as string,
            po_number: poNum.get(r.po_id as string) ?? null,
          });
      }
      return poByReceipt;
    })(),

    // Resolve the source job (number + id) for dispatch movements so the feed can
    // show which job a stock-out belongs to. txn.reference_id is the dispatch id →
    // job_dispatches.job_id → jobs.job_number. Covers both 'dispatch' (the
    // deduction) and 'dispatch_undo' (its reversal), which share the dispatch id.
    (async () => {
      const dispatchIds = [
        ...new Set(
          txns
            .filter((t) => t.reference_type === "dispatch" || t.reference_type === "dispatch_undo")
            .map((t) => t.reference_id as string | null)
            .filter((x): x is string => !!x),
        ),
      ];
      const jobByDispatch = new Map<string, { job_id: string; job_number: string | null }>();
      if (dispatchIds.length > 0) {
        const { data: dispatches } = await supabase
          .from("job_dispatches")
          .select("id, job_id")
          .in("id", dispatchIds);
        const jobIds = [...new Set((dispatches ?? []).map((d) => d.job_id as string).filter(Boolean))];
        const jobNum = new Map<string, string | null>();
        if (jobIds.length > 0) {
          const { data: jobs } = await supabase
            .from("jobs")
            .select("id, job_number")
            .in("id", jobIds);
          for (const j of jobs ?? []) jobNum.set(j.id as string, (j.job_number as string | null) ?? null);
        }
        for (const d of dispatches ?? [])
          jobByDispatch.set(d.id as string, {
            job_id: d.job_id as string,
            job_number: jobNum.get(d.job_id as string) ?? null,
          });
      }
      return jobByDispatch;
    })(),
  ]);

  const itemRows: ItemChangeRow[] = logRows.map((row) => ({
    kind: "item",
    id: row.id,
    created_at: row.created_at,
    item_id: row.item_id,
    item_code: row.item_code,
    item_name: row.item_name,
    action: row.action,
    changes: enrichChanges(row.changes ?? [], maps),
    note: row.note,
    reverted_at: row.reverted_at,
    revert_of: row.revert_of,
    can_undo:
      row.reverted_at === null &&
      row.revert_of === null &&
      !(row.action === "delete" && row.item_id === null),
  }));

  const stockRows: StockChangeRow[] = txns.map((t) => {
    const item = flattenOne(t.item as { code: string; name: string } | null);
    const warehouse = flattenOne(t.warehouse as { name: string } | null);
    const type = t.transaction_type as TransactionType;
    const id = t.id as string;
    const refType = (t.reference_type as string | null) ?? null;
    const isReversal = refType === "txn_reversal";
    const po =
      refType === "po_receipt" && t.reference_id
        ? poByReceipt.get(t.reference_id as string)
        : undefined;
    const job =
      (refType === "dispatch" || refType === "dispatch_undo") && t.reference_id
        ? jobByDispatch.get(t.reference_id as string)
        : undefined;
    return {
      kind: "stock",
      id,
      created_at: t.created_at as string,
      item_id: (t.item_id as string | null) ?? null,
      item_code: item?.code ?? null,
      item_name: item?.name ?? null,
      transaction_type: type,
      quantity: appliedDelta(type, Number(t.quantity)),
      warehouse_id: (t.warehouse_id as string | null) ?? null,
      warehouse_name: warehouse?.name ?? null,
      note: (t.notes as string | null) ?? null,
      can_undo: !isReversal && !reversedIds.has(id),
      reference_type: refType,
      po_id: po?.po_id ?? null,
      po_number: po?.po_number ?? null,
      job_id: job?.job_id ?? null,
      job_number: job?.job_number ?? null,
    };
  });

  return [...itemRows, ...stockRows].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
}

export type ChangeActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Undo an item change-log entry:
 *  - update      → restore the previous field values (logged as a new entry)
 *  - create      → delete the just-created item (smart hard/soft)
 *  - soft delete → reactivate the item
 *  - hard delete → not possible (item row is gone)
 * The original entry is then marked reverted so it can't be undone twice.
 */
export async function revertItemChange(
  logId: string,
): Promise<ChangeActionResult> {
  if (!logId) return { ok: false, error: "Missing change id." };
  const supabase = await createClient();

  const { data: log, error: loadErr } = await supabase
    .from("item_change_log")
    .select("*")
    .eq("id", logId)
    .single();
  if (loadErr || !log) return { ok: false, error: "Change not found." };

  const entry = log as ItemChangeLog;
  if (entry.reverted_at) return { ok: false, error: "This change was already undone." };
  if (entry.revert_of)
    return { ok: false, error: "Undo entries can't themselves be undone — re-edit the item instead." };

  // --- create: undo by deleting the item ---------------------------------
  if (entry.action === "create") {
    if (!entry.item_id)
      return { ok: false, error: "The created item no longer exists." };
    const res = await deleteItem(
      entry.item_id,
      `Undo of item creation${entry.note ? ` (${entry.note})` : ""}`,
    );
    if (!res.ok) return { ok: false, error: res.error };
    await markReverted(supabase, logId);
    return { ok: true };
  }

  // --- delete: undo by reactivating (only possible for soft deletes) -----
  if (entry.action === "delete") {
    if (!entry.item_id)
      return { ok: false, error: "Permanently-deleted items can't be restored." };
    const { error } = await supabase
      .from("items")
      .update({ is_active: true })
      .eq("id", entry.item_id);
    if (error) return { ok: false, error: error.message };
    await writeRevertLog(supabase, entry, logId, [
      { field: "is_active", old: false, new: true },
    ]);
    await markReverted(supabase, logId);
    revalidateTag("items");
    revalidateTag("inventory-stock");
    return { ok: true };
  }

  // --- update: restore the old field values ------------------------------
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  if (changes.length === 0) {
    // Nothing to restore (note-only entry) — just mark it handled.
    await markReverted(supabase, logId);
    return { ok: true };
  }

  const payload: Record<string, unknown> = {};
  for (const c of changes) payload[c.field] = c.old;
  if (typeof payload.name === "string") payload.lookup_key = payload.name;

  const { error } = await supabase
    .from("items")
    .update(payload)
    .eq("id", entry.item_id as string);
  if (error) return { ok: false, error: error.message };

  // Log the restore as a new entry (inverse direction) linked to the original.
  await writeRevertLog(
    supabase,
    entry,
    logId,
    changes.map((c) => ({ field: c.field, old: c.new, new: c.old })),
  );
  await markReverted(supabase, logId);

  revalidateTag("items");
  return { ok: true };
}

async function markReverted(
  supabase: Awaited<ReturnType<typeof createClient>>,
  logId: string,
): Promise<void> {
  try {
    await supabase
      .from("item_change_log")
      .update({ reverted_at: new Date().toISOString() })
      .eq("id", logId);
  } catch (e) {
    console.error("[item_change_log] markReverted failed:", e);
  }
}

async function writeRevertLog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  original: ItemChangeLog,
  originalId: string,
  changes: FieldChange[],
): Promise<void> {
  try {
    await supabase.from("item_change_log").insert({
      item_id: original.item_id,
      item_code: original.item_code,
      item_name: original.item_name,
      action: "update",
      changes,
      note: `Undo of earlier change`,
      revert_of: originalId,
    });
  } catch (e) {
    console.error("[item_change_log] writeRevertLog failed:", e);
  }
}

/** Edit the free-text note on an item change-log entry. */
export async function updateItemChangeNote(
  logId: string,
  note: string,
): Promise<ChangeActionResult> {
  if (!logId) return { ok: false, error: "Missing change id." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("item_change_log")
    .update({ note: note.trim() || null })
    .eq("id", logId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Edit the note on a stock-movement (inventory_transactions) row. */
export async function updateTransactionNote(
  txnId: string,
  note: string,
): Promise<ChangeActionResult> {
  if (!txnId) return { ok: false, error: "Missing transaction id." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_transactions")
    .update({ notes: note.trim() || null })
    .eq("id", txnId);
  if (error) return { ok: false, error: error.message };
  revalidateTag("inventory-stock");
  return { ok: true };
}

/**
 * Reverse a stock movement by posting an offsetting adjustment that cancels
 * its net effect. The reversal is tagged so the original shows as "reversed"
 * and can't be reversed twice.
 */
export async function reverseTransaction(
  txnId: string,
  note?: string,
): Promise<ChangeActionResult> {
  if (!txnId) return { ok: false, error: "Missing transaction id." };
  const supabase = await createClient();

  const { data: txn, error } = await supabase
    .from("inventory_transactions")
    .select(
      "id, item_id, warehouse_id, transaction_type, quantity, reference_type",
    )
    .eq("id", txnId)
    .single();
  if (error || !txn) return { ok: false, error: "Transaction not found." };

  if (txn.reference_type === "txn_reversal")
    return { ok: false, error: "This entry is itself a reversal." };

  const { data: existing } = await supabase
    .from("inventory_transactions")
    .select("id")
    .eq("reference_type", "txn_reversal")
    .eq("reference_id", txnId)
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: false, error: "This movement was already reversed." };

  const delta = appliedDelta(
    txn.transaction_type as TransactionType,
    Number(txn.quantity),
  );

  try {
    await recordTransaction({
      item_id: txn.item_id as string,
      warehouse_id: txn.warehouse_id as string,
      transaction_type: "adjustment",
      quantity: -delta, // cancel the original net effect
      notes:
        note ??
        `Reversal of ${humanizeEnum(txn.transaction_type)} (ref ${String(txnId).slice(0, 8)})`,
      reference_type: "txn_reversal",
      reference_id: txnId,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  return { ok: true };
}
