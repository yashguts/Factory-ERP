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
