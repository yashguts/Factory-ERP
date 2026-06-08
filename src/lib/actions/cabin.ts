"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { CABIN_PARENT } from "@/lib/cabin/cabin-types";

export interface CabinTypeSummary {
  id: string | null;
  name: string;
  itemCount: number;
}

const _getCabinTypeSummaryUncached = async (): Promise<CabinTypeSummary[]> => {
  const supabase = createCacheClient();

  const { data: parent } = await supabase
    .from("item_categories")
    .select("id")
    .eq("name", CABIN_PARENT)
    .is("parent_id", null)
    .maybeSingle();
  if (!parent) return [];

  const { data: subs } = await supabase
    .from("item_categories")
    .select("id, name")
    .eq("parent_id", parent.id);
  const subList = subs ?? [];
  const ids = subList.map((s: any) => s.id as string);

  const countByCat = new Map<string, number>();
  if (ids.length > 0) {
    const { data: items } = await supabase
      .from("items")
      .select("category_id")
      .eq("is_active", true)
      .in("category_id", ids);
    for (const it of items ?? []) {
      const c = it.category_id as string | null;
      if (c) countByCat.set(c, (countByCat.get(c) ?? 0) + 1);
    }
  }

  return subList.map((s: any) => ({
    id: s.id as string,
    name: s.name as string,
    itemCount: countByCat.get(s.id as string) ?? 0,
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
