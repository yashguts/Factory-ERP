"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag } from "next/cache";
import type { ItemType, TransactionType, FieldChange, StockBehaviour, DemandSource, DemandOverride, OperationMachine } from "@/lib/supabase/types";
import { nextCodeInSeries } from "@/lib/inventory/next-code";
import { expandCategoryDescendants, resolveCategoryPaths } from "@/lib/actions/categories";
import { BOM_SECTIONS } from "@/lib/bom/bom-sections";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { appliedDelta } from "@/lib/inventory/transactions";

export async function getItems() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .select(`
      *,
      category:item_categories!items_category_id_fkey(id, name, parent_id),
      uom:units_of_measurement!items_uom_id_fkey(id, abbreviation)
    `)
    .order("code");

  if (error) throw error;
  return data;
}

// Exported so callers that are THEMSELVES inside an unstable_cache (the MRP
// plan / make-plan) can read items WITHOUT nesting unstable_cache (nesting
// makes the OUTER cache degrade to pass-through). The cached wrapper below is
// what the inventory page uses.
export const _getItemsWithStockUncached = async () => {
  const supabase = createCacheClient();

  // Cabin items live in their own /cabin-inventory section — keep them OUT of the
  // main inventory list. Build the "Cabin" category subtree FIRST so we can exclude
  // it AT THE QUERY. (Cabin grew to ~9k items; fetching all of them just to drop
  // them in JS bloats this read past the cache limit and makes any regeneration of
  // /inventory heavy enough to crash the serverless function — which is what broke
  // the program-audit action, since it revalidates /inventory.)
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
  const cabinIds = [...cabinCatIds];

  const allItems: any[] = await fetchAllRanged(
    (from, to, withCount) => {
      let q = supabase
        .from("items")
        .select(
          `
        *,
        category:item_categories!items_category_id_fkey(id, name, parent_id, procurement_type),
        uom:units_of_measurement!items_uom_id_fkey(id, abbreviation),
        inventory(quantity, warehouse_id)
      `,
          withCount ? { count: "exact" } : {},
        )
        .eq("is_active", true);
      // Exclude the whole Cabin subtree at the DB (keep items with no category).
      if (cabinIds.length > 0) {
        q = q.or(`category_id.is.null,category_id.not.in.(${cabinIds.join(",")})`);
      }
      return q.order("code").range(from, to);
    },
  );

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

// NOTE: there is intentionally NO cached wrapper around the fat read above.
// Its row (~30 fields × ~2,700 active non-cabin items) serialises to ~2.2MB,
// which silently exceeds Next's 2MB unstable_cache entry cap — so a cached
// wrapper never actually cached and re-ran the whole fetch on every request
// (the /settings 2MB build warning). The only consumer that needs the FULL
// shape is the make-plan, which reads `_getItemsWithStockUncached` directly
// (it's already inside its own unstable_cache and must not nest). Everything
// else uses a lighter read: the /inventory list uses getInventoryPage, detail
// pages use getItemRefs, and the Settings overstock report uses the lean
// getItemStockSummaries below.

/* ------------------------------------------------------------------ *
 * Lean item + stock summary read.
 *
 * Whole active non-cabin catalog with on-hand stock, but only the handful
 * of fields the overstock report needs (id/code/name/category/uom/effective
 * procurement/total_stock). ~0.55MB serialised — comfortably under the 2MB
 * cache cap, so unlike the fat read this one actually caches.
 * ------------------------------------------------------------------ */
export interface ItemStockSummary {
  id: string;
  code: string;
  name: string;
  category_name: string | null;
  uom_abbreviation: string | null;
  effective_procurement_type: "make" | "trade" | null;
  total_stock: number;
}

const _getItemStockSummariesUncached = async (): Promise<ItemStockSummary[]> => {
  const supabase = createCacheClient();

  // Exclude the Cabin subtree (cabin items live in /cabin-inventory) — same
  // rule getItemsWithStock applies. Build the id set first so we can drop it
  // at the query.
  const { data: allCats } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  const childrenOf = new Map<string, string[]>();
  for (const c of allCats ?? []) {
    if (c.parent_id) {
      const a = childrenOf.get(c.parent_id as string) ?? [];
      a.push(c.id as string);
      childrenOf.set(c.parent_id as string, a);
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
      for (const ch of childrenOf.get(id) ?? []) stack.push(ch);
    }
  }
  const cabinIds = [...cabinCatIds];

  const rows: any[] = await fetchAllRanged((from, to, withCount) => {
    let q = supabase
      .from("items")
      .select(
        `id, code, name, procurement_type, category_id,
         category:item_categories!items_category_id_fkey(name, procurement_type),
         uom:units_of_measurement!items_uom_id_fkey(abbreviation),
         inventory(quantity)`,
        withCount ? { count: "exact" } : {},
      )
      .eq("is_active", true);
    if (cabinIds.length > 0) {
      q = q.or(`category_id.is.null,category_id.not.in.(${cabinIds.join(",")})`);
    }
    return q.order("code").range(from, to);
  });

  return rows
    .filter(
      (item) => !(item.category_id && cabinCatIds.has(item.category_id as string)),
    )
    .map((item) => {
      // PostgREST returns a belongsTo relation as either {...} or [{...}].
      const cat = (Array.isArray(item.category)
        ? item.category[0]
        : item.category) as {
        name: string;
        procurement_type: "make" | "trade" | null;
      } | null;
      const uom = (Array.isArray(item.uom) ? item.uom[0] : item.uom) as {
        abbreviation: string;
      } | null;
      const itemPT = (item.procurement_type as "make" | "trade" | null) ?? null;
      return {
        id: item.id as string,
        code: item.code as string,
        name: item.name as string,
        category_name: cat?.name ?? null,
        uom_abbreviation: uom?.abbreviation ?? null,
        effective_procurement_type: (itemPT ??
          cat?.procurement_type ??
          null) as "make" | "trade" | null,
        total_stock: (item.inventory ?? []).reduce(
          (sum: number, inv: { quantity: number }) =>
            sum + Number(inv.quantity),
          0,
        ),
      };
    });
};

export const getItemStockSummaries = unstable_cache(
  _getItemStockSummariesUncached,
  ["item-stock-summaries"],
  { revalidate: 600, tags: ["items", "inventory-stock"] },
);

/* ------------------------------------------------------------------ *
 * Lightweight item refs for the ItemFormModal's category-per-type
 * dropdowns. The modal only needs to know which categories contain
 * items of each type, so we ship the DISTINCT (item_type, category_id)
 * pairs — a few hundred tiny objects instead of the full ~2,400-row
 * catalog that getItemsWithStock builds. Detail pages were paying
 * seconds of server time for two fields.
 * ------------------------------------------------------------------ */

const _getItemRefsUncached = async () => {
  const supabase = createCacheClient();

  // Same Cabin-subtree exclusion as getItemsWithStock: cabin items live in
  // their own section and must not surface cabin categories in the modal.
  const { data: allCats } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  const childrenOf = new Map<string, string[]>();
  for (const c of allCats ?? []) {
    if (c.parent_id) {
      const a = childrenOf.get(c.parent_id) ?? [];
      a.push(c.id as string);
      childrenOf.set(c.parent_id as string, a);
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
      for (const ch of childrenOf.get(id) ?? []) stack.push(ch);
    }
  }

  const pairs = new Set<string>();
  const facetRows = await fetchAllRanged<{ item_type: string; category_id: string | null }>(
    (from, to, withCount) =>
      supabase
        .from("items")
        .select("item_type, category_id", withCount ? { count: "exact" } : {})
        .eq("is_active", true)
        .range(from, to),
  );
  for (const r of facetRows) {
    if (r.category_id && cabinCatIds.has(r.category_id)) continue;
    pairs.add(`${r.item_type}|${r.category_id ?? ""}`);
  }

  return [...pairs].map((p) => {
    const [item_type, cat] = p.split("|");
    return {
      item_type: item_type as ItemType,
      category_id: cat || null,
    };
  });
};

export const getItemRefs = unstable_cache(_getItemRefsUncached, ["item-refs"], {
  revalidate: 3600,
  tags: ["items"],
});

/* ------------------------------------------------------------------ *
 * Server-side inventory pagination (the /inventory list).
 *
 * The page used to ship every active non-cabin item (~2,400 rows × 30+
 * fields) to the browser and filter/sort/paginate in JS. These helpers move
 * all of that into one Postgres call (the search_inventory function), so the
 * browser only ever receives one page (~50 rows) — fast regardless of host.
 * The fat _getItemsWithStockUncached above is kept for the production plan,
 * which needs the full per-item shape (it reads it uncached, see note there).
 * ------------------------------------------------------------------ */

/** Full item shape for the edit/clone form modal + the (legacy) full list. */
export interface ItemWithStock {
  id: string;
  code: string;
  name: string;
  lookup_key: string | null;
  description: string | null;
  item_type: ItemType;
  category_id: string | null;
  uom_id: string;
  minimum_stock: number;
  reorder_point: number;
  lead_time_days: number;
  cost_price: number;
  is_active: boolean;
  stock_behaviour: StockBehaviour;
  family: string | null;
  finish: string | null;
  procurement_type: "make" | "trade" | null;
  category_procurement_type: "make" | "trade" | null;
  effective_procurement_type: "make" | "trade" | null;
  suppliers: string[];
  purchase_uom_id: string | null;
  purchase_conversion: number | null;
  category: {
    id: string;
    name: string;
    parent_id?: string | null;
    procurement_type?: "make" | "trade" | null;
  } | null;
  uom: { id: string; abbreviation: string } | null;
  total_stock: number;
}

/** A Program (operation) that references an item, for the inventory list's
 *  Programs column. `role` = how the program touches the item. */
export interface InventoryProgramRef {
  id: string;
  code: string | null;
  name: string;
  machine: OperationMachine;
  /** "produces" = item is a program OUTPUT; "consumes" = a program INPUT. */
  role: "produces" | "consumes";
}

/** Lightweight row for the inventory table (one page worth). */
export interface InventoryRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  item_type: ItemType;
  category_id: string | null;
  category_name: string | null;
  uom_abbreviation: string;
  total_stock: number;
  reorder_point: number;
  cost_price: number;
  stock_behaviour: StockBehaviour;
  effective_procurement_type: "make" | "trade" | null;
  demand_source: DemandSource;
  /** True when demand_source comes from a manual marking, not the computation. */
  demand_overridden: boolean;
  /** Active Programs (operations) that produce or consume this item. Filled in
   *  by attachItemPrograms() per page; [] when none. */
  programs: InventoryProgramRef[];
}

