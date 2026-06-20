"use server";

/**
 * Watertight Part List — persistence + the completion gate.
 *
 * The list is a comprehensive checklist: the UI renders the full PACKING_SECTIONS
 * universe and overlays these saved lines. A line is either filled (item/free) or
 * a dismissal marker; greyed template rows have no row until activated. The list
 * goes `draft → ready` only when every active line is checked, every part-group is
 * dispositioned, and every BOM line is represented (or dismissed) — enforced here
 * server-side. BOM is READ ONLY (coverage check only); writes touch part-list tables.
 */
import { createClient } from "@/lib/supabase/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import { PACKING_SECTIONS, packingSection } from "@/lib/packing-list/packing-list-sections";
import { OTHER_SECTION_KEY } from "@/lib/packing-list/helpers";
import sectionGroups from "@/lib/partlist/section-groups.json";
import type { BomCoverage, UnmappedBom } from "@/lib/partlist/types";

const GROUPS = sectionGroups as Record<string, string>;
const ALL_GROUPS = Array.from(new Set(Object.values(GROUPS))).sort(); // PART A..E

export interface SavedLine {
  id: string;
  sectionKey: string;
  item_id: string | null;
  code: string | null;
  name: string | null; // item name or free-text label
  uom: string | null;
  spec: string | null;
  qty: number;
  source: string | null;
  confidence: string | null;
  is_conflict: boolean;
  checked: boolean;
  not_required: boolean;
  non_inventory: boolean;
  bom_line_id: string | null;
  dismissed_reason: string | null;
  note: string | null;
  sort_order: number;
}

export interface PartListView {
  exists: boolean;
  listId: string | null;
  status: "draft" | "ready";
  generatedAt: string | null;
  sectionDispositions: Record<string, string>;
  linesBySection: Record<string, SavedLine[]>;
  coverage: BomCoverage;
}

export interface SaveLineInput {
  sectionKey: string;
  item_id?: string | null;
  label?: string | null;
  spec?: string | null;
  qty?: number;
  source?: string | null;
  confidence?: string | null;
  is_conflict?: boolean;
  checked?: boolean;
  not_required?: boolean;
  non_inventory?: boolean;
  bom_line_id?: string | null;
  dismissed_reason?: string | null;
  note?: string | null;
}

type SB = Awaited<ReturnType<typeof createClient>>;

/** Coverage = every job_bom_line represented by a saved line's bom_line_id (active or dismissed). */
async function computeCoverage(supabase: SB, jobId: string, linkedBomIds: Set<string>): Promise<BomCoverage> {
  const { data: header } = await supabase.from("job_bom_headers").select("id").eq("job_id", jobId).limit(1).maybeSingle();
  if (!header) return { total: 0, covered: 0, unmapped: [] };
  const { data: bom } = await supabase
    .from("job_bom_lines")
    .select(`id, category, required_quantity, item:items!job_bom_lines_item_id_fkey(code, name)`)
    .eq("job_bom_id", header.id);
  const unmapped: UnmappedBom[] = [];
  let total = 0;
  for (const r of bom ?? []) {
    total++;
    if (linkedBomIds.has(r.id as string)) continue;
    const it = Array.isArray(r.item) ? r.item[0] : r.item;
    unmapped.push({ id: r.id as string, category: (r.category as string) || "(uncategorised)", item_name: it?.name ?? null, item_code: it?.code ?? null, qty: Number(r.required_quantity ?? 0) });
  }
  return { total, covered: total - unmapped.length, unmapped };
}

