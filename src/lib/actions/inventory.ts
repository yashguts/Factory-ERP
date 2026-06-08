"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag } from "next/cache";
import type { ItemType, TransactionType, FieldChange, StockBehaviour } from "@/lib/supabase/types";

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

  // Cabin items live in their own /cabin-inventory section — keep them out of
  // the main inventory list. Build the "Cabin" category subtree to exclude.
  const { data: allCats } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  const cabinChildrenOf = new Map<string, string[]>();
  for (const c of allCats ?? []) {
    if (c.parent_id) {
      const a = cabinChildrenOf.get(c.parent_id) ?? [];
      a.push(c.id as string);
      cabinChildrenOf.set(c.parent_id as string, a);
    }
  }
  const cabinRoot = (allCats ?? []).find(
    (c) => c.name === "Cabin" && c.parent_id === null,
  );
  const cabinCatIds = new Set<string>();
  if (cabinRoot) {
    const stack = [cabinRoot.id as string];
    while (stack.length) {
      const id = stack.pop() as string;
      cabinCatIds.add(id);
      for (const ch of cabinChildrenOf.get(id) ?? []) stack.push(ch);
    }
  }

  return allItems
    .filter(
      (item) => !(item.category_id && cabinCatIds.has(item.category_id as string)),
    )
    .map((item) => {
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
      /** stocked | phantom | tooling — stock/planning behaviour. */
      stock_behaviour: (item.stock_behaviour as StockBehaviour) ?? "stocked",
      /** Finish-variant grouping. */
      family: (item.family as string | null) ?? null,
      finish: (item.finish as string | null) ?? null,
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

/**
 * Result shape for create/update operations. Returning a discriminated
 * union (rather than throwing) lets the form surface real error messages
 * to the user — Next.js strips thrown-error messages in production
 * server actions for security, so genuine validation feedback like
 * "code already exists" needs to come back as data, not an exception.
 */
export type ItemSaveResult =
  | { ok: true; id: string; code: string }
  | { ok: false; error: string };

/** Prefix used when auto-generating an item code (blank code on create). */
function autoCodePrefix(
  stockBehaviour: StockBehaviour | undefined,
  itemType: ItemType,
): string {
  if (stockBehaviour === "phantom") return "LP"; // loose part
  switch (itemType) {
    case "raw_material":
      return "RM";
    case "sub_assembly":
      return "SA";
    case "finished_good":
      return "FG";
    case "mechanical_finished_stock":
      return "MFS";
    case "door_panel":
      return "DP";
    default:
      return "ITM";
  }
}

/** Next free PREFIX-NNN code (zero-padded), scanning existing codes. */
async function nextAutoCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prefix: string,
): Promise<string> {
  const { data } = await supabase
    .from("items")
    .select("code")
    .ilike("code", `${prefix}-%`);
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const r of data ?? []) {
    const m = re.exec(String((r as { code: string }).code));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
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
  /** Make/Trade override. NULL/undefined = inherit from category. */
  procurement_type?: "make" | "trade" | null;
  /** stocked | phantom | tooling. Defaults to 'stocked' if omitted. */
  stock_behaviour?: StockBehaviour;
  /** Up to 5 supplier names (only meaningful for Trade items). */
  suppliers?: string[];
  /** Optional reason recorded in the change log (not stored on items). */
  note?: string;
}): Promise<ItemSaveResult> {
  const supabase = await createClient();

  // Auto-generate the code when the user leaves it blank (e.g. the quick
  // "Create loose part" flow). Typed codes are always used as-is.
  let code = (data.code ?? "").trim();
  if (!code) {
    code = await nextAutoCode(
      supabase,
      autoCodePrefix(data.stock_behaviour, data.item_type),
    );
  }

  const { data: item, error } = await supabase
    .from("items")
    .insert({
      code,
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
      stock_behaviour: data.stock_behaviour ?? "stocked",
      suppliers: normalizeSuppliers(data.suppliers),
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: translateItemError(error, code, data.name) };
  }

  // Log the creation as a snapshot of the meaningful starting values.
  // (is_active is always true on create — omit it as noise.)
  const createChanges: FieldChange[] = TRACKED_ITEM_FIELDS.filter(
    (field) => field !== "is_active",
  )
    .map((field) => {
      const value =
        field === "suppliers"
          ? normalizeSuppliers(data.suppliers)
          : (data as Record<string, unknown>)[field];
      return { field, old: null, new: value ?? null };
    })
    .filter(
      (c) =>
        c.new !== null &&
        c.new !== "" &&
        !(Array.isArray(c.new) && c.new.length === 0),
    );
  await logItemChange(supabase, {
    item_id: item.id as string,
    item_code: code,
    item_name: data.name,
    action: "create",
    changes: createChanges,
    note: data.note,
  });

  revalidateTag("items");
  return { ok: true, id: item.id as string, code };
}

/**
 * Convert raw Supabase errors into messages the user can act on.
 * Anything we don't recognise falls back to the original `error.message`
 * (which itself is safe to surface — these are PG validation errors,
 * not internal stack traces).
 */
