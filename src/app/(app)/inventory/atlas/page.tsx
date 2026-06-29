import { createCacheClient } from "@/lib/supabase/cache-client";
import AtlasClient from "./atlas-client";

export const metadata = { title: "Inventory Atlas" };

export type Proc = "make" | "trade" | null;
export type AtlasCat = {
  id: string;
  name: string;
  parent_id: string | null;
  /** Category default Make/Trade (null = inherits from parent at the app level). */
  procurement_type: Proc;
};
export type AtlasItem = {
  id: string;
  code: string;
  name: string;
  item_type: string;
  category_id: string;
  in_r1: boolean;
  /** The item's OWN Make/Trade override (null = inherit from its category). */
  procurement_type: Proc;
  /** Total on-hand stock summed across warehouses. */
  stock: number;
  /** Produced by an audited program (a component/cut_part output of one). */
  programmed: boolean;
  /** Selectable in a Packing List R1 part (category within a template part's scope). */
  bom_item: boolean;
};
export type AtlasUnit = { id: string; name: string };

async function fetchData(): Promise<{
  categories: AtlasCat[];
  items: AtlasItem[];
  units: AtlasUnit[];
  r1TouchedCats: string[];
}> {
  const sb = createCacheClient();

  // ── All categories (small) ──────────────────────────────────────────────
  const { data: cats } = await sb
    .from("item_categories")
    .select("id, name, parent_id, procurement_type");
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

  // ── What R1 references, in one paged scan over all lines ──────────────────
  // r1Set      = item ids picked on a line (specific item).
  // r1CatSet   = category ids picked on a line (the category dropdown). A line
  //              often has a category but NO specific item, so a sub-category
  //              counts as "touched" even when no item slot was filled.
  const r1Set = new Set<string>();
  const r1CatSet = new Set<string>();
  {
    const { count } = await sb
      .from("packing_r1_lines")
      .select("id", { count: "exact", head: true });
    const pages = Math.max(1, Math.ceil((count ?? 0) / 1000));
    const results = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        sb
          .from("packing_r1_lines")
          .select("item_id, category_id")
          .range(i * 1000, (i + 1) * 1000 - 1),
      ),
    );
    for (const r of results) {
      for (const row of (r.data ?? []) as { item_id: string | null; category_id: string | null }[]) {
        if (row.item_id) r1Set.add(row.item_id);
        if (row.category_id) r1CatSet.add(row.category_id);
      }
    }
  }

  // ── Stock per item (summed across warehouses; paged past the 1000 cap) ─────
  const stockByItem = new Map<string, number>();
  {
    const { count } = await sb
      .from("inventory")
      .select("item_id", { count: "exact", head: true });
    const pages = Math.max(1, Math.ceil((count ?? 0) / 1000));
    const res = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        sb.from("inventory").select("item_id, quantity").range(i * 1000, (i + 1) * 1000 - 1),
      ),
    );
    for (const r of res)
      for (const row of (r.data ?? []) as { item_id: string; quantity: number }[])
        stockByItem.set(row.item_id, (stockByItem.get(row.item_id) ?? 0) + Number(row.quantity || 0));
  }

  // ── Items produced by an AUDITED program (component/cut_part outputs) ───────
  const programmedSet = new Set<string>();
  {
    const { data: auditedOps } = await sb
      .from("operations")
      .select("id")
      .not("audited_at", "is", null);
    const auditedSet = new Set<string>((auditedOps ?? []).map((o) => o.id as string));
    if (auditedSet.size > 0) {
      const { count } = await sb
        .from("operation_outputs")
        .select("id", { count: "exact", head: true });
      const pages = Math.max(1, Math.ceil((count ?? 0) / 1000));
      const res = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          sb
            .from("operation_outputs")
            .select("item_id, role, operation_id")
            .range(i * 1000, (i + 1) * 1000 - 1),
        ),
      );
      for (const r of res)
        for (const row of (r.data ?? []) as {
          item_id: string | null;
          role: string;
          operation_id: string;
        }[])
          if (
            row.item_id &&
            (row.role === "component" || row.role === "cut_part") &&
            auditedSet.has(row.operation_id)
          )
            programmedSet.add(row.item_id);
    }
  }

  // ── "BOM Item" set: an item is selectable in a Packing List R1 part when its
  //    category sits within the subtree of some template part's category. ──────
  const bomCatSet = new Set<string>();
  {
    const { data: tmplLines } = await sb
      .from("packing_template_lines")
      .select("category_id")
      .not("category_id", "is", null);
    const childrenByParent = new Map<string, string[]>();
    for (const c of allCats)
      if (c.parent_id) {
        const a = childrenByParent.get(c.parent_id) ?? [];
        a.push(c.id);
        childrenByParent.set(c.parent_id, a);
      }
    const stack = (tmplLines ?? [])
      .map((l) => l.category_id as string)
      .filter(Boolean);
    while (stack.length) {
      const id = stack.pop()!;
      if (bomCatSet.has(id)) continue;
      bomCatSet.add(id);
      for (const ch of childrenByParent.get(id) ?? []) stack.push(ch);
    }
  }

  // ── Non-cabin active items (10 parallel pages → up to 10k) ─────────────────
  const cabinFilter = cabinIds.size > 0 ? `(${[...cabinIds].join(",")})` : null;
  const itemPages = await Promise.all(
    Array.from({ length: 10 }, (_, i) => {
      let q: any = sb
        .from("items")
        .select("id, code, name, item_type, category_id, procurement_type")
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
    .map((i: any) => ({
      ...i,
      in_r1: r1Set.has(i.id),
      stock: stockByItem.get(i.id) ?? 0,
      programmed: programmedSet.has(i.id),
      bom_item: bomCatSet.has(i.category_id),
    }));

  // ── Units (for the create-item modal) ──────────────────────────────────────
  const { data: units } = await sb
    .from("units_of_measurement")
    .select("id, name")
    .order("name");

  return { categories, items, units: units ?? [], r1TouchedCats: [...r1CatSet] };
}

export default async function InventoryAtlasPage() {
  const { categories, items, units, r1TouchedCats } = await fetchData();
  return (
    <AtlasClient
      categories={categories}
      items={items}
      units={units}
      r1TouchedCats={r1TouchedCats}
    />
  );
}