/* Category ids (incl. descendants) that the job form's BOM sections pick from.
 * BOM_SECTIONS lives in TypeScript, so we resolve it here and hand the id set
 * to search_inventory — that's what makes an item "Jobs"-classified even if no
 * job has used it yet. Cached on the categories tag: renaming a category in
 * the DB re-resolves within 5 minutes. */
const getJobBoundCategoryIds = unstable_cache(
  async (): Promise<string[]> => {
    const paths = [
      ...new Set(BOM_SECTIONS.flatMap((s) => s.defaultItemCategories ?? [])),
    ];
    const roots = await resolveCategoryPaths(paths);
    return roots.length > 0 ? expandCategoryDescendants(roots) : [];
  },
  ["job-bound-category-ids"],
  { revalidate: 300, tags: ["categories"] },
);

export interface InventoryPageResult {
  rows: InventoryRow[];
  total: number;
}

export interface InventoryQuery {
  search?: string;
  type?: string; // ItemType | "all"
  category?: string; // parent category id | "all"
  sub?: string; // sub-category id | "all"
  stock?: string; // "low" | "zero" | "in_stock" | "all"
  behaviour?: string; // "stocked" | "phantom" | "tooling" | "all"
  procurement?: string; // "make" | "trade" | "all"
  demand?: string; // "jobs" | "formula" | "none" | "all"
  sort?: string; // code | name | stock | category | cost
  dir?: string; // asc | desc
  page?: number;
  pageSize?: number;
}

