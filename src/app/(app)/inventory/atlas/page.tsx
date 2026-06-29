import { createCacheClient } from "@/lib/supabase/cache-client";
import AtlasClient from "./atlas-client";

export const metadata = { title: "Inventory Atlas" };

export type AtlasCat = { id: string; name: string; parent_id: string | null };
export type AtlasItem = {
  id: string;
  code: string;
  name: string;
  item_type: string;
  category_id: string;
  in_r1: boolean;
};
export type AtlasUnit = { id: string; name: string };

async function fetchData(): Promise<{
  categories: AtlasCat[];
  items: AtlasItem[];
  units: AtlasUnit[];
}> {
  const sb = createCacheClient();

  // ── All categories (small) ──────────────────────────────────────────────
  const { data: cats } = await sb
    .from("item_categories")
    .select("id, name, parent_id");
  const allCats: AtlasCat[] = cats ?? [];

  // Cabin lives in its own surface — exclude its whole subtree here.
  const cabinRoot = allCats.find((c) => c.name === "Cabin" && c.parent_id === null);
  const cabinIds = new Set<string>();
  if (cabinRoot) {
    const queue = [cabinRoot.id];
    while (queue.length) {
      const id = queue.shift()!;
      cabinIds.add(id);
      allCats.filter((c) => c.parent_id === id).forEach((c) => queue.push(c.id));
    }
  }
  const categories = allCats.filter((c) => !cabinIds.has(c.id));

  // ── R1-touched item ids (paged past the 1000-row cap) ─────────────────────
  const r1Set = new Set<string>();
  {
    const { count } = await sb
      .from("packing_r1_lines")
      .select("item_id", { count: "exact", head: true })
      .not("item_id", "is", null);
    const pages = Math.max(1, Math.ceil((count ?? 0) / 1000));
    const results = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        sb
          .from("packing_r1_lines")
          .select("item_id")
          .not("item_id", "is", null)
          .range(i * 1000, (i + 1) * 1000 - 1),
      ),
    );
    results.flatMap((r) => r.data ?? []).forEach((r) => {
      if (r.item_id) r1Set.add(r.item_id);
    });
  }

  // ── Non-cabin active items (10 parallel pages → up to 10k) ─────────────────
  const cabinFilter = cabinIds.size > 0 ? `(${[...cabinIds].join(",")})` : null;
  const itemPages = await Promise.all(
    Array.from({ length: 10 }, (_, i) => {
      let q: any = sb
        .from("items")
        .select("id, code, name, item_type, category_id")
        .eq("is_active", true)
        .not("category_id", "is", null)
        .range(i * 1000, (i + 1) * 1000 - 1)
        .order("name");
      if (cabinFilter) q = q.not("category_id", "in", cabinFilter);
      return q;
    }),
  );
  const items: AtlasItem[] = itemPages
    .flatMap((p) => p.data ?? [])
    .map((i: any) => ({ ...i, in_r1: r1Set.has(i.id) }));

  // ── Units (for the create-item modal) ──────────────────────────────────────
  const { data: units } = await sb
    .from("units_of_measurement")
    .select("id, name")
    .order("name");

  return { categories, items, units: units ?? [] };
}

export default async function InventoryAtlasPage() {
  const { categories, items, units } = await fetchData();
  return <AtlasClient categories={categories} items={items} units={units} />;
}
