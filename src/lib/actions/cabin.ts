"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import { CABIN_PARENT, cabinCodePrefix } from "@/lib/cabin/cabin-types";

const MAIN_STORE = "0ebcfb80-19e2-43e7-b15c-e6020bd5506d";

export interface CabinTypeSummary {
  id: string | null;
  name: string;
  itemCount: number;
}

const chunk = <T,>(a: T[], n: number): T[][] => {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
};

const _getCabinTypeSummaryUncached = async (): Promise<CabinTypeSummary[]> => {
  const supabase = createCacheClient();

  const { data: parent } = await supabase
    .from("item_categories")
    .select("id")
    .eq("name", CABIN_PARENT)
    .is("parent_id", null)
    .maybeSingle();
  if (!parent) return [];

  // Walk the whole category tree so a type's count includes items filed in
  // ANY of its sub-categories (e.g. Platform > ACO / AT / Collapsible / …).
  const { data: allCats } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  const cats = allCats ?? [];
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
  const allCabinCatIds = [...new Set([...typeToCatIds.values()].flat())];

  const countByCat = new Map<string, number>();
  const PAGE = 1000;
  for (const cc of chunk(allCabinCatIds, 150)) {
    // Page past PostgREST's 1000-row cap so big types (e.g. Side Panel) count fully.
    let offset = 0;
    while (true) {
      const { data: its } = await supabase
        .from("items")
        .select("category_id")
        .eq("is_active", true)
        .in("category_id", cc)
        .order("id")
        .range(offset, offset + PAGE - 1);
      for (const it of its ?? []) {
        const c = it.category_id as string | null;
        if (c) countByCat.set(c, (countByCat.get(c) ?? 0) + 1);
      }
      if (!its || its.length < PAGE) break;
      offset += PAGE;
    }
  }

  return types.map((t) => ({
    id: t.id as string,
    name: t.name as string,
    itemCount: (typeToCatIds.get(t.id as string) ?? []).reduce(
      (a, cid) => a + (countByCat.get(cid) ?? 0),
      0,
    ),
  }));
};

export async function getCabinTypeSummary(): Promise<CabinTypeSummary[]> {
  const cached = unstable_cache(
    _getCabinTypeSummaryUncached,
    ["cabin-type-summary"],
    { revalidate: 60, tags: ["categories", "items"] },
  );
  return cached();
}

export interface CabinItem {
  id: string;
  code: string;
  name: string;
  sub_category: string | null;
  uom: string;
  total_stock: number;
  stock_behaviour: string;
}

export interface CabinTypeItems {
  type: { id: string; name: string } | null;
  subCategories: { id: string; name: string }[];
  items: CabinItem[];
}

const _getCabinTypeItemsUncached = async (
  typeId: string,
): Promise<CabinTypeItems> => {
  const supabase = createCacheClient();

  const { data: type } = await supabase
    .from("item_categories")
    .select("id, name")
    .eq("id", typeId)
    .maybeSingle();
  if (!type) return { type: null, subCategories: [], items: [] };

  const { data: cats } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  const childrenOf = new Map<string, string[]>();
  for (const c of (cats ?? []) as any[]) {
    if (c.parent_id) {
      const a = childrenOf.get(c.parent_id) ?? [];
      a.push(c.id);
      childrenOf.set(c.parent_id, a);
    }
  }
  const subCategories = ((cats ?? []) as any[])
    .filter((c) => c.parent_id === typeId)
    .map((c) => ({ id: c.id as string, name: c.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // type + all descendant category ids
  const catIds: string[] = [];
  const stack = [typeId];
  while (stack.length) {
    const id = stack.pop() as string;
    catIds.push(id);
    for (const ch of childrenOf.get(id) ?? []) stack.push(ch);
  }
  const catName = new Map(
    ((cats ?? []) as any[]).map((c) => [c.id as string, c.name as string]),
  );

  // Fetch items in those categories, with stock. Page past PostgREST's 1000-row
  // cap so large types (Side Panel, Front Wall) return EVERY item, not just 1000.
  const items: CabinItem[] = [];
  const PAGE = 1000;
  for (const cc of chunk(catIds, 100)) {
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from("items")
        .select(
          `id, code, name, category_id, stock_behaviour,
           uom:units_of_measurement(abbreviation), inventory(quantity)`,
        )
        .eq("is_active", true)
        .in("category_id", cc)
        .order("name")
        .range(offset, offset + PAGE - 1);
      const batch = (data ?? []) as any[];
      for (const it of batch) {
        const uom = Array.isArray(it.uom) ? it.uom[0] : it.uom;
        const total = (it.inventory ?? []).reduce(
          (s: number, r: { quantity: number }) => s + Number(r.quantity ?? 0),
          0,
        );
        items.push({
          id: it.id as string,
          code: it.code as string,
          name: it.name as string,
          sub_category: catName.get(it.category_id as string) ?? null,
          uom: (uom?.abbreviation as string) ?? "",
          total_stock: total,
          stock_behaviour: (it.stock_behaviour as string) ?? "stocked",
        });
      }
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));

  return { type: { id: type.id, name: type.name }, subCategories, items };
};

export async function getCabinTypeItems(typeId: string): Promise<CabinTypeItems> {
  if (!typeId) return { type: null, subCategories: [], items: [] };
  const cached = unstable_cache(
    () => _getCabinTypeItemsUncached(typeId),
    ["cabin-type-items", typeId],
    { revalidate: 60, tags: ["categories", "items", "inventory-stock"] },
  );
  return cached();
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
    });
  }

  revalidateTag("items");
  revalidateTag("inventory-stock");
  revalidateTag("categories");
  revalidatePath("/cabin-inventory");
  revalidatePath(`/cabin-inventory/${input.typeId}`);
  return { ok: true, id: item.id as string, code };
}
