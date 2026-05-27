"use server";

import { createClient } from "@/lib/supabase/server";

export interface SearchableItem {
  id: string;
  code: string;
  name: string;
  category_name: string | null;
  uom_abbreviation: string;
}

/**
 * Search inventory items with multi-token fuzzy matching.
 * Each word in `query` must appear in the item name (AND logic).
 * Optionally filter by item_categories.name values.
 */
export async function searchItems(
  query: string,
  categoryNames?: string[],
  limit = 50,
): Promise<SearchableItem[]> {
  const supabase = await createClient();

  // Resolve category names to IDs if filtering
  let categoryIds: string[] | undefined;
  if (categoryNames && categoryNames.length > 0) {
    const { data: cats } = await supabase
      .from("item_categories")
      .select("id")
      .in("name", categoryNames);
    if (cats && cats.length > 0) {
      categoryIds = cats.map((c) => c.id);
    } else {
      // No matching categories — return empty
      return [];
    }
  }

  let q = supabase
    .from("items")
    .select(
      `id, code, name,
      category:item_categories!items_category_id_fkey(name),
      uom:units_of_measurement(abbreviation)`,
    )
    .eq("is_active", true);

  if (categoryIds) {
    q = q.in("category_id", categoryIds);
  }

  // Multi-token AND search on name
  if (query.trim()) {
    const tokens = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    for (const token of tokens) {
      q = q.ilike("name", `%${token}%`);
    }
  }

  q = q.order("name").limit(limit);

  const { data, error } = await q;
  if (error) throw error;

  // Flatten PostgREST joined arrays into flat objects
  return (data ?? []).map((row: any) => ({
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    category_name: Array.isArray(row.category)
      ? (row.category[0]?.name ?? null)
      : (row.category?.name ?? null),
    uom_abbreviation: Array.isArray(row.uom)
      ? (row.uom[0]?.abbreviation ?? "")
      : (row.uom?.abbreviation ?? ""),
  }));
}
