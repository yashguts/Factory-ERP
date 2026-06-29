"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { getAllCategories, expandCategoryDescendants } from "@/lib/actions/categories";
import { _getOutstandingByItemUncached } from "@/lib/actions/po-outstanding";
import { CABIN_TYPES } from "@/lib/cabin/cabin-types";
import type { PackingLineKind } from "@/lib/supabase/types";

/* ------------------------------------------------------------------ *
 * Packing List R1 — server actions.
 *
 * A NEW, parallel packing-list module (migration 050). A shared, editable
 * TEMPLATE (parts, each with category/item/hardware/free lines) seeds every
 * per-job list. A job list is filled both automatically (from its BOM) and by
 * hand, then rolls up to a per-job demand list (required vs stock, make/trade).
 * The existing per-job packing_lists module is untouched.
 * ------------------------------------------------------------------ */

// ---- View models -----------------------------------------------------------
export interface R1TemplateLine {
  id: string;
  kind: PackingLineKind;
  category_id: string | null;
  category_name: string | null;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  label: string | null;
  spec_hint: string | null;
  sort_order: number;
}
export interface R1TemplatePart {
  id: string;
  title: string;
  sort_order: number;
  lines: R1TemplateLine[];
}

export interface R1Line {
  id: string;
  part_title: string;
  template_line_id: string | null;
  kind: PackingLineKind;
  category_id: string | null;
  category_name: string | null;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  uom: string | null;
  label: string | null;
  spec: string | null;
  qty: number;
  source: string | null;
  /** Derived sub-group within the part (parent category name / Hardware / …). */
  group: string | null;
  sort_order: number;
}
export interface R1ListPart {
  title: string;
  lines: R1Line[];
}
export interface R1ListView {
  listId: string;
  jobId: string;
  jobNumber: string | null;
  status: "draft" | "final";
  parts: R1ListPart[];
}

export interface R1DemandRow {
  item_id: string;
  code: string;
  name: string;
  uom: string | null;
  procurement_type: "make" | "trade" | null;
  required: number;
  on_hand: number;
  on_order: number;
  shortfall: number;
  to_buy: number;
}
export interface R1Demand {
  make: R1DemandRow[];
  trade: R1DemandRow[];
  unclassified: R1DemandRow[];
  totals: { items: number; shortfallItems: number; toBuyItems: number };
}

// ---- Small helpers ---------------------------------------------------------
function relOne<T>(rel: unknown): T | null {
  // PostgREST returns a belongsTo relation as {...} or [{...}].
  if (rel == null) return null;
  return ((Array.isArray(rel) ? rel[0] : rel) ?? null) as T | null;
}

// ============================================================================
// LANDING — existing job lists
// ============================================================================
export interface R1ListSummary {
  jobId: string;
  jobNumber: string | null;
  customerName: string | null;
  status: "draft" | "final";
  lineCount: number;
  updatedAt: string;
}
export async function getR1Lists(): Promise<R1ListSummary[]> {
  const supabase = createCacheClient();
  const { data, error } = await supabase
    .from("packing_r1_lists")
    .select(
      `id, job_id, status, updated_at,
       job:jobs!packing_r1_lists_job_id_fkey(job_number, customer_name),
       lines:packing_r1_lines!packing_r1_lines_list_id_fkey(count)`,
    )
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const job = relOne<{ job_number: string; customer_name: string | null }>(r.job);
    const cnt = Array.isArray(r.lines) ? ((r.lines[0] as { count?: number })?.count ?? 0) : 0;
    return {
      jobId: r.job_id as string,
      jobNumber: job?.job_number ?? null,
      customerName: job?.customer_name ?? null,
      status: (r.status as "draft" | "final") ?? "draft",
      lineCount: Number(cnt) || 0,
      updatedAt: r.updated_at as string,
    };
  });
}

