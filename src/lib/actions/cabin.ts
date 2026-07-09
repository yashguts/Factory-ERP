"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import { CABIN_PARENT, cabinCodePrefix } from "@/lib/cabin/cabin-types";
import { currentOperatorName } from "@/lib/actions/inventory";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";

/** Resolve a sub-type under a cabin type to its category id (creating it if new),
 *  else the type itself. Shared by createCabinItem + createCabinPanelVariants. */
async function resolveCabinCategory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  typeId: string,
  subCategory?: string | null,
): Promise<{ ok: true; categoryId: string } | { ok: false; error: string }> {
  let categoryId = typeId;
  const sub = (subCategory ?? "").trim();
  if (sub) {
    const { data: existing } = await supabase
      .from("item_categories")
      .select("id")
      .eq("parent_id", typeId)
      .ilike("name", sub)
      .limit(1)
      .maybeSingle();
    if (existing) categoryId = existing.id as string;
    else {
      const { data: created, error } = await supabase
        .from("item_categories")
        .insert({ name: sub, parent_id: typeId, procurement_type: "make" })
        .select("id")
        .single();
      if (error) return { ok: false, error: error.message };
      categoryId = created.id as string;
    }
  }
  return { ok: true, categoryId };
}

/** Highest existing numeric suffix for a code prefix (paged past the 1000-row cap). */
async function maxCabinCodeNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prefix: string,
): Promise<number> {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  for (let off = 0; ; off += 1000) {
    const { data: codes } = await supabase
      .from("items")
      .select("code")
      .ilike("code", `${prefix}-%`)
      .order("code")
      .range(off, off + 999);
    for (const r of codes ?? []) {
      const m = re.exec(String((r as any).code));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    if (!codes || codes.length < 1000) break;
  }
  return max;
}

const MAIN_STORE = "0ebcfb80-19e2-43e7-b15c-e6020bd5506d";

export interface CabinTypeSummary {
  id: string | null;
  name: string;
  itemCount: number;
}

const _getCabinTypeSummaryUncached = async (): Promise<CabinTypeSummary[]> => {
  const supabase = createCacheClient();

  // Walk the whole category tree so a type's count includes items filed in
  // ANY of its sub-categories (e.g. Platform > ACO / AT / Collapsible / …).
  // Paged so the Cabin parent row stays in this read even past 1,000
  // categories — that's what lets us skip a separate parent lookup round-trip.
  const cats = await fetchAllRanged<{ id: string; name: string; parent_id: string | null }>(
    (from, to, withCount) =>
      supabase
        .from("item_categories")
        .select("id, name, parent_id", withCount ? { count: "exact" } : {})
        .order("id")
        .range(from, to),
  ).catch(() => [] as { id: string; name: string; parent_id: string | null }[]);
  const parent = (cats as any[]).find(
    (c) => c.name === CABIN_PARENT && c.parent_id === null,
  );
  if (!parent) return [];
  const childrenOf = new Map<string, string[]>();
  for (const c of cats as any[]) {
    if (c.parent_id) {
      const arr = childrenOf.get(c.parent_id) ?? [];
      arr.push(c.id);
      childrenOf.set(c.parent_id, arr);
    }
  }
  const descendants = (rootId: string): string[] => {
    const out: string[] = [];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop() as string;
      out.push(id);
      for (const ch of childrenOf.get(id) ?? []) stack.push(ch);
    }
    return out;
  };

  const types = (cats as any[]).filter((c) => c.parent_id === parent.id);
  const typeToCatIds = new Map<string, string[]>(
    types.map((t) => [t.id as string, descendants(t.id as string)]),
  );
  // One COUNT-ONLY query per type (parallel, head:true → zero rows shipped).
  // The old approach fetched every item row (Side Panel 2000+, Front Wall
  // 3900+) page by sequential page just to count them — thousands of rows and
  // many round-trips for 11 numbers.
  const counts = await Promise.all(
    types.map(async (t) => {
      const ids = typeToCatIds.get(t.id as string) ?? [];
      if (ids.length === 0) return 0;
      const { count, error } = await supabase
        .from("items")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .in("category_id", ids);
      if (error) throw error;
      return count ?? 0;
    }),
  );

  return types.map((t, i) => ({
    id: t.id as string,
    name: t.name as string,
    itemCount: counts[i],
  }));
};