export async function getPartList(jobId: string): Promise<PartListView> {
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("packing_lists")
    .select("id, status, generated_at, section_dispositions")
    .eq("job_id", jobId)
    .maybeSingle();

  if (!list) {
    const coverage = await computeCoverage(supabase, jobId, new Set());
    return { exists: false, listId: null, status: "draft", generatedAt: null, sectionDispositions: {}, linesBySection: {}, coverage };
  }

  const { data: lines } = await supabase
    .from("packing_list_lines")
    .select(
      `id, section_key, item_id, label, spec, qty, note, sort_order, source, confidence,
       is_conflict, checked, not_required, non_inventory, bom_line_id, dismissed_reason,
       item:items!packing_list_lines_item_id_fkey(code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation))`,
    )
    .eq("packing_list_id", list.id)
    .order("sort_order");

  const bySection: Record<string, SavedLine[]> = {};
  const linkedBomIds = new Set<string>();
  for (const r of lines ?? []) {
    const row = r as any;
    const it = Array.isArray(row.item) ? row.item[0] : row.item;
    const uomRel = it ? (Array.isArray(it.uom) ? it.uom[0] : it.uom) : null;
    if (row.bom_line_id) linkedBomIds.add(row.bom_line_id as string);
    (bySection[row.section_key] ??= []).push({
      id: row.id, sectionKey: row.section_key, item_id: row.item_id ?? null,
      code: it?.code ?? null, name: (it?.name as string) ?? (row.label as string) ?? null,
      uom: uomRel?.abbreviation ?? null, spec: row.spec ?? null, qty: Number(row.qty ?? 0),
      source: row.source ?? null, confidence: row.confidence ?? null, is_conflict: !!row.is_conflict,
      checked: !!row.checked, not_required: !!row.not_required, non_inventory: !!row.non_inventory, bom_line_id: row.bom_line_id ?? null,
      dismissed_reason: row.dismissed_reason ?? null, note: row.note ?? null, sort_order: Number(row.sort_order ?? 0),
    });
  }

  const coverage = await computeCoverage(supabase, jobId, linkedBomIds);
  return {
    exists: true, listId: list.id as string, status: (list.status as "draft" | "ready") ?? "draft",
    generatedAt: (list.generated_at as string | null) ?? null,
    sectionDispositions: (list.section_dispositions as Record<string, string>) ?? {},
    linesBySection: bySection, coverage,
  };
}

async function ensureList(supabase: SB, jobId: string): Promise<string> {
  const { data: existing } = await supabase.from("packing_lists").select("id").eq("job_id", jobId).maybeSingle();
  if (existing) return existing.id as string;
  const { data: created, error } = await supabase.from("packing_lists").insert({ job_id: jobId, seeded_from_bom: false }).select("id").single();
  if (error || !created) {
    const { data: again } = await supabase.from("packing_lists").select("id").eq("job_id", jobId).maybeSingle();
    if (again) return again.id as string;
    throw error ?? new Error("Could not create packing list");
  }
  return created.id as string;
}