function translateItemError(
  error: { code?: string; message: string },
  attemptedCode?: string,
  attemptedName?: string,
): string {
  if (error.code === "23505") {
    // unique_violation
    if (error.message.includes("items_code_key")) {
      return attemptedCode
        ? `Item code "${attemptedCode}" already exists. Pick a different code.`
        : "An item with this code already exists.";
    }
    if (error.message.includes("items_active_name_unique_idx")) {
      return attemptedName
        ? `Another active item already uses the name "${attemptedName}". Item names must be unique (case-insensitive).`
        : "Another active item already uses this name. Item names must be unique (case-insensitive).";
    }
    return "A unique constraint was violated. " + error.message;
  }
  if (error.code === "23503") {
    // foreign_key_violation
    return "Referenced category or unit was not found. Try reselecting them.";
  }
  if (error.code === "23514") {
    // check_violation
    if (error.message.includes("items_suppliers_max_five")) {
      return "At most 5 suppliers are allowed per item.";
    }
    return "A value failed validation: " + error.message;
  }
  return error.message;
}

/* ------------------------------------------------------------------ *
 * Item change logging
 *
 * Every create/update/delete on an item writes a row to
 * `item_change_log` so Inventory → Daily Changes can show what was
 * edited on a given date and offer one-click undo. Log writes are
 * best-effort: a logging failure must never block the user's real edit.
 * ------------------------------------------------------------------ */

/** Item columns we track for the change log + before/after diffing. */
const TRACKED_ITEM_FIELDS = [
  "code",
  "name",
  "description",
  "item_type",
  "category_id",
  "uom_id",
  "minimum_stock",
  "reorder_point",
  "lead_time_days",
  "cost_price",
  "procurement_type",
  "stock_behaviour",
  "suppliers",
  "is_active",
] as const;

type TrackedField = (typeof TRACKED_ITEM_FIELDS)[number];

const NUMERIC_ITEM_FIELDS = new Set<TrackedField>([
  "minimum_stock",
  "reorder_point",
  "lead_time_days",
  "cost_price",
]);

/** Normalise a value so semantically-equal old/new don't register as a change. */
function normalizeForCompare(field: TrackedField, value: unknown): unknown {
  if (value === undefined) return null;
  if (NUMERIC_ITEM_FIELDS.has(field)) {
    return value === null || value === "" ? null : Number(value);
  }
  if (field === "suppliers") {
    return JSON.stringify(
      normalizeSuppliers(value as string[] | null | undefined),
    );
  }
  if (field === "description" || field === "category_id") {
    // Treat empty string and null as the same "unset" value.
    return value === "" || value === null ? null : value;
  }
  return value;
}

function fieldChanged(
  field: TrackedField,
  oldVal: unknown,
  newVal: unknown,
): boolean {
  return (
    normalizeForCompare(field, oldVal) !== normalizeForCompare(field, newVal)
  );
}

/**
 * Insert a change-log row. Swallows all errors (best-effort) so a logging
 * problem can't break the create/update/delete the user actually asked
 * for. Shares the caller's request-scoped Supabase client.
 */
async function logItemChange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: {
    item_id: string | null;
    item_code: string | null;
    item_name: string | null;
    action: "create" | "update" | "delete";
    changes: FieldChange[];
    note?: string | null;
    revert_of?: string | null;
  },
): Promise<void> {
  try {
    const { error } = await supabase.from("item_change_log").insert({
      item_id: row.item_id,
      item_code: row.item_code,
      item_name: row.item_name,
      action: row.action,
      changes: row.changes,
      note: row.note ?? null,
      revert_of: row.revert_of ?? null,
    });
    if (error) console.error("[item_change_log] insert failed:", error.message);
  } catch (e) {
    console.error("[item_change_log] insert threw:", e);
  }
}

/**
 * Delete an item — smart between hard and soft delete.
 *
 * Hard delete (row goes away, plus any zero-stock inventory rows) is
 * only safe when nothing references the item: no transactions, no BOM
 * (template OR job) headers or lines, no import column mappings.
 *
 * If anything references it, fall back to soft delete (is_active=false)
 * so the existing audit trail / BOMs aren't broken. The item disappears
 * from inventory list + search but its data stays.
 *
 * The result tells the caller which path was taken so the UI can show
 * an honest message.
 */
export type DeleteItemResult =
  | { ok: true; action: "hard_deleted" | "soft_deleted" }
  | { ok: false; error: string };