/**
 * Enrich a page of inventory rows with the active Programs (operations) that
 * reference each item — as an OUTPUT (the program produces it) or an INPUT (the
 * program consumes it). Bulk: one pair of queries scoped to the page's item ids
 * (≤ pageSize), so no N+1. Mirrors getOperationsForItem in operations.ts but
 * for many items at once. Mutates `rows` in place. Cabin programs are excluded
 * by design (cabin items live in their own /cabin-inventory section).
 */
async function attachItemPrograms(rows: InventoryRow[]): Promise<void> {
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  const supabase = createCacheClient();
  const sel = "item_id, operation:operations(id, code, name, machine, is_active)";
  const [outRes, inRes] = await Promise.all([
    supabase.from("operation_outputs").select(sel).in("item_id", ids),
    supabase.from("operation_inputs").select(sel).in("item_id", ids),
  ]);
  if (outRes.error) throw outRes.error;
  if (inRes.error) throw inRes.error;

  // item_id -> (operation_id -> ref). Dedupe by program; "produces" wins when a
  // program both produces and consumes the same item.
  const byItem = new Map<string, Map<string, InventoryProgramRef>>();
  const ingest = (
    data: Record<string, unknown>[] | null,
    role: "produces" | "consumes",
  ) => {
    for (const r of data ?? []) {
      const rawOp = (r as { operation: unknown }).operation;
      const op = (Array.isArray(rawOp) ? rawOp[0] : rawOp) as
        | {
            id: string;
            code: string | null;
            name: string;
            machine: OperationMachine;
            is_active: boolean;
          }
        | null
        | undefined;
      if (!op || op.is_active === false) continue;
      const itemId = r.item_id as string;
      let m = byItem.get(itemId);
      if (!m) {
        m = new Map();
        byItem.set(itemId, m);
      }
      const existing = m.get(op.id);
      if (existing && existing.role === "produces") continue; // keep produces
      m.set(op.id, {
        id: op.id,
        code: op.code ?? null,
        name: op.name,
        machine: op.machine,
        role,
      });
    }
  };
  ingest(outRes.data as Record<string, unknown>[] | null, "produces");
  ingest(inRes.data as Record<string, unknown>[] | null, "consumes");

  for (const row of rows) {
    const m = byItem.get(row.id);
    row.programs = m
      ? Array.from(m.values()).sort((a, b) =>
          (a.code ?? a.name).localeCompare(b.code ?? b.name),
        )
      : [];
  }
}