/** Replace-from-scratch save of all lines + provenance + dispositions. Sets status back to draft. */
export async function savePartList(
  jobId: string,
  input: { lines: SaveLineInput[]; sectionDispositions?: Record<string, string>; generatedSource?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const listId = await ensureList(supabase, jobId);

    await supabase.from("packing_list_lines").delete().eq("packing_list_id", listId);

    const rows = input.lines
      .filter((l) => l.item_id || (l.label && l.label.trim()) || l.bom_line_id || l.not_required || l.non_inventory)
      .map((l, i) => ({
        packing_list_id: listId,
        section_key: l.sectionKey,
        item_id: l.item_id ?? null,
        label: l.item_id ? null : (l.label ?? null),
        spec: l.spec ?? null,
        qty: Number(l.qty ?? 0),
        note: l.note ?? null,
        source: l.source ?? null,
        confidence: l.confidence ?? null,
        is_conflict: !!l.is_conflict,
        checked: !!l.checked,
        checked_at: l.checked ? new Date().toISOString() : null,
        not_required: !!l.not_required, non_inventory: !!l.non_inventory,
        bom_line_id: l.bom_line_id ?? null,
        dismissed_reason: l.dismissed_reason ?? null,
        sort_order: i,
      }));

    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase.from("packing_list_lines").insert(rows.slice(i, i + BATCH));
      if (error) return { ok: false, error: error.message };
    }

    await supabase
      .from("packing_lists")
      .update({
        status: "draft",
        section_dispositions: input.sectionDispositions ?? {},
        generated_at: new Date().toISOString(),
        generated_source: input.generatedSource ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", listId);

    revalidateTag("packing-lists");
    revalidatePath(`/jobs/${jobId}/packing-list`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

export interface ReadyResult {
  ok: boolean;
  error?: string;
  blockers?: { uncheckedActive: number; uncoveredBom: number; undispositionedGroups: string[]; needsItem: number };
}

/** An item-type line that still has no inventory item linked. Exempt: free-text
 *  fastener lines, and lines the engineer marked "non-stock" (genuinely not an
 *  inventory item, e.g. a cut-from-sheet fish plate). */
function isUnlinkedItem(sectionKey: string, item_id: string | null, not_required: boolean, non_inventory: boolean): boolean {
  if (not_required || item_id || non_inventory) return false;
  const captureType = sectionKey === OTHER_SECTION_KEY ? "item" : (packingSection(sectionKey)?.captureType ?? "item");
  return captureType !== "free";
}

/** The completion gate (server-enforced): all active lines checked + all groups
 *  dispositioned + every BOM line represented/dismissed + every item line LINKED
 *  to an inventory item (free-text fastener lines exempt). */
export async function markPartListReady(jobId: string, operator?: string): Promise<ReadyResult> {
  const supabase = await createClient();
  const view = await getPartList(jobId);
  if (!view.exists || !view.listId) return { ok: false, error: "Nothing saved yet — generate and save first." };

  const all = Object.values(view.linesBySection).flat();
  const uncheckedActive = all.filter((l) => !l.not_required && !l.checked && (l.item_id || (l.name && l.name.trim()))).length;
  const uncoveredBom = view.coverage.unmapped.length;
  const undispositionedGroups = ALL_GROUPS.filter((g) => !view.sectionDispositions[g]);
  const needsItem = all.filter((l) => isUnlinkedItem(l.sectionKey, l.item_id, l.not_required, l.non_inventory)).length;

  if (uncheckedActive > 0 || uncoveredBom > 0 || undispositionedGroups.length > 0 || needsItem > 0) {
    return {
      ok: false,
      error: "Part List isn't fully confirmed yet.",
      blockers: { uncheckedActive, uncoveredBom, undispositionedGroups, needsItem },
    };
  }

  await supabase
    .from("packing_lists")
    .update({ status: "ready", ready_at: new Date().toISOString(), ready_by: operator ?? null })
    .eq("id", view.listId);
  revalidateTag("packing-lists");
  revalidatePath(`/jobs/${jobId}/packing-list`);
  return { ok: true };
}

/** Re-open a ready list for edits. */
export async function reopenPartList(jobId: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  await supabase.from("packing_lists").update({ status: "draft" }).eq("job_id", jobId);
  revalidateTag("packing-lists");
  revalidatePath(`/jobs/${jobId}/packing-list`);
  return { ok: true };
}

/** Save ONE section group's lines without touching the rest (delete+reinsert only
 *  the given section_keys). Optionally record that group's disposition. */
export async function savePartListSection(
  jobId: string,
  sectionKeys: string[],
  lines: SaveLineInput[],
  disposition?: { group: string; value: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const listId = await ensureList(supabase, jobId);
    const keySet = new Set(sectionKeys);

    await supabase.from("packing_list_lines").delete().eq("packing_list_id", listId).in("section_key", sectionKeys);

    const rows = lines
      .filter((l) => keySet.has(l.sectionKey) && (l.item_id || (l.label && l.label.trim()) || l.bom_line_id || l.not_required || l.non_inventory))
      .map((l, i) => ({
        packing_list_id: listId, section_key: l.sectionKey, item_id: l.item_id ?? null,
        label: l.item_id ? null : (l.label ?? null), spec: l.spec ?? null, qty: Number(l.qty ?? 0),
        note: l.note ?? null, source: l.source ?? null, confidence: l.confidence ?? null,
        is_conflict: !!l.is_conflict, checked: !!l.checked, checked_at: l.checked ? new Date().toISOString() : null,
        not_required: !!l.not_required, non_inventory: !!l.non_inventory, bom_line_id: l.bom_line_id ?? null, dismissed_reason: l.dismissed_reason ?? null, sort_order: i,
      }));
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase.from("packing_list_lines").insert(rows.slice(i, i + BATCH));
      if (error) return { ok: false, error: error.message };
    }

    const { data: cur } = await supabase.from("packing_lists").select("section_dispositions").eq("id", listId).maybeSingle();
    const dispositions = { ...((cur?.section_dispositions as Record<string, string>) ?? {}) };
    if (disposition) dispositions[disposition.group] = disposition.value;
    await supabase.from("packing_lists").update({ status: "draft", section_dispositions: dispositions, updated_at: new Date().toISOString() }).eq("id", listId);

    revalidateTag("packing-lists");
    revalidatePath(`/jobs/${jobId}/packing-list`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

/** A new drawing means the spec likely changed: wipe the cached extractions AND
 *  the existing Part List for this job so it's rebuilt clean from the new drawing. */
export async function resetPartListForNewDrawing(jobId: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  await supabase.from("packing_lists").delete().eq("job_id", jobId); // cascade deletes lines
  await supabase.from("job_drawing_extractions").delete().eq("job_id", jobId);
  revalidateTag("packing-lists");
  revalidatePath(`/jobs/${jobId}/packing-list`);
  return { ok: true };
}

/** Category-scoped inventory search for a section's item picker. */
export async function searchPartItems(sectionKey: string, query: string, limit = 40): Promise<SearchableItem[]> {
  const sec = PACKING_SECTIONS.find((s) => s.key === sectionKey);
  const paths = sec?.categoryPaths ?? [];
  return searchItems(query, paths.length ? paths : undefined, limit);
}
