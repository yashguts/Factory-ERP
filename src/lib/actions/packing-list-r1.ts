"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { getAllCategories } from "@/lib/actions/categories";
import { _getOutstandingByItemUncached } from "@/lib/actions/po-outstanding";
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

/** For a job, map every category_id (and its ancestors) → BOM items in it.
 *  So a template category line resolves to the job's BOM item(s) under that
 *  category subtree by an O(1) lookup. */
async function buildJobBomByCategory(
  jobId: string,
): Promise<Map<string, { item_id: string; qty: number }[]>> {
  const supabase = createCacheClient();
  // job → its BOM header(s) → lines (item_id + required_quantity)
  const { data: headers } = await supabase
    .from("job_bom_headers")
    .select("id")
    .eq("job_id", jobId);
  const headerIds = (headers ?? []).map((h) => h.id as string);
  const out = new Map<string, { item_id: string; qty: number }[]>();
  if (headerIds.length === 0) return out;

  const { data: bomLines } = await supabase
    .from("job_bom_lines")
    .select("item_id, required_quantity")
    .in("job_bom_id", headerIds)
    .not("item_id", "is", null);
  const lines = (bomLines ?? []) as { item_id: string; required_quantity: number }[];
  if (lines.length === 0) return out;

  // each BOM item's direct category
  const itemIds = [...new Set(lines.map((l) => l.item_id))];
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
    out.set(
      catId,
      [...m.entries()].map(([item_id, qty]) => ({ item_id, qty })),
    );
  }
  return out;
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
    const bomByCat = await buildJobBomByCategory(jobId);
    const seedRows: Record<string, unknown>[] = [];
    let so = 0;
    for (const part of template) {
      for (const tl of part.lines) {
        let item_id = tl.item_id;
        let qty = 0;
        let source = "template";
        if (tl.kind === "category" && tl.category_id) {
          const matches = bomByCat.get(tl.category_id) ?? [];
          if (matches.length === 1) {
            item_id = matches[0].item_id;
            qty = matches[0].qty;
            source = "auto";
          }
        }
        seedRows.push({
          list_id: listId,
          part_title: part.title,
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