/**
 * One page of inventory rows + the full filtered count. Not cached: it's a
 * single fast RPC and we want it live (fresh for every user, no cross-instance
 * staleness — important for the multi-user/real-time goal).
 */
export async function getInventoryPage(
  q: InventoryQuery,
): Promise<InventoryPageResult> {
  const pageSize = q.pageSize ?? 50;
  const page = Math.max(1, q.page ?? 1);

  // Resolve the category filter to a concrete id set: a chosen sub-category is
  // exact; a chosen parent expands to all its descendants (matches the old UI).
  let categoryIds: string[] | null = null;
  if (q.sub && q.sub !== "all") categoryIds = [q.sub];
  else if (q.category && q.category !== "all") {
    categoryIds = await expandCategoryDescendants([q.category]);
  }

  const boundCategoryIds = await getJobBoundCategoryIds();

  const supabase = createCacheClient();
  const { data, error } = await supabase.rpc("search_inventory", {
    p_search: q.search?.trim() ? q.search.trim() : null,
    p_type: q.type && q.type !== "all" ? q.type : null,
    p_category_ids: categoryIds,
    p_stock: q.stock && q.stock !== "all" ? q.stock : null,
    p_behaviour: q.behaviour && q.behaviour !== "all" ? q.behaviour : null,
    p_sort: q.sort ?? "code",
    p_dir: q.dir ?? "asc",
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_procurement:
      q.procurement && q.procurement !== "all" ? q.procurement : null,
    p_demand: q.demand && q.demand !== "all" ? q.demand : null,
    p_bound_category_ids: boundCategoryIds.length > 0 ? boundCategoryIds : null,
  });
  if (error) throw error;

  const rows = (data ?? []) as Record<string, unknown>[];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const mapped: InventoryRow[] = rows.map((r) => ({
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    item_type: r.item_type as ItemType,
    category_id: (r.category_id as string | null) ?? null,
    category_name: (r.category_name as string | null) ?? null,
    uom_abbreviation: (r.uom_abbreviation as string | null) ?? "",
    total_stock: Number(r.total_stock ?? 0),
    reorder_point: Number(r.reorder_point ?? 0),
    cost_price: Number(r.cost_price ?? 0),
    stock_behaviour: (r.stock_behaviour as StockBehaviour) ?? "stocked",
    effective_procurement_type:
      (r.effective_procurement_type as "make" | "trade" | null) ?? null,
    demand_source: (r.demand_source as DemandSource) ?? "none",
    demand_overridden: Boolean(r.demand_overridden),
    programs: [],
  }));
  await attachItemPrograms(mapped);
  return { total, rows: mapped };
}

