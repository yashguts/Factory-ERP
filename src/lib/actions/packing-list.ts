"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { getAllCategories } from "@/lib/actions/categories";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import { PACKING_SECTIONS } from "@/lib/packing-list/packing-list-sections";
import { OTHER_SECTION_KEY, buildCategorySectionMap } from "@/lib/packing-list/helpers";

/* ------------------------------------------------------------------ *
 * Packing lists — the comprehensive per-job shipment checklist.
 *
 * A packing list follows the factory's finished-stock register section
 * order (PACKING_SECTIONS). It is seeded once from the job's BOM (every
 * mapped BOM line dropped into the register section its item's category
 * belongs to) and then grown by hand. DOCUMENT ONLY — no inventory or
 * dispatch effect (dispatch stays the source of truth for shipments).
 * ------------------------------------------------------------------ */

export interface PackingLineView {
  id: string;
  item_id: string | null;
  code: string | null;
  /** Item name, or the free-text label when item_id is null. */
  name: string | null;
  uom: string | null;
  qty: number;
  note: string | null;
  sort_order: number;
}

export interface PackingListData {
  exists: boolean;
  listId: string | null;
  note: string | null;
  seededFromBom: boolean;
  /** section_key → its lines (sorted). Unknown keys collapse to OTHER_SECTION_KEY. */
  linesBySection: Record<string, PackingLineView[]>;
  totalLines: number;
}

/* ----------------------------- reads ----------------------------- */

const KNOWN_KEYS = new Set(PACKING_SECTIONS.map((s) => s.key));

async function _getPackingListUncached(jobId: string): Promise<PackingListData> {
  const supabase = createCacheClient();
  const { data: list } = await supabase
    .from("packing_lists")
    .select("id, note, seeded_from_bom")
    .eq("job_id", jobId)
    .maybeSingle();

  if (!list) {
    return { exists: false, listId: null, note: null, seededFromBom: false, linesBySection: {}, totalLines: 0 };
  }

  const { data: lines } = await supabase
    .from("packing_list_lines")
    .select(
      `id, section_key, item_id, label, qty, note, sort_order,
       item:items!packing_list_lines_item_id_fkey(code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation))`,
    )
    .eq("packing_list_id", list.id)
    .order("sort_order");

  const bySection: Record<string, PackingLineView[]> = {};
  for (const r of lines ?? []) {
    const row = r as any;
    const it = Array.isArray(row.item) ? row.item[0] : row.item;
    const uomRel = it ? (Array.isArray(it.uom) ? it.uom[0] : it.uom) : null;
    const key = KNOWN_KEYS.has(row.section_key) ? row.section_key : OTHER_SECTION_KEY;
    const view: PackingLineView = {
      id: row.id,
      item_id: row.item_id ?? null,
      code: it?.code ?? null,
      name: (it?.name as string) ?? (row.label as string) ?? null,
      uom: uomRel?.abbreviation ?? null,
      qty: Number(row.qty ?? 0),
      note: row.note ?? null,
      sort_order: Number(row.sort_order ?? 0),
    };
    (bySection[key] ??= []).push(view);
  }

  return {
    exists: true,
    listId: list.id as string,
    note: (list.note as string | null) ?? null,
    seededFromBom: !!list.seeded_from_bom,
    linesBySection: bySection,
    totalLines: (lines ?? []).length,
  };
}

export async function getPackingList(jobId: string): Promise<PackingListData> {
  return unstable_cache(_getPackingListUncached, ["packing-list", jobId], {
    revalidate: 600,
    tags: ["packing-lists", "bom-lines"],
  })(jobId);
}

/* ----------------------------- seed ----------------------------- */

/**
 * Ensure a packing list exists for the job; on first creation, seed it from the
 * job's BOM (each mapped line → the register section of its item's category).
 * Idempotent: if the list already exists it's a cheap no-op (no revalidate).
 * Returns the packing_list id.
 */
