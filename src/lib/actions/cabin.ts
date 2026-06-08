"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { CABIN_PARENT } from "@/lib/cabin/cabin-types";

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
  for (const cc of chunk(allCabinCatIds, 150)) {
    const { data: its } = await supabase
      .from("items")
      .select("category_id")
      .eq("is_active", true)
      .in("category_id", cc);
    for (const it of its ?? []) {
      const c = it.category_id as string | null;
      if (c) countByCat.set(c, (countByCat.get(c) ?? 0) + 1);
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

  // Fetch items in those categories (paged), with stock.
  const items: CabinItem[] = [];
  for (const cc of chunk(catIds, 100)) {
    const { data } = await supabase
      .from("items")
      .select(
        `id, code, name, category_id, stock_behaviour,
         uom:units_of_measurement(abbreviation), inventory(quantity)`,
      )
      .eq("is_active", true)
      .in("category_id", cc)
      .order("name");
    for (const it of (data ?? []) as any[]) {
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