/**
 * Manually mark an item's Demand Flow Type (the inline editor on the
 * inventory list's Demand badge). `value = null` restores the automatic
 * classification. Logged to item_change_log so Daily Changes shows it
 * and one-click undo works.
 */
export async function setItemDemandOverride(
  itemId: string,
  value: DemandOverride | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();

  const { data: existing, error: exErr } = await supabase
    .from("items")
    .select("id, code, name, demand_override")
    .eq("id", itemId)
    .single();
  if (exErr || !existing) return { ok: false, error: "Item not found." };

  const oldValue = (existing.demand_override as DemandOverride | null) ?? null;
  if (oldValue === value) return { ok: true };

  const { error } = await supabase
    .from("items")
    .update({ demand_override: value })
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  await logItemChange(supabase, {
    item_id: itemId,
    item_code: existing.code as string,
    item_name: existing.name as string,
    action: "update",
    changes: [{ field: "demand_override", old: oldValue, new: value }],
    note: value
      ? "Demand flow type marked manually"
      : "Demand flow type reset to automatic",
  });

  revalidateTag("items");
  return { ok: true };
}

/** Global Make / Trade / All counts for the inventory tab bar. Whole active
 *  non-cabin universe (phantoms excluded, same as the list's default view) —
 *  intentionally NOT reactive to search/filters, mirroring the MRP tabs. */
export interface InventoryTabCounts {
  all: number;
  make: number;
  trade: number;
}
export async function getInventoryTabCounts(): Promise<InventoryTabCounts> {
  return unstable_cache(
    async () => {
      const supabase = createCacheClient();
      const run = async (proc: "make" | "trade" | null) => {
        const { data, error } = await supabase.rpc("search_inventory", {
          p_search: null,
          p_type: null,
          p_category_ids: null,
          p_stock: null,
          p_behaviour: null,
          p_sort: "code",
          p_dir: "asc",
          p_limit: 1,
          p_offset: 0,
          p_procurement: proc,
          p_demand: null,
          p_bound_category_ids: null,
        });
        if (error) throw error;
        const rows = (data ?? []) as Record<string, unknown>[];
        return rows.length > 0 ? Number(rows[0].total_count) : 0;
      };
      const [all, make, trade] = await Promise.all([
        run(null),
        run("make"),
        run("trade"),
      ]);
      return { all, make, trade };
    },
    ["inventory-tab-counts"],
    { revalidate: 300, tags: ["items", "inventory-stock"] },
  )();
}

/** Cached default first page (no filters) for an instant initial paint of
 *  /inventory. Invalidated by the "items"/"inventory-stock" tags on any item or
 *  stock mutation, and "operations" so the Programs column refreshes when a
 *  program's outputs/inputs change; live user-driven queries go through
 *  getInventoryPage. */