// ============================================================================
// TEMPLATE
// ============================================================================
export async function getTemplate(): Promise<R1TemplatePart[]> {
  const supabase = createCacheClient();
  const { data: parts, error: pe } = await supabase
    .from("packing_template_parts")
    .select("id, title, sort_order")
    .order("sort_order");
  if (pe) throw pe;
  const { data: lines, error: le } = await supabase
    .from("packing_template_lines")
    .select(
      `id, part_id, kind, category_id, item_id, label, spec_hint, sort_order,
       category:item_categories!packing_template_lines_category_id_fkey(name),
       item:items!packing_template_lines_item_id_fkey(code, name)`,
    )
    .order("sort_order");
  if (le) throw le;

  const byPart = new Map<string, R1TemplateLine[]>();
  for (const l of lines ?? []) {
    const cat = relOne<{ name: string }>(l.category);
    const it = relOne<{ code: string; name: string }>(l.item);
    const arr = byPart.get(l.part_id as string) ?? [];
    arr.push({
      id: l.id as string,
      kind: l.kind as PackingLineKind,
      category_id: (l.category_id as string | null) ?? null,
      category_name: cat?.name ?? null,
      item_id: (l.item_id as string | null) ?? null,
      item_code: it?.code ?? null,
      item_name: it?.name ?? null,
      label: (l.label as string | null) ?? null,
      spec_hint: (l.spec_hint as string | null) ?? null,
      sort_order: (l.sort_order as number) ?? 0,
    });
    byPart.set(l.part_id as string, arr);
  }
  return (parts ?? []).map((p) => ({
    id: p.id as string,
    title: p.title as string,
    sort_order: (p.sort_order as number) ?? 0,
    lines: (byPart.get(p.id as string) ?? []).sort(
      (a, b) => a.sort_order - b.sort_order,
    ),
  }));
}

export async function upsertTemplatePart(input: {
  id?: string;
  title: string;
  sort_order?: number;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase
      .from("packing_template_parts")
      .update({ title: input.title, sort_order: input.sort_order, updated_at: new Date().toISOString() })
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: input.id };
  }
  const { data, error } = await supabase
    .from("packing_template_parts")
    .insert({ title: input.title, sort_order: input.sort_order ?? 0 })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

export async function deleteTemplatePart(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("packing_template_parts").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function reorderTemplateParts(orderedIds: string[]): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("packing_template_parts").update({ sort_order: i }).eq("id", id),
    ),
  );
  return { ok: true };
}

export async function upsertTemplateLine(input: {
  id?: string;
  part_id: string;
  kind: PackingLineKind;
  category_id?: string | null;
  item_id?: string | null;
  label?: string | null;
  spec_hint?: string | null;
  sort_order?: number;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const payload = {
    part_id: input.part_id,
    kind: input.kind,
    category_id: input.category_id ?? null,
    item_id: input.item_id ?? null,
    label: input.label ?? null,
    spec_hint: input.spec_hint ?? null,
    sort_order: input.sort_order ?? 0,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await supabase.from("packing_template_lines").update(payload).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: input.id };
  }
  const { data, error } = await supabase
    .from("packing_template_lines")
    .insert(payload)
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

export async function deleteTemplateLine(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("packing_template_lines").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function reorderTemplateLines(orderedIds: string[]): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("packing_template_lines").update({ sort_order: i }).eq("id", id),
    ),
  );
  return { ok: true };
}

// ============================================================================
// PER-JOB LIST
// ============================================================================

/** For a job, build two BOM lookups:
 *  - byCat: category_id (and every ancestor) → the BOM item(s) under that subtree,
 *    each with its summed required qty (so a template category line resolves by an
 *    O(1) lookup).
 *  - byItem: item_id → summed required qty (so a pinned item line can capture its
 *    own BOM quantity directly). */