export async function ensurePackingList(jobId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("packing_lists")
    .select("id, seeded_from_bom")
    .eq("job_id", jobId)
    .maybeSingle();
  if (existing) return existing.id as string;

  // Create the header.
  const { data: created, error: createErr } = await supabase
    .from("packing_lists")
    .insert({ job_id: jobId, seeded_from_bom: false })
    .select("id")
    .single();
  if (createErr || !created) {
    // Another request may have created it concurrently — re-read.
    const { data: again } = await supabase
      .from("packing_lists").select("id").eq("job_id", jobId).maybeSingle();
    return (again?.id as string) ?? null;
  }
  const listId = created.id as string;

  // Seed from the job's BOM.
  const { data: header } = await supabase
    .from("job_bom_headers").select("id").eq("job_id", jobId).limit(1).maybeSingle();
  if (header) {
    const { data: bom } = await supabase
      .from("job_bom_lines")
      .select(`item_id, required_quantity, sort_order, item:items!job_bom_lines_item_id_fkey(category_id)`)
      .eq("job_bom_id", header.id)
      .not("item_id", "is", null)
      .order("sort_order");

    const cats = await getAllCategories();
    const catToSection = buildCategorySectionMap(cats);

    const rows = (bom ?? []).map((r: any, idx: number) => {
      const it = Array.isArray(r.item) ? r.item[0] : r.item;
      const catId = (it?.category_id as string | null) ?? null;
      const sectionKey = (catId && catToSection.get(catId)) || OTHER_SECTION_KEY;
      return {
        packing_list_id: listId,
        section_key: sectionKey,
        item_id: r.item_id as string,
        qty: Number(r.required_quantity ?? 0),
        sort_order: Number(r.sort_order ?? idx),
      };
    });
    if (rows.length) {
      await supabase.from("packing_list_lines").insert(rows);
    }
  }

  await supabase.from("packing_lists").update({ seeded_from_bom: true }).eq("id", listId);

  revalidateTag("packing-lists");
  revalidatePath(`/jobs/${jobId}/packing-list`);
  return listId;
}

/* ----------------------------- save ----------------------------- */

export interface PackingLineInput {
  item_id: string | null;
  label: string | null;
  qty: number;
  note: string | null;
}

export interface PackingSectionInput {
  section_key: string;
  lines: PackingLineInput[];
}

/**
 * Persist edited sections. For each provided section we delete its existing
 * lines and re-insert from the input (source-of-truth replace, same pattern as
 * saveBomSection). Sections NOT provided are left untouched. Also saves the
 * list-level note when given.
 */
export async function savePackingList(
  jobId: string,
  sections: PackingSectionInput[],
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();

  const listId = await ensurePackingList(jobId);
  if (!listId) return { ok: false, error: "Could not open the packing list." };

  if (typeof note === "string") {
    await supabase.from("packing_lists").update({ note }).eq("id", listId);
  }

  for (const sec of sections) {
    // Delete then re-insert this section's lines.
    await supabase
      .from("packing_list_lines")
      .delete()
      .eq("packing_list_id", listId)
      .eq("section_key", sec.section_key);

    const rows = sec.lines
      .filter((l) => l.item_id || (l.label && l.label.trim()))
      .map((l, idx) => ({
        packing_list_id: listId,
        section_key: sec.section_key,
        item_id: l.item_id,
        label: l.item_id ? null : (l.label?.trim() || null),
        qty: Number.isFinite(l.qty) ? l.qty : 0,
        note: l.note?.trim() || null,
        sort_order: idx,
      }));
    if (rows.length) {
      const { error } = await supabase.from("packing_list_lines").insert(rows);
      if (error) return { ok: false, error: error.message };
    }
  }

  await supabase.from("packing_lists").update({ updated_at: new Date().toISOString() }).eq("id", listId);

  revalidateTag("packing-lists");
  revalidatePath(`/jobs/${jobId}/packing-list`);
  return { ok: true };
}

/* --------------------------- item search --------------------------- */

/**
 * Fuzzy item search scoped to a register section's categories. Empty query
 * returns the section's category items (the pick list). Falls back to a global
 * search when the section has no category binding.
 */
export async function searchPackingItems(
  sectionKey: string,
  query: string,
  limit = 40,
): Promise<SearchableItem[]> {
  const sec = PACKING_SECTIONS.find((s) => s.key === sectionKey);
  const paths = sec?.categoryPaths ?? [];
  return searchItems(query, paths.length ? paths : undefined, limit);
}