export async function getInventoryFirstPage(): Promise<InventoryPageResult> {
  return unstable_cache(
    () => getInventoryPage({ page: 1, pageSize: 50 }),
    ["inventory-first-page"],
    { revalidate: 300, tags: ["items", "inventory-stock", "operations"] },
  )();
}

/** Distinct (item_type, category_id) pairs — lets the category dropdowns scope
 *  by the selected type without shipping every item. Small + cached. */
export interface TypeCatFacet {
  item_type: ItemType;
  category_id: string;
}
export async function getItemTypeCategoryFacets(): Promise<TypeCatFacet[]> {
  const cached = unstable_cache(
    async () => {
      const supabase = createCacheClient();
      const { data, error } = await supabase.rpc("inventory_type_cat_facets");
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        item_type: r.item_type as ItemType,
        category_id: r.category_id as string,
      }));
    },
    ["inventory-type-cat-facets"],
    { revalidate: 300, tags: ["items", "categories"] },
  );
  return cached();
}

/** Next free code in a source item's series, for the Clone action — computed
 *  server-side (scans only codes sharing the prefix) so the client doesn't need
 *  the full code list. */
export async function suggestNextCode(
  sourceCode: string,
): Promise<string | null> {
  const parts = sourceCode.split("-");
  if (parts.length < 2) return null;
  const seqPart = parts[parts.length - 1];
  if (!/^\d+$/.test(seqPart)) return null;
  const prefix = parts.slice(0, -1).join("-") + "-";

  const supabase = createCacheClient();
  const { data, error } = await supabase
    .from("items")
    .select("code")
    .ilike("code", `${prefix}%`)
    .limit(5000);
  if (error) throw error;
  return nextCodeInSeries(
    sourceCode,
    (data ?? []).map((r) => r.code as string),
  );
}

/** Full single item for the edit/clone modal (fetched on open, since the list
 *  rows are now lightweight). Mirrors the getItemsWithStock row shape. */
export async function getItemForEdit(
  id: string,
): Promise<ItemWithStock | null> {
  if (!id) return null;
  const supabase = createCacheClient();
  const { data: item, error } = await supabase
    .from("items")
    .select(
      `*,
       category:item_categories!items_category_id_fkey(id, name, parent_id, procurement_type),
       uom:units_of_measurement!items_uom_id_fkey(id, abbreviation),
       inventory(quantity, warehouse_id)`,
    )
    .eq("id", id)
    // Active only: a stale ?edit=<id> deep-link to a since-soft-deleted item
    // returns null → the modal won't open (matches the prior list-find behaviour).
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!item) return null;

  const itemPT = (item.procurement_type as "make" | "trade" | null) ?? null;
  const cat = item.category as {
    id: string;
    name: string;
    parent_id?: string | null;
    procurement_type?: "make" | "trade" | null;
  } | null;
  const catPT = (cat?.procurement_type as "make" | "trade" | null) ?? null;
  return {
    id: item.id as string,
    code: item.code as string,
    name: item.name as string,
    lookup_key: (item.lookup_key as string | null) ?? null,
    description: (item.description as string | null) ?? null,
    item_type: item.item_type as ItemType,
    category_id: (item.category_id as string | null) ?? null,
    uom_id: item.uom_id as string,
    minimum_stock: Number(item.minimum_stock),
    reorder_point: Number(item.reorder_point),
    lead_time_days: Number(item.lead_time_days),
    cost_price: Number(item.cost_price),
    is_active: item.is_active as boolean,
    stock_behaviour: (item.stock_behaviour as StockBehaviour) ?? "stocked",
    family: (item.family as string | null) ?? null,
    finish: (item.finish as string | null) ?? null,
    procurement_type: itemPT,
    category_procurement_type: catPT,
    effective_procurement_type: (itemPT ?? catPT) as "make" | "trade" | null,
    suppliers: Array.isArray(item.suppliers) ? (item.suppliers as string[]) : [],
    purchase_uom_id: (item.purchase_uom_id as string | null) ?? null,
    purchase_conversion: item.purchase_conversion != null ? Number(item.purchase_conversion) : null,
    category: cat,
    uom: (item.uom as { id: string; abbreviation: string } | null) ?? null,
    total_stock: ((item.inventory as { quantity: number }[]) ?? []).reduce(
      (sum, inv) => sum + Number(inv.quantity),
      0,
    ),
  };
}

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
    case "temporary":
      return "TMP";
    default:
      return "ITM";
  }
}