async function buildJobBom(jobId: string): Promise<{
  byCat: Map<string, { item_id: string; qty: number }[]>;
  byItem: Map<string, number>;
}> {
  const supabase = createCacheClient();
  // job → its BOM header(s) → lines (item_id + required_quantity)
  const { data: headers } = await supabase
    .from("job_bom_headers")
    .select("id")
    .eq("job_id", jobId);
  const headerIds = (headers ?? []).map((h) => h.id as string);
  const byCat = new Map<string, { item_id: string; qty: number }[]>();
  const byItem = new Map<string, number>();
  if (headerIds.length === 0) return { byCat, byItem };

  const { data: bomLines } = await supabase
    .from("job_bom_lines")
    .select("item_id, required_quantity")
    .in("job_bom_id", headerIds)
    .not("item_id", "is", null);
  const lines = (bomLines ?? []) as { item_id: string; required_quantity: number }[];
  if (lines.length === 0) return { byCat, byItem };

  // per-item total qty (drives pinned-item lines)
  for (const l of lines)
    byItem.set(l.item_id, (byItem.get(l.item_id) ?? 0) + Number(l.required_quantity || 0));

  // each BOM item's direct category
  const itemIds = [...byItem.keys()];
  const itemCat = new Map<string, string | null>();
  for (let i = 0; i < itemIds.length; i += 300) {
    const { data } = await supabase
      .from("items")
      .select("id, category_id")
      .in("id", itemIds.slice(i, i + 300));
    for (const it of data ?? []) itemCat.set(it.id as string, (it.category_id as string | null) ?? null);
  }

  // category parent map (to walk a BOM item's category up to all ancestors)
  const cats = await getAllCategories();
  const parentOf = new Map<string, string | null>(cats.map((c) => [c.id, c.parent_id]));

  // aggregate qty per (category-or-ancestor, item)
  const agg = new Map<string, Map<string, number>>(); // catId -> item_id -> qty
  for (const l of lines) {
    const cat = itemCat.get(l.item_id);
    if (!cat) continue;
    let cur: string | null = cat;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const m = agg.get(cur) ?? new Map<string, number>();
      m.set(l.item_id, (m.get(l.item_id) ?? 0) + Number(l.required_quantity || 0));
      agg.set(cur, m);
      cur = parentOf.get(cur) ?? null;
    }
  }
  for (const [catId, m] of agg) {
    byCat.set(
      catId,
      [...m.entries()]
        .map(([item_id, qty]) => ({ item_id, qty }))
        // stable order so shared-category claim-once pairs items consistently
        .sort((a, b) => a.item_id.localeCompare(b.item_id)),
    );
  }
  return { byCat, byItem };
}

/** Load a job's R1 list, seeding it from the template (+ BOM auto-fill) on
 *  first open. */
export async function getR1List(jobId: string): Promise<R1ListView> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("packing_r1_lists")
    .select("id, status")
    .eq("job_id", jobId)
    .maybeSingle();

  let listId = existing?.id as string | undefined;
  let status = (existing?.status as "draft" | "final") ?? "draft";

  if (!listId) {
    const { data: created, error } = await supabase
      .from("packing_r1_lists")
      .insert({ job_id: jobId, status: "draft" })
      .select("id, status")
      .single();
    if (error) throw error;
    listId = created.id as string;
    status = "draft";
    // seed from template + BOM auto-fill
    const template = await getTemplate();
    const { byCat, byItem } = await buildJobBom(jobId);

    // Per category: how many template lines reference it, and across how many parts.
    //  - distinct (1 line)           → expand: one row per matching BOM item.
    //  - multiple lines in ONE part  → interchangeable slots (e.g. the two Guide Rail
    //    lines): DISTRIBUTE the matching items one-per-slot, in order.
    //  - lines across MULTIPLE parts → cross-part shared (e.g. Stud Anchor on 5 parts,
    //    CI/PVC Pulley on Car+Counter): the item-to-line mapping is ambiguous, so we
    //    DON'T auto-fill — the items surface in Unmapped Items for manual placement.
    const catLineCount = new Map<string, number>();
    const catParts = new Map<string, Set<string>>();
    for (const p of template)
      for (const tl of p.lines)
        if (tl.kind === "category" && tl.category_id) {
          catLineCount.set(tl.category_id, (catLineCount.get(tl.category_id) ?? 0) + 1);
          const s = catParts.get(tl.category_id) ?? new Set<string>();
          s.add(p.id);
          catParts.set(tl.category_id, s);
        }
    const claimCursor = new Map<string, number>(); // same-part slot distribution cursor

    const seedRows: Record<string, unknown>[] = [];
    let so = 0;
    const pushRow = (
      part_title: string,
      tl: R1TemplateLine,
      item_id: string | null,
      qty: number,
      source: string,
    ) =>
      seedRows.push({
        list_id: listId,
        part_title,
        template_line_id: tl.id,
        kind: tl.kind,
        category_id: tl.category_id,
        item_id,
        label: tl.label,
        spec: null,
        qty,
        source,
        sort_order: so++,
      });

    for (const part of template) {
      for (const tl of part.lines) {
        if (tl.kind === "category" && tl.category_id) {
          const matches = byCat.get(tl.category_id) ?? [];
          const lines = catLineCount.get(tl.category_id) ?? 1;
          const partsSpan = catParts.get(tl.category_id)?.size ?? 1;
          if (lines > 1 && partsSpan > 1) {
            // cross-part shared (Stud Anchor, pulleys, …) — ambiguous, leave blank so
            // the items show in Unmapped Items.
            pushRow(part.title, tl, null, 0, "template");
          } else if (lines > 1) {
            // interchangeable slots in ONE part (two Guide Rail lines) → distribute
            // one matching item per slot, in order; extra items go to Unmapped.
            const idx = claimCursor.get(tl.category_id) ?? 0;
            if (idx < matches.length) {
              pushRow(part.title, tl, matches[idx].item_id, matches[idx].qty, "auto");
              claimCursor.set(tl.category_id, idx + 1);
            } else {
              pushRow(part.title, tl, null, 0, "template");
            }
          } else if (matches.length >= 2) {
            // distinct category, several BOM items → one auto row per item
            for (const m of matches) pushRow(part.title, tl, m.item_id, m.qty, "auto");
          } else if (matches.length === 1) {
            pushRow(part.title, tl, matches[0].item_id, matches[0].qty, "auto");
          } else {
            pushRow(part.title, tl, null, 0, "template");
          }
          continue;
        }
        if (tl.kind === "item") {
          // pinned item → capture its BOM quantity when the job uses it
          const q = tl.item_id ? byItem.get(tl.item_id) ?? 0 : 0;
          pushRow(part.title, tl, tl.item_id, q, q > 0 ? "auto" : "template");
          continue;
        }
        // hardware / free → blank
        pushRow(part.title, tl, tl.item_id, 0, "template");
      }
    }
    for (let i = 0; i < seedRows.length; i += 200) {
      const { error: ie } = await supabase
        .from("packing_r1_lines")
        .insert(seedRows.slice(i, i + 200));
      if (ie) throw ie;
    }
  }

  return readR1List(jobId, listId!, status);
}