export async function getCabinTypeSummary(): Promise<CabinTypeSummary[]> {
  const cached = unstable_cache(
    _getCabinTypeSummaryUncached,
    ["cabin-type-summary"],
    { revalidate: 600, tags: ["categories", "items"] },
  );
  return cached();
}

/* ------------------------------------------------------------------ *
 * Server-side pagination for a single cabin type's items.
 *
 * A cabin type page (e.g. Front Wall ~3,900 items) used to ship EVERY item in
 * the type to the browser and filter/search/paginate in JS. These helpers move
 * filter + multi-token search + sort + paginate (and the header aggregates)
 * into one Postgres call (search_cabin_type), so the browser only ever receives
 * one page (~100 rows). Behaviour matches the old client exactly: items scope =
 * the type category + all descendants; the sub-type filter and the search both
 * key off the item's direct sub-category NAME.
 * ------------------------------------------------------------------ */

/** A cabin type's identity + its sub-type dropdown options. Light, cached. */
export interface CabinTypeMeta {
  type: { id: string; name: string } | null;
  subCategories: { id: string; name: string }[];
}

const _getCabinTypeMetaUncached = async (
  typeId: string,
): Promise<CabinTypeMeta> => {
  const supabase = createCacheClient();

  // Both reads key only off typeId — independent, one concurrent round-trip.
  const [{ data: type }, { data: subs }] = await Promise.all([
    supabase
      .from("item_categories")
      .select("id, name")
      .eq("id", typeId)
      .maybeSingle(),
    // Direct children only — matches the old dropdown (sub-types are one level
    // under the type), sorted by name.
    supabase
      .from("item_categories")
      .select("id, name")
      .eq("parent_id", typeId)
      .order("name"),
  ]);
  if (!type) return { type: null, subCategories: [] };
  const subCategories = ((subs ?? []) as any[])
    .map((c) => ({ id: c.id as string, name: c.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { type: { id: type.id as string, name: type.name as string }, subCategories };
};

export async function getCabinTypeMeta(typeId: string): Promise<CabinTypeMeta> {
  if (!typeId) return { type: null, subCategories: [] };
  const cached = unstable_cache(
    () => _getCabinTypeMetaUncached(typeId),
    ["cabin-type-meta", typeId],
    { revalidate: 600, tags: ["categories"] },
  );
  return cached();
}

/** Lightweight row for the cabin type table (one page worth). */
export interface CabinTypeRow {
  id: string;
  code: string;
  name: string;
  sub_category: string | null;
  uom: string;
  total_stock: number;
  stock_behaviour: string;
}

export interface CabinTypePageResult {
  rows: CabinTypeRow[];
  /** Rows matching the current filters/search (across all pages). */
  total: number;
  /** Rows matching the filters that have stock > 0 (for the header "in stock"). */
  inStock: number;
  /** Total items in the type, ignoring filters (for the header "of Y items"). */
  typeTotal: number;
}

export interface CabinTypeQuery {
  typeId: string;
  search?: string;
  sub?: string; // sub-category NAME | "all"
  sort?: string; // code | name | stock
  dir?: string; // asc | desc
  page?: number;
  pageSize?: number;
}

/**
 * One page of a cabin type's items + the filtered count, in-stock count and the
 * type's unfiltered total. Not cached: a single fast RPC we want live (fresh per
 * user, matching the /inventory pattern).
 */
export async function getCabinTypePage(
  q: CabinTypeQuery,
): Promise<CabinTypePageResult> {
  if (!q.typeId) return { rows: [], total: 0, inStock: 0, typeTotal: 0 };
  const pageSize = q.pageSize ?? 100;
  const page = Math.max(1, q.page ?? 1);

  const supabase = createCacheClient();
  const { data, error } = await supabase.rpc("search_cabin_type", {
    p_type_category_id: q.typeId,
    p_search: q.search?.trim() ? q.search.trim() : null,
    p_sub: q.sub && q.sub !== "all" ? q.sub : null,
    p_sort: q.sort ?? "name",
    p_dir: q.dir ?? "asc",
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) throw error;

  const rows = (data ?? []) as Record<string, unknown>[];
  // total_count / in_stock_count / type_total ride on every row (window/scalar
  // aggregates). On an empty page they're absent, so default them — but
  // type_total still needs to be known, so the caller snaps to page 1 on empty.
  const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
  const inStock = rows.length > 0 ? Number(rows[0].in_stock_count ?? 0) : 0;
  const typeTotal = rows.length > 0 ? Number(rows[0].type_total ?? 0) : 0;
  return {
    total,
    inStock,
    typeTotal,
    rows: rows.map((r) => ({
      id: r.id as string,
      code: r.code as string,
      name: r.name as string,
      sub_category: (r.sub_category_name as string | null) ?? null,
      uom: (r.uom_abbreviation as string | null) ?? "",
      total_stock: Number(r.total_stock ?? 0),
      stock_behaviour: (r.stock_behaviour as string | null) ?? "stocked",
    })),
  };
}

/** Cached default first page (no filters) for an instant initial paint of a
 *  cabin type page. Invalidated by the items/inventory-stock tags. Live
 *  user-driven queries go through getCabinTypePage. */
export async function getCabinTypeFirstPage(
  typeId: string,
): Promise<CabinTypePageResult> {
  if (!typeId) return { rows: [], total: 0, inStock: 0, typeTotal: 0 };
  return unstable_cache(
    () => getCabinTypePage({ typeId, page: 1, pageSize: 100 }),
    ["cabin-type-first-page", typeId],
    { revalidate: 300, tags: ["items", "inventory-stock"] },
  )();
}

/* ------------------------------------------------------------------ *
 * Excel export — every active cabin item, with its type + sub-type.
 * Fetched on demand (button click), so deliberately NOT cached: the full
 * set is ~10k rows and would blow the 2MB unstable_cache entry cap.
 * ------------------------------------------------------------------ */

export interface CabinExportRow {
  type: string;
  sub_category: string | null;
  code: string;
  name: string;
  finish: string | null;
  uom: string;
  stock: number;
}

/** All active cabin items for export — whole Cabin subtree, or one type. */
export async function getCabinExportRows(
  typeId?: string | null,
): Promise<CabinExportRow[]> {
  const supabase = createCacheClient();

  const cats = await fetchAllRanged<{ id: string; name: string; parent_id: string | null }>(
    (from, to, withCount) =>
      supabase
        .from("item_categories")
        .select("id, name, parent_id", withCount ? { count: "exact" } : {})
        .order("id")
        .range(from, to),
  );
  const parent = cats.find((c) => c.name === CABIN_PARENT && c.parent_id === null);
  if (!parent) return [];
  const childrenOf = new Map<string, string[]>();
  for (const c of cats) {
    if (c.parent_id) {
      const arr = childrenOf.get(c.parent_id) ?? [];
      arr.push(c.id);
      childrenOf.set(c.parent_id, arr);
    }
  }
  const nameById = new Map(cats.map((c) => [c.id, c.name]));

  // Every category in scope → its type name + its own name (the sub-type).
  const types = cats.filter(
    (c) => c.parent_id === parent.id && (!typeId || c.id === typeId),
  );
  const catInfo = new Map<string, { type: string; cat: string }>();
  for (const t of types) {
    const stack = [t.id];
    while (stack.length) {
      const id = stack.pop() as string;
      catInfo.set(id, { type: t.name, cat: nameById.get(id) ?? "" });
      for (const ch of childrenOf.get(id) ?? []) stack.push(ch);
    }
  }
  if (catInfo.size === 0) return [];
  const catIds = [...catInfo.keys()];

  const items = await fetchAllRanged<any>((from, to, withCount) =>
    supabase
      .from("items")
      .select(
        "id, code, name, finish, category_id, uom:units_of_measurement!items_uom_id_fkey(abbreviation), inventory(quantity)",
        withCount ? { count: "exact" } : {},
      )
      .eq("is_active", true)
      .in("category_id", catIds)
      .order("id")
      .range(from, to),
  );

  const rows: CabinExportRow[] = items.map((it: any) => {
    const info = catInfo.get(it.category_id as string);
    const uomRel = Array.isArray(it.uom) ? it.uom[0] : it.uom;
    const type = info?.type ?? "";
    return {
      type,
      // The type category itself isn't a sub-type — blank there.
      sub_category: info && info.cat !== type ? info.cat : null,
      code: it.code as string,
      name: it.name as string,
      finish: (it.finish as string | null) ?? null,
      uom: (uomRel?.abbreviation as string) ?? "",
      stock: Array.isArray(it.inventory)
        ? it.inventory.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0)
        : 0,
    };
  });
  rows.sort(
    (a, b) =>
      a.type.localeCompare(b.type) ||
      (a.sub_category ?? "").localeCompare(b.sub_category ?? "") ||
      a.name.localeCompare(b.name),
  );
  return rows;
}

export type CabinItemCreateResult =
  | { ok: true; id: string; code: string }
  | { ok: false; error: string };

/** Add a new cabin inventory item under a cabin type (+ optional sub-type). */
export async function createCabinItem(input: {
  typeId: string;
  subCategory?: string | null;
  name: string;
  openingStock?: number;
}): Promise<CabinItemCreateResult> {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Item name is required." };
  if (!input.typeId) return { ok: false, error: "Missing cabin type." };

  const supabase = await createClient();

  // Target category: a sub-type under the cabin type, or the type itself.
  let categoryId = input.typeId;
  const sub = (input.subCategory ?? "").trim();
  if (sub) {
    const { data: existing } = await supabase
      .from("item_categories")
      .select("id")
      .eq("parent_id", input.typeId)
      .ilike("name", sub)
      .limit(1)
      .maybeSingle();
    if (existing) categoryId = existing.id as string;
    else {
      const { data: created, error } = await supabase
        .from("item_categories")
        .insert({ name: sub, parent_id: input.typeId, procurement_type: "make" })
        .select("id")
        .single();
      if (error) return { ok: false, error: error.message };
      categoryId = created.id as string;
    }
  }

  const { data: uoms } = await supabase
    .from("units_of_measurement")
    .select("id, abbreviation");
  const nos =
    (uoms ?? []).find(
      (u: any) => String(u.abbreviation).toLowerCase() === "nos",
    ) ?? (uoms ?? [])[0];
  if (!nos) return { ok: false, error: "No unit of measurement configured." };

  const { data: typeCat } = await supabase
    .from("item_categories")
    .select("name")
    .eq("id", input.typeId)
    .maybeSingle();
  const prefix = cabinCodePrefix(typeCat?.name as string | undefined);
  // Page past PostgREST's 1000-row cap — big cabin types (Side Panel 2000+,
  // Front Wall 3900+) would otherwise yield a stale max and a colliding code,
  // which surfaces (misleadingly) as "An item named ... already exists".
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  for (let off = 0; ; off += 1000) {
    const { data: codes } = await supabase
      .from("items")
      .select("code")
      .ilike("code", `${prefix}-%`)
      .order("code")
      .range(off, off + 999);
    for (const r of codes ?? []) {
      const m = re.exec(String((r as any).code));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    if (!codes || codes.length < 1000) break;
  }
  const code = `${prefix}-${String(max + 1).padStart(3, "0")}`;

  const { data: item, error: ie } = await supabase
    .from("items")
    .insert({
      code,
      name,
      lookup_key: name,
      item_type: "mechanical_finished_stock",
      stock_behaviour: "stocked",
      procurement_type: "make",
      uom_id: nos.id,
      category_id: categoryId,
      is_active: true,
    })
    .select("id")
    .single();
  if (ie) {
    const msg =
      (ie as any).code === "23505"
        ? `An item named "${name}" already exists.`
        : ie.message;
    return { ok: false, error: msg };
  }

  const qty = Number(input.openingStock) || 0;
  if (qty !== 0) {
    await supabase
      .from("inventory")
      .upsert(
        { item_id: item.id, warehouse_id: MAIN_STORE, quantity: qty },
        { onConflict: "item_id,warehouse_id" },
      );
    await supabase.from("inventory_transactions").insert({
      item_id: item.id,
      warehouse_id: MAIN_STORE,
      transaction_type: "adjustment",
      quantity: qty,
      notes: "Opening stock (cabin add item)",
      reference_type: "import",
      created_by_name: await currentOperatorName(),
    });
  }

  revalidateTag("items");
  revalidateTag("inventory-stock");
  revalidateTag("categories");
  revalidatePath("/cabin-inventory");
  revalidatePath(`/cabin-inventory/${input.typeId}`);
  return { ok: true, id: item.id as string, code };
}

export type CabinPanelVariantsResult =
  | { ok: true; created: string[]; skipped: string[] }
  | { ok: false; error: string };

/**
 * Blow up a base panel name into one item per finish ("{base} {finish}"),
 * matching the existing finish-fanned families (family = base, finish set, Make /
 * stocked / nos, 0 stock, auto-codes). Idempotent: any "{base} {finish}" that
 * already exists is skipped, so re-running only fills in the missing finishes.
 */
export async function createCabinPanelVariants(input: {
  typeId: string;
  subCategory?: string | null;
  baseName: string;
  finishes: string[];
}): Promise<CabinPanelVariantsResult> {
  const baseName = (input.baseName ?? "").trim();
  if (!baseName) return { ok: false, error: "Base panel name is required." };
  if (!input.typeId) return { ok: false, error: "Missing cabin type." };
  const finishes = [...new Set((input.finishes ?? []).map((f) => f.trim()).filter(Boolean))];
  if (finishes.length === 0) return { ok: false, error: "Pick at least one finish." };

  const supabase = await createClient();

  const cat = await resolveCabinCategory(supabase, input.typeId, input.subCategory);
  if (!cat.ok) return cat;

  const { data: uoms } = await supabase.from("units_of_measurement").select("id, abbreviation");
  const nos =
    (uoms ?? []).find((u: any) => String(u.abbreviation).toLowerCase() === "nos") ?? (uoms ?? [])[0];
  if (!nos) return { ok: false, error: "No unit of measurement configured." };

  const { data: typeCat } = await supabase
    .from("item_categories")
    .select("name")
    .eq("id", input.typeId)
    .maybeSingle();
  const prefix = cabinCodePrefix(typeCat?.name as string | undefined);

  // Existing "{base} {finish}" names (case-insensitive) → skip, so re-running
  // only adds the finishes that aren't there yet.
  const { data: existingRows } = await supabase
    .from("items")
    .select("name")
    .ilike("name", `${baseName} %`);
  const existing = new Set((existingRows ?? []).map((r: any) => String(r.name).trim().toLowerCase()));

  const candidates = finishes.map((finish) => ({ finish, name: `${baseName} ${finish}` }));
  const toCreate = candidates.filter((c) => !existing.has(c.name.toLowerCase()));
  const skipped = candidates.filter((c) => existing.has(c.name.toLowerCase())).map((c) => c.finish);
  if (toCreate.length === 0) return { ok: true, created: [], skipped };

  let n = await maxCabinCodeNumber(supabase, prefix);
  const rows = toCreate.map((c) => ({
    code: `${prefix}-${String(++n).padStart(3, "0")}`,
    name: c.name,
    lookup_key: c.name,
    item_type: "mechanical_finished_stock",
    stock_behaviour: "stocked",
    procurement_type: "make",
    uom_id: nos.id,
    category_id: cat.categoryId,
    family: baseName,
    finish: c.finish,
    is_active: true,
  }));

  const { error } = await supabase.from("items").insert(rows);
  if (error) {
    const msg = (error as any).code === "23505" ? "Some of these item names already exist." : error.message;
    return { ok: false, error: msg };
  }

  revalidateTag("items");
  revalidateTag("inventory-stock");
  revalidateTag("categories");
  revalidatePath("/cabin-inventory");
  revalidatePath(`/cabin-inventory/${input.typeId}`);
  return { ok: true, created: rows.map((r) => r.code), skipped };
}