/** Next free PREFIX-NNN code (zero-padded), scanning existing codes. */
async function nextAutoCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prefix: string,
): Promise<string> {
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  // Page past PostgREST's 1000-row cap: a big series (e.g. SIDE has 2000+) would
  // otherwise compute a stale max and generate a code that already exists (23505).
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase
      .from("items")
      .select("code")
      .ilike("code", `${prefix}-%`)
      .order("code")
      .range(off, off + 999);
    for (const r of data ?? []) {
      const m = re.exec(String((r as { code: string }).code));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    if (!data || data.length < 1000) break;
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
  /** Optional purchase unit + conversion (stock units per 1 purchase unit). */
  purchase_uom_id?: string | null;
  purchase_conversion?: number | null;
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
      purchase_uom_id: data.purchase_uom_id ?? null,
      purchase_conversion: data.purchase_conversion ?? null,
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
 * (template OR job) headers or lines, no import column mappings, and no
 * program outputs/inputs, parts-list (item_bom_lines) or cabin-job lines.
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
    // Production-visibility references (program outputs/inputs, multi-level parts
    // lists, cabin jobs). These FKs also block a hard delete, so they must force a
    // soft delete too — otherwise the delete throws an opaque FK-constraint error.
    supabase
      .from("operation_outputs")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId),
    supabase
      .from("operation_inputs")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId),
    supabase
      .from("item_bom_lines")
      .select("id", { count: "exact", head: true })
      .eq("child_item_id", itemId),
    supabase
      .from("item_bom_lines")
      .select("id", { count: "exact", head: true })
      .eq("parent_item_id", itemId),
    supabase
      .from("cabin_job_lines")
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
    /** Optional purchase unit. Pass `null` to clear. Omit to leave unchanged. */
    purchase_uom_id?: string | null;
    /** Stock units per 1 purchase unit. Pass `null` to clear. */
    purchase_conversion?: number | null;
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

  const isOutbound = ["production_out", "scrap", "dispatch_out"].includes(data.transaction_type);
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

export interface ItemLedgerRow {
  id: string;
  created_at: string;
  transaction_type: TransactionType;
  /** Signed delta this movement applied (negative for outbound). */
  signed_qty: number;
  /** Cumulative on-hand after this movement (oldest→newest accumulation). */
  running_balance: number;
  warehouse_name: string | null;
  note: string | null;
  reference_type: string | null;
  po_number: string | null;
}

export interface ItemLedger {
  item_code: string;
  item_name: string;
  uom: string | null;
  /** Movements newest-first for display. Balance was accumulated oldest-first. */
  rows: ItemLedgerRow[];
  closing: number;
}

/**
 * Full stock ledger for ONE item: every inventory_transactions row with a
 * correctly SIGNED quantity (re-derived via appliedDelta — the table stores raw
 * positive qty) and a running balance accumulated oldest→newest. Spans all
 * warehouses (the inventory list's stock total sums them; the warehouse is shown
 * per row). Uncached so it's always fresh — it's lazy-loaded only when a user
 * opens the ledger popover.
 */