async function readR1List(
  jobId: string,
  listId: string,
  status: "draft" | "final",
): Promise<R1ListView> {
  const supabase = createCacheClient();
  const { data: job } = await supabase.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
  const cats = await getAllCategories();
  const catById = new Map(cats.map((c) => [c.id, c]));
  const groupOf = (kind: PackingLineKind, catId: string | null, catName: string | null): string => {
    if (kind === "hardware") return "Hardware";
    if (catId) {
      const c = catById.get(catId);
      if (c) return c.parent_id ? catById.get(c.parent_id)?.name ?? c.name : c.name;
    }
    if (kind === "item") return "Items";
    return catName ?? "Other";
  };
  const { data: lines, error } = await supabase
    .from("packing_r1_lines")
    .select(
      `id, part_title, template_line_id, kind, category_id, item_id, label, spec, qty, source, sort_order,
       category:item_categories!packing_r1_lines_category_id_fkey(name),
       item:items!packing_r1_lines_item_id_fkey(code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation))`,
    )
    .eq("list_id", listId)
    .order("sort_order");
  if (error) throw error;

  const parts: R1ListPart[] = [];
  const idx = new Map<string, R1ListPart>();
  for (const l of lines ?? []) {
    const cat = relOne<{ name: string }>(l.category);
    const it = relOne<{ code: string; name: string; uom: unknown }>(l.item);
    const uom = it ? relOne<{ abbreviation: string }>(it.uom) : null;
    const row: R1Line = {
      id: l.id as string,
      part_title: (l.part_title as string) ?? "",
      template_line_id: (l.template_line_id as string | null) ?? null,
      kind: l.kind as PackingLineKind,
      category_id: (l.category_id as string | null) ?? null,
      category_name: cat?.name ?? null,
      item_id: (l.item_id as string | null) ?? null,
      item_code: it?.code ?? null,
      item_name: it?.name ?? null,
      uom: uom?.abbreviation ?? null,
      label: (l.label as string | null) ?? null,
      spec: (l.spec as string | null) ?? null,
      qty: Number(l.qty) || 0,
      source: (l.source as string | null) ?? null,
      group: groupOf(
        l.kind as PackingLineKind,
        (l.category_id as string | null) ?? null,
        cat?.name ?? (l.label as string | null),
      ),
      sort_order: (l.sort_order as number) ?? 0,
    };
    let part = idx.get(row.part_title);
    if (!part) {
      part = { title: row.part_title, lines: [] };
      idx.set(row.part_title, part);
      parts.push(part);
    }
    part.lines.push(row);
  }
  return { listId, jobId, jobNumber: (job?.job_number as string) ?? null, status, parts };
}