export async function deleteItem(
  itemId: string,
  note?: string,
): Promise<DeleteItemResult> {
  if (!itemId) return { ok: false, error: "Missing itemId" };
  const supabase = await createClient();

  // Snapshot the code/name first so the change-log entry stays readable
  // even after a hard delete removes the row.
  const { data: snapshot } = await supabase
    .from("items")
    .select("code, name")
    .eq("id", itemId)
    .single();

  // Count references in every child table in parallel.
  const refQueries = await Promise.all([
    supabase
      .from("inventory_transactions")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId),
    supabase
      .from("job_bom_lines")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId),
    supabase
      .from("bom_lines")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId),
    supabase
      .from("bom_headers")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId),
    supabase
      .from("job_bom_headers")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId),
    supabase
      .from("target_column_map")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId),
  ]);

  for (const r of refQueries) {
    if (r.error) return { ok: false, error: r.error.message };
  }
  const hasHistory = refQueries.some((r) => (r.count ?? 0) > 0);

  if (hasHistory) {
    // Soft delete — preserve history, hide from active views.
    const { error } = await supabase
      .from("items")
      .update({ is_active: false })
      .eq("id", itemId);
    if (error) return { ok: false, error: error.message };

    // item_id is preserved (the row still exists), so this delete is
    // undoable by flipping is_active back to true.
    await logItemChange(supabase, {
      item_id: itemId,
      item_code: snapshot?.code ?? null,
      item_name: snapshot?.name ?? null,
      action: "delete",
      changes: [{ field: "is_active", old: true, new: false }],
      note:
        note ??
        "Soft delete — item is referenced elsewhere, so it was hidden from active lists.",
    });

    revalidateTag("items");
    revalidateTag("inventory-stock");
    return { ok: true, action: "soft_deleted" };
  }

  // Hard delete is safe. Drop any inventory balance rows first (they
  // exist even when qty=0 from past stock-adjust-to-zero operations).
  const { error: invErr } = await supabase
    .from("inventory")
    .delete()
    .eq("item_id", itemId);
  if (invErr) return { ok: false, error: invErr.message };

  const { error } = await supabase.from("items").delete().eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  // The row is gone, so we log with item_id=null (inserting the old id
  // would violate the FK). A null item_id also signals "not undoable".
  await logItemChange(supabase, {
    item_id: null,
    item_code: snapshot?.code ?? null,
    item_name: snapshot?.name ?? null,
    action: "delete",
    changes: [],
    note: note ?? "Permanently deleted (item had no references).",
  });

  revalidateTag("items");
  revalidateTag("inventory-stock");
  return { ok: true, action: "hard_deleted" };
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
    /** stocked | phantom | tooling. Omit to leave unchanged. */
    stock_behaviour?: StockBehaviour;
    /** Up to 5 supplier names. Pass `[]` to clear all. Omit to leave unchanged. */
    suppliers?: string[];
    /** Optional reason recorded in the change log (not stored on items). */
    note?: string;
  },
): Promise<ItemSaveResult> {
  const supabase = await createClient();

  // `note` is change-log metadata, not a column on items — keep it out of
  // the update payload (otherwise the write fails with an unknown column).
  const { note, ...fields } = data;

  // The codebase treats items.name as the single source of truth for the
  // display label. `lookup_key` is legacy data that the search fallback
  // still reads from, so we keep it in lock-step with `name` whenever
  // the user edits the name — that way edited names show immediately
  // and the search index doesn't drift.
  const payload: Record<string, unknown> = { ...fields };
  if (typeof fields.name === "string") {
    payload.lookup_key = fields.name;
  }
  if (fields.suppliers !== undefined) {
    payload.suppliers = normalizeSuppliers(fields.suppliers);
  }

  // Capture the before-image so we can log a precise field-level diff.
  // Best-effort: if this read fails we still perform the update.
  const { data: before } = await supabase
    .from("items")
    .select(
      "code, name, description, item_type, category_id, uom_id, minimum_stock, reorder_point, lead_time_days, cost_price, procurement_type, stock_behaviour, suppliers, is_active",
    )
    .eq("id", id)
    .single();

  const { data: item, error } = await supabase
    .from("items")
    .update(payload)
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return {
      ok: false,
      error: translateItemError(error, fields.code, fields.name),
    };
  }

  // Record exactly which tracked fields changed (only those in this update).
  if (before) {
    const changes: FieldChange[] = [];
    for (const field of TRACKED_ITEM_FIELDS) {
      const newRaw = (fields as Record<string, unknown>)[field];
      if (newRaw === undefined) continue; // not part of this update
      const oldRaw = (before as Record<string, unknown>)[field];
      if (fieldChanged(field, oldRaw, newRaw)) {
        const normalizedNew =
          field === "suppliers"
            ? normalizeSuppliers(newRaw as string[])
            : newRaw;
        changes.push({ field, old: oldRaw ?? null, new: normalizedNew ?? null });
      }
    }
    if (changes.length > 0 || note) {
      await logItemChange(supabase, {
        item_id: id,
        item_code: (fields.code as string) ?? before.code ?? null,
        item_name: (fields.name as string) ?? before.name ?? null,
        action: "update",
        changes,
        note,
      });
    }
  }

  revalidateTag("items");
  return {
    ok: true,
    id: item.id as string,
    code: (fields.code as string) ?? (before?.code as string) ?? "",
  };
}

export async function recordTransaction(data: {
  item_id: string;
  warehouse_id: string;
  transaction_type: TransactionType;
  quantity: number;
  notes?: string;
  /** Optional provenance — used by the change-log "undo" to tag reversals. */
  reference_type?: string;
  reference_id?: string;
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