export async function getItemLedger(itemId: string): Promise<ItemLedger> {
  const empty: ItemLedger = {
    item_code: "",
    item_name: "",
    uom: null,
    rows: [],
    closing: 0,
  };
  if (!itemId) return empty;
  const supabase = await createClient();

  const [itemRes, txnRes] = await Promise.all([
    supabase
      .from("items")
      .select(`code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation)`)
      .eq("id", itemId)
      .single(),
    supabase
      .from("inventory_transactions")
      .select(
        `id, created_at, transaction_type, quantity, notes, reference_type, reference_id,
         warehouse:warehouses(name)`,
      )
      .eq("item_id", itemId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (txnRes.error) throw txnRes.error;
  const txns = (txnRes.data ?? []) as Array<Record<string, unknown>>;

  // Resolve PO numbers for po_receipt movements (reference_id → receipt → PO).
  const receiptIds = [
    ...new Set(
      txns
        .filter((t) => t.reference_type === "po_receipt")
        .map((t) => t.reference_id as string | null)
        .filter((x): x is string => !!x),
    ),
  ];
  const poByReceipt = new Map<string, string | null>();
  if (receiptIds.length > 0) {
    const { data: receipts } = await supabase
      .from("purchase_order_receipts")
      .select("id, po_id")
      .in("id", receiptIds);
    const poIds = [
      ...new Set((receipts ?? []).map((r) => r.po_id as string).filter(Boolean)),
    ];
    const poNum = new Map<string, string | null>();
    if (poIds.length > 0) {
      const { data: pos } = await supabase
        .from("purchase_orders")
        .select("id, po_number")
        .in("id", poIds);
      for (const p of pos ?? [])
        poNum.set(p.id as string, (p.po_number as string | null) ?? null);
    }
    for (const r of receipts ?? [])
      poByReceipt.set(r.id as string, poNum.get(r.po_id as string) ?? null);
  }

  const flatten = <T,>(rel: unknown): T | null =>
    Array.isArray(rel) ? ((rel[0] as T) ?? null) : ((rel as T) ?? null);

  let balance = 0;
  const ascending: ItemLedgerRow[] = txns.map((t) => {
    const type = t.transaction_type as TransactionType;
    const signed = appliedDelta(type, Number(t.quantity));
    balance += signed;
    const refType = (t.reference_type as string | null) ?? null;
    return {
      id: t.id as string,
      created_at: t.created_at as string,
      transaction_type: type,
      signed_qty: signed,
      running_balance: balance,
      warehouse_name: flatten<{ name: string }>(t.warehouse)?.name ?? null,
      note: (t.notes as string | null) ?? null,
      reference_type: refType,
      po_number:
        refType === "po_receipt" && t.reference_id
          ? poByReceipt.get(t.reference_id as string) ?? null
          : null,
    };
  });

  const item = itemRes.data as { code?: string; name?: string; uom?: unknown } | null;
  return {
    item_code: item?.code ?? "",
    item_name: item?.name ?? "",
    uom: flatten<{ abbreviation: string }>(item?.uom)?.abbreviation ?? null,
    rows: ascending.slice().reverse(), // newest-first for display
    closing: balance,
  };
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

/**
 * Total on-hand stock per item across warehouses, SCOPED to the given item ids.
 * Safe to call on a detail page (small, chunked, paged) — deliberately NOT the
 * 2MB getItemsWithStock payload. Returns a plain { item_id: qty } map.
 */
export async function getStockForItems(itemIds: string[]): Promise<Record<string, number>> {
  const ids = Array.from(new Set(itemIds.filter(Boolean))).sort();
  if (ids.length === 0) return {};
  // Cached — the job-detail readiness view reads this on a hot page; the
  // inventory-stock tag (revalidated by every stock mutation) keeps it fresh.
  return unstable_cache(_getStockForItemsUncached, ["stock-for-items", ids.join(",")], {
    revalidate: 300,
    tags: ["inventory-stock"],
  })(ids);
}

async function _getStockForItemsUncached(ids: string[]): Promise<Record<string, number>> {
  const supabase = createCacheClient();
  const out: Record<string, number> = {};
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const rows = await fetchAllRanged<{ item_id: string; quantity: number }>(
      (from, to, withCount) =>
        supabase
          .from("inventory")
          .select("item_id, quantity", withCount ? { count: "exact" } : {})
          .in("item_id", slice)
          .range(from, to),
    );
    for (const r of rows) out[r.item_id] = (out[r.item_id] ?? 0) + (Number(r.quantity) || 0);
  }
  return out;
}