export interface R1SaveLine {
  part_title: string;
  template_line_id?: string | null;
  kind: PackingLineKind;
  category_id?: string | null;
  item_id?: string | null;
  label?: string | null;
  spec?: string | null;
  qty?: number;
  source?: string | null;
}

/** Replace the job's lines (delete-then-insert) + set status. */
export async function saveR1List(
  jobId: string,
  lines: R1SaveLine[],
  status: "draft" | "final" = "draft",
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: list, error: le } = await supabase
    .from("packing_r1_lists")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (le) return { ok: false, error: le.message };
  if (!list) return { ok: false, error: "No R1 list for this job (open it first)." };
  const listId = list.id as string;

  const { error: de } = await supabase.from("packing_r1_lines").delete().eq("list_id", listId);
  if (de) return { ok: false, error: de.message };

  const rows = lines.map((l, i) => ({
    list_id: listId,
    part_title: l.part_title,
    template_line_id: l.template_line_id ?? null,
    kind: l.kind,
    category_id: l.category_id ?? null,
    item_id: l.item_id ?? null,
    label: l.label ?? null,
    spec: l.spec ?? null,
    qty: l.qty ?? 0,
    source: l.source ?? "manual",
    sort_order: i,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error: ie } = await supabase.from("packing_r1_lines").insert(rows.slice(i, i + 200));
    if (ie) return { ok: false, error: ie.message };
  }
  await supabase
    .from("packing_r1_lists")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", listId);
  return { ok: true };
}

/**
 * Save ONE section (part) without touching the rest. The target part takes the
 * caller's edited lines; every OTHER part is preserved exactly as it sits on
 * disk (the operator's unsaved edits elsewhere are NOT committed). The list is
 * then rewritten in the caller's canonical part order so sort_order stays clean
 * and contiguous — no partial-ordering surprises. Status is left unchanged.
 */
export async function saveR1Section(
  jobId: string,
  partTitles: string[],
  targetTitle: string,
  sectionLines: R1SaveLine[],
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: list, error: le } = await supabase
    .from("packing_r1_lists")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (le) return { ok: false, error: le.message };
  if (!list) return { ok: false, error: "No R1 list for this job (open it first)." };
  const listId = list.id as string;

  // Pull on-disk lines for every OTHER part (kept verbatim; their unsaved
  // client edits are intentionally not persisted by a section save).
  const { data: disk, error: re } = await supabase
    .from("packing_r1_lines")
    .select("part_title, template_line_id, kind, category_id, item_id, label, spec, qty, source")
    .eq("list_id", listId)
    .order("sort_order");
  if (re) return { ok: false, error: re.message };

  const byPart = new Map<string, R1SaveLine[]>();
  for (const r of disk ?? []) {
    if ((r.part_title as string) === targetTitle) continue; // replaced by the edits
    const arr = byPart.get(r.part_title as string) ?? [];
    arr.push({
      part_title: r.part_title as string,
      template_line_id: (r.template_line_id as string | null) ?? null,
      kind: r.kind as PackingLineKind,
      category_id: (r.category_id as string | null) ?? null,
      item_id: (r.item_id as string | null) ?? null,
      label: (r.label as string | null) ?? null,
      spec: (r.spec as string | null) ?? null,
      qty: Number(r.qty) || 0,
      source: (r.source as string | null) ?? "manual",
    });
    byPart.set(r.part_title as string, arr);
  }
  byPart.set(targetTitle, sectionLines.map((l) => ({ ...l, part_title: targetTitle })));

  // Canonical order = the caller's part order, then any disk-only parts (safety).
  const order = [...partTitles];
  for (const t of byPart.keys()) if (!order.includes(t)) order.push(t);

  const merged: R1SaveLine[] = [];
  for (const t of order) {
    const arr = byPart.get(t);
    if (arr) merged.push(...arr);
  }

  const { error: de } = await supabase.from("packing_r1_lines").delete().eq("list_id", listId);
  if (de) return { ok: false, error: de.message };

  const rows = merged.map((l, i) => ({
    list_id: listId,
    part_title: l.part_title,
    template_line_id: l.template_line_id ?? null,
    kind: l.kind,
    category_id: l.category_id ?? null,
    item_id: l.item_id ?? null,
    label: l.label ?? null,
    spec: l.spec ?? null,
    qty: l.qty ?? 0,
    source: l.source ?? "manual",
    sort_order: i,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error: ie } = await supabase.from("packing_r1_lines").insert(rows.slice(i, i + 200));
    if (ie) return { ok: false, error: ie.message };
  }
  await supabase
    .from("packing_r1_lists")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", listId);
  return { ok: true };
}

/** Items inside a category (+ all descendants), optionally filtered — the
 *  per-job builder's picker for a category/hardware line. */
export interface R1CatItem {
  id: string;
  code: string;
  name: string;
  uom: string | null;
}
export async function itemsInCategory(categoryId: string, q?: string): Promise<R1CatItem[]> {
  const ids = await expandCategoryDescendants([categoryId]);
  if (ids.length === 0) return [];
  const supabase = createCacheClient();
  let query = supabase
    .from("items")
    .select("id, code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation)")
    .eq("is_active", true)
    .in("category_id", ids)
    .order("code")
    .limit(100);
  const s = (q ?? "").trim();
  if (s) query = query.or(`code.ilike.%${s}%,name.ilike.%${s}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((it) => ({
    id: it.id as string,
    code: it.code as string,
    name: it.name as string,
    uom: relOne<{ abbreviation: string }>(it.uom)?.abbreviation ?? null,
  }));
}

/** category_id → item count (subtree, active items). Cached 5 min on the items
 *  tag — drives the count badge next to each category dropdown in the builder. */
export async function getCategoryItemCounts(): Promise<Record<string, number>> {
  return unstable_cache(
    async () => {
      const supabase = createCacheClient();
      const cats = await getAllCategories();
      const children = new Map<string, string[]>();
      for (const c of cats) {
        if (c.parent_id) {
          const a = children.get(c.parent_id);
          if (a) a.push(c.id);
          else children.set(c.parent_id, [c.id]);
        }
      }
      const rows = await fetchAllRanged<{ category_id: string | null }>((from, to, wc) =>
        supabase
          .from("items")
          .select("category_id", wc ? { count: "exact" } : {})
          .eq("is_active", true)
          .not("category_id", "is", null)
          .range(from, to),
      );
      const direct = new Map<string, number>();
      for (const r of rows) if (r.category_id) direct.set(r.category_id, (direct.get(r.category_id) ?? 0) + 1);
      const memo = new Map<string, number>();
      const subtree = (id: string): number => {
        const m = memo.get(id);
        if (m !== undefined) return m;
        let n = direct.get(id) ?? 0;
        for (const ch of children.get(id) ?? []) n += subtree(ch);
        memo.set(id, n);
        return n;
      };
      const out: Record<string, number> = {};
      for (const c of cats) out[c.id] = subtree(c.id);
      return out;
    },
    ["r1-category-item-counts"],
    { revalidate: 300, tags: ["items"] },
  )();
}

// ============================================================================
// DEMAND (per job)
// ============================================================================
export async function getR1Demand(jobId: string): Promise<R1Demand> {
  const supabase = createCacheClient();
  const { data: list } = await supabase
    .from("packing_r1_lists")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!list) return { make: [], trade: [], unclassified: [], totals: { items: 0, shortfallItems: 0, toBuyItems: 0 } };

  const { data: lines } = await supabase
    .from("packing_r1_lines")
    .select("item_id, qty")
    .eq("list_id", list.id as string)
    .not("item_id", "is", null);

  // required = Σ qty per item
  const required = new Map<string, number>();
  for (const l of lines ?? []) {
    const id = l.item_id as string;
    required.set(id, (required.get(id) ?? 0) + (Number(l.qty) || 0));
  }
  const itemIds = [...required.keys()];
  if (itemIds.length === 0)
    return { make: [], trade: [], unclassified: [], totals: { items: 0, shortfallItems: 0, toBuyItems: 0 } };

  // item meta (code/name/uom + effective procurement_type)
  const meta = new Map<
    string,
    { code: string; name: string; uom: string | null; pt: "make" | "trade" | null }
  >();
  for (let i = 0; i < itemIds.length; i += 300) {
    const { data } = await supabase
      .from("items")
      .select(
        `id, code, name, procurement_type,
         category:item_categories!items_category_id_fkey(procurement_type),
         uom:units_of_measurement!items_uom_id_fkey(abbreviation)`,
      )
      .in("id", itemIds.slice(i, i + 300));
    for (const it of data ?? []) {
      const cat = relOne<{ procurement_type: "make" | "trade" | null }>(it.category);
      const uom = relOne<{ abbreviation: string }>(it.uom);
      const pt =
        ((it.procurement_type as "make" | "trade" | null) ?? cat?.procurement_type ?? null);
      meta.set(it.id as string, {
        code: (it.code as string) ?? "",
        name: (it.name as string) ?? "",
        uom: uom?.abbreviation ?? null,
        pt,
      });
    }
  }

  // stock = Σ inventory.quantity per item (includes cabin)
  const stock = new Map<string, number>();
  for (let i = 0; i < itemIds.length; i += 300) {
    const { data } = await supabase
      .from("inventory")
      .select("item_id, quantity")
      .in("item_id", itemIds.slice(i, i + 300));
    for (const r of data ?? [])
      stock.set(r.item_id as string, (stock.get(r.item_id as string) ?? 0) + (Number(r.quantity) || 0));
  }

  // on-order (reuse PO outstanding)
  const onOrder = await _getOutstandingByItemUncached();

  const rows: R1DemandRow[] = itemIds.map((id) => {
    const m = meta.get(id);
    const req = required.get(id) ?? 0;
    const onHand = stock.get(id) ?? 0;
    const oo = onOrder[id] ?? 0;
    const shortfall = Math.max(0, req - onHand);
    return {
      item_id: id,
      code: m?.code ?? "—",
      name: m?.name ?? "—",
      uom: m?.uom ?? null,
      procurement_type: m?.pt ?? null,
      required: req,
      on_hand: onHand,
      on_order: oo,
      shortfall,
      to_buy: Math.max(0, shortfall - oo),
    };
  });
  rows.sort((a, b) => b.shortfall - a.shortfall || a.code.localeCompare(b.code));

  return {
    make: rows.filter((r) => r.procurement_type === "make"),
    trade: rows.filter((r) => r.procurement_type === "trade"),
    unclassified: rows.filter((r) => r.procurement_type == null),
    totals: {
      items: rows.length,
      shortfallItems: rows.filter((r) => r.shortfall > 0).length,
      toBuyItems: rows.filter((r) => r.to_buy > 0).length,
    },
  };
}

// ============================================================================
// CABIN PANELS (read-only mirror of the job's Cabin Job)
// ============================================================================
export interface R1CabinPanelLine {
  code: string | null;
  name: string;
  qty: number;
  uom: string | null;
}
export interface R1CabinPanelGroup {
  type: string;
  lines: R1CabinPanelLine[];
}
export interface R1CabinPanels {
  /** A Cabin Job exists for this job number (otherwise the 15 headings show blank). */
  hasCabinJob: boolean;
  /** All 15 cabin types in display order; each carries its cabin-job items (or none). */
  groups: R1CabinPanelGroup[];
}

/** The cabin items for a job, pulled live from its Cabin Job (matched by job number)
 *  and grouped by the 15 cabin types in serial (sort_order) order. Read-only on the
 *  packing list — the Cabin Job is the single source of truth. */
export async function getCabinPanelsForJob(jobId: string): Promise<R1CabinPanels> {
  const empty: R1CabinPanels = {
    hasCabinJob: false,
    groups: CABIN_TYPES.map((t) => ({ type: t, lines: [] })),
  };
  const supabase = createCacheClient();
  const { data: job } = await supabase.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
  const jobNumber = ((job?.job_number as string) ?? "").trim();
  if (!jobNumber) return empty;

  // cabin job by number (case-insensitive)
  const { data: cabs } = await supabase
    .from("cabin_jobs")
    .select("id, job_number")
    .ilike("job_number", jobNumber);
  const cab = (cabs ?? []).find(
    (c) => ((c.job_number as string) ?? "").trim().toLowerCase() === jobNumber.toLowerCase(),
  );
  if (!cab) return empty;

  const { data: lines } = await supabase
    .from("cabin_job_lines")
    .select(
      `cabin_type, qty, sort_order,
       item:items!cabin_job_lines_item_id_fkey(code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation))`,
    )
    .eq("cabin_job_id", cab.id as string)
    .order("sort_order");

  const byType = new Map<string, R1CabinPanelLine[]>();
  for (const l of lines ?? []) {
    const it = relOne<{ code: string; name: string; uom: unknown }>(l.item);
    const uom = it ? relOne<{ abbreviation: string }>(it.uom) : null;
    const arr = byType.get(l.cabin_type as string) ?? [];
    arr.push({
      code: it?.code ?? null,
      name: it?.name ?? "(item)",
      qty: Number(l.qty) || 0,
      uom: uom?.abbreviation ?? null,
    });
    byType.set(l.cabin_type as string, arr);
  }
  return {
    hasCabinJob: true,
    groups: CABIN_TYPES.map((t) => ({ type: t, lines: byType.get(t) ?? [] })),
  };
}

// ============================================================================
// UNMAPPED BOM ITEMS (BOM items not captured anywhere on the R1 list)
// ============================================================================
export interface R1UnmappedItem {
  item_id: string;
  code: string;
  name: string;
  uom: string | null;
  category: string | null;
  qty: number;
}

/** A job's BOM items whose item_id does NOT appear on its saved R1 list — the
 *  "carry-over" set so no BOM line is silently dropped. Computed live (BOM vs the
 *  list's current item_ids), reflects the LAST SAVED state of the list. */
export async function getUnmappedBomItems(jobId: string): Promise<R1UnmappedItem[]> {
  const supabase = createCacheClient();

  const { data: headers } = await supabase
    .from("job_bom_headers")
    .select("id")
    .eq("job_id", jobId);
  const headerIds = (headers ?? []).map((h) => h.id as string);
  if (headerIds.length === 0) return [];

  const { data: bomLines } = await supabase
    .from("job_bom_lines")
    .select("item_id, required_quantity")
    .in("job_bom_id", headerIds)
    .not("item_id", "is", null);
  const bomQty = new Map<string, number>();
  for (const l of bomLines ?? [])
    bomQty.set(l.item_id as string, (bomQty.get(l.item_id as string) ?? 0) + (Number(l.required_quantity) || 0));
  if (bomQty.size === 0) return [];

  // item_ids already present on the job's R1 list
  const onList = new Set<string>();
  const { data: list } = await supabase
    .from("packing_r1_lists")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (list) {
    const { data: r1 } = await supabase
      .from("packing_r1_lines")
      .select("item_id")
      .eq("list_id", list.id as string)
      .not("item_id", "is", null);
    for (const r of r1 ?? []) onList.add(r.item_id as string);
  }

  const unmappedIds = [...bomQty.keys()].filter((id) => !onList.has(id));
  if (unmappedIds.length === 0) return [];

  const out: R1UnmappedItem[] = [];
  for (let i = 0; i < unmappedIds.length; i += 300) {
    const { data } = await supabase
      .from("items")
      .select(
        `id, code, name,
         category:item_categories!items_category_id_fkey(name),
         uom:units_of_measurement!items_uom_id_fkey(abbreviation)`,
      )
      .in("id", unmappedIds.slice(i, i + 300));
    for (const it of data ?? []) {
      const cat = relOne<{ name: string }>(it.category);
      const uom = relOne<{ abbreviation: string }>(it.uom);
      out.push({
        item_id: it.id as string,
        code: (it.code as string) ?? "",
        name: (it.name as string) ?? "",
        uom: uom?.abbreviation ?? null,
        category: cat?.name ?? null,
        qty: bomQty.get(it.id as string) ?? 0,
      });
    }
  }
  out.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.code.localeCompare(b.code));
  return out;
}
