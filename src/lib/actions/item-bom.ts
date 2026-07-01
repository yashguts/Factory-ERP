"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import type { FinishRule, StockBehaviour } from "@/lib/supabase/types";

/* ------------------------------------------------------------------ *
 * Item multi-level parts list ("Built from"), with finish propagation.
 *
 * An assembly item owns a list of child lines. Each line resolves to a
 * concrete child at explode time per its finish_rule:
 *   neutral  -> child_item_id directly (one SKU, no finish dimension)
 *   inherit  -> the member of child_family whose finish = parent's finish
 *   pinned   -> the member of child_family whose finish = pinned_finish
 * Reads cached under "bom-lines" + "items"; mutations revalidate both.
 * ------------------------------------------------------------------ */

export interface ItemForBom {
  id: string;
  code: string;
  name: string;
  stock_behaviour: StockBehaviour;
  /** Cut piece a program makes (hidden from the main /inventory list; shown on
   *  /child-parts). Orthogonal to stock_behaviour. */
  is_child_part: boolean;
  procurement_type: "make" | "trade" | null;
  category_procurement_type: "make" | "trade" | null;
  effective_procurement_type: "make" | "trade" | null;
  family: string | null;
  finish: string | null;
  uom_abbreviation: string;
}

export interface ItemBomLineDetail {
  id: string;
  child_item_id: string | null;
  child_family: string | null;
  qty: number;
  finish_rule: FinishRule;
  pinned_finish: string | null;
  sort_order: number;
  /** Resolved display for the (representative) child item. */
  child_code: string | null;
  child_name: string | null;
  child_uom: string | null;
  /** The child item's own family/finish (lets the editor rebuild the row). */
  child_item_family: string | null;
  child_item_finish: string | null;
  /** The child's stock behaviour — splits stocked sub-parts vs loose (phantom) parts. */
  child_stock_behaviour: StockBehaviour;
  /**
   * True when this child SHOULD be produced by a program but none does: it's a
   * make piece (not bought), is not itself a sub-assembly, yet no operation
   * outputs it. Drives the RED "missing program" warning. Bought/trade children
   * (glass, PVC shoes) are never flagged.
   */
  child_missing_program: boolean;
}

export interface ItemBomResult {
  item: ItemForBom;
  lines: ItemBomLineDetail[];
}

/** A line as supplied by the editor when saving. */
export interface ItemBomLineInput {
  child_item_id: string | null;
  child_family: string | null;
  qty: number;
  finish_rule: FinishRule;
  pinned_finish: string | null;
}

export type ItemBomSaveResult = { ok: true } | { ok: false; error: string };

function flatten<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return (rel[0] as T) ?? null;
  return (rel as T) ?? null;
}

type CacheDb = ReturnType<typeof createCacheClient>;

/**
 * Of the given item ids, which are produced by at least one (non-cabin)
 * program — i.e. appear as any `operation_outputs` row. Cabin-migration
 * programs are excluded to match the rest of the subassembly audit. Queries in
 * chunks so a long id list never blows the request-URL length limit.
 */
async function producedItemIds(
  supabase: CacheDb,
  itemIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const CHUNK = 100;
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const batch = itemIds.slice(i, i + CHUNK);
    if (batch.length === 0) continue;
    const { data, error } = await supabase
      .from("operation_outputs")
      .select(`item_id, operation:operations(import_source)`)
      .in("item_id", batch);
    if (error) throw error;
    for (const r of data ?? []) {
      const src =
        (flatten<any>((r as any).operation)?.import_source as string | null) ??
        null;
      if (src === "cabin_migration") continue;
      const id = (r as any).item_id as string | null;
      if (id) out.add(id);
    }
  }
  return out;
}

/** Of the given item ids, which are themselves sub-assemblies (parents in item_bom_lines). */
async function subassemblyIdsAmong(
  supabase: CacheDb,
  itemIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const CHUNK = 100;
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const batch = itemIds.slice(i, i + CHUNK);
    if (batch.length === 0) continue;
    const { data, error } = await supabase
      .from("item_bom_lines")
      .select("parent_item_id")
      .in("parent_item_id", batch);
    if (error) throw error;
    for (const r of data ?? []) out.add((r as any).parent_item_id as string);
  }
  return out;
}

const _getItemBomUncached = async (
  itemId: string,
): Promise<ItemBomResult | null> => {
  const supabase = createCacheClient();

  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select(
      `id, code, name, stock_behaviour, is_child_part, procurement_type, family, finish,
       category:item_categories!items_category_id_fkey(procurement_type),
       uom:units_of_measurement!items_uom_id_fkey(abbreviation)`,
    )
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr) throw itemErr;
  if (!item) return null;

  const { data: rows, error: lineErr } = await supabase
    .from("item_bom_lines")
    .select(
      `id, child_item_id, child_family, qty, finish_rule, pinned_finish, sort_order,
       child:items!item_bom_lines_child_item_id_fkey(code, name, family, finish, stock_behaviour, procurement_type,
         category:item_categories!items_category_id_fkey(procurement_type),
         uom:units_of_measurement!items_uom_id_fkey(abbreviation))`,
    )
    .eq("parent_item_id", itemId)
    .order("sort_order");
  if (lineErr) throw lineErr;

  // Which children are make pieces that no program produces (and aren't
  // sub-assemblies themselves) — those are genuine "missing program" gaps.
  const childIds = (rows ?? [])
    .map((r: any) => r.child_item_id as string | null)
    .filter((id): id is string => !!id);
  const [producedSet, childSubSet] = await Promise.all([
    producedItemIds(supabase, childIds),
    subassemblyIdsAmong(supabase, childIds),
  ]);

  const itemPT = (item.procurement_type as "make" | "trade" | null) ?? null;
  const catPT =
    (flatten<any>(item.category)?.procurement_type as
      | "make"
      | "trade"
      | null) ?? null;

  const lines: ItemBomLineDetail[] = (rows ?? []).map((r: any) => {
    const child = flatten<any>(r.child);
    const cuom = flatten<any>(child?.uom);
    const childId = (r.child_item_id as string | null) ?? null;
    const childPT =
      (child?.procurement_type as "make" | "trade" | null) ??
      (flatten<any>(child?.category)?.procurement_type as
        | "make"
        | "trade"
        | null) ??
      null;
    // Make piece, not itself a sub-assembly, with no producing program = a gap.
    const missingProgram =
      !!childId &&
      childPT !== "trade" &&
      !childSubSet.has(childId) &&
      !producedSet.has(childId);
    return {
      id: r.id as string,
      child_item_id: childId,
      child_family: (r.child_family as string | null) ?? null,
      qty: Number(r.qty ?? 0),
      finish_rule: (r.finish_rule as FinishRule) ?? "neutral",
      pinned_finish: (r.pinned_finish as string | null) ?? null,
      sort_order: Number(r.sort_order ?? 0),
      child_code: (child?.code as string) ?? null,
      child_name: (child?.name as string) ?? null,
      child_uom: (cuom?.abbreviation as string) ?? null,
      child_item_family: (child?.family as string | null) ?? null,
      child_item_finish: (child?.finish as string | null) ?? null,
      child_stock_behaviour:
        ((child?.stock_behaviour as StockBehaviour | null) ?? "stocked"),
      child_missing_program: missingProgram,
    };
  });

  return {
    item: {
      id: item.id as string,
      code: item.code as string,
      name: item.name as string,
      stock_behaviour: (item.stock_behaviour as StockBehaviour) ?? "stocked",
      is_child_part: (item.is_child_part as boolean) ?? false,
      procurement_type: itemPT,
      category_procurement_type: catPT,
      effective_procurement_type: itemPT ?? catPT,
      family: (item.family as string | null) ?? null,
      finish: (item.finish as string | null) ?? null,
      uom_abbreviation:
        (flatten<any>(item.uom)?.abbreviation as string) ?? "",
    },
    lines,
  };
};

export async function getItemBom(itemId: string): Promise<ItemBomResult | null> {
  if (!itemId) return null;
  const cached = unstable_cache(
    () => _getItemBomUncached(itemId),
    ["item-bom", itemId],
    { revalidate: 600, tags: ["bom-lines", "items"] },
  );
  return cached();
}

/**
 * Replace the entire parts list for one parent item (form is source of truth,
 * same approach as saveBomSection / replaceLines). Validates each line.
 */
export async function saveItemBom(
  parentItemId: string,
  lines: ItemBomLineInput[],
): Promise<ItemBomSaveResult> {
  if (!parentItemId) return { ok: false, error: "Missing item id." };

  // Validate + normalise; drop blank lines (no target).
  const clean: Array<{
    parent_item_id: string;
    child_item_id: string | null;
    child_family: string | null;
    qty: number;
    finish_rule: FinishRule;
    pinned_finish: string | null;
    sort_order: number;
  }> = [];
  let idx = 0;
  for (const l of lines) {
    // Every line is anchored to a concrete picked item (the representative,
    // and the resolved child for 'neutral'). Skip blank rows.
    if (!l.child_item_id) continue;
    const rule = l.finish_rule;
    if (rule !== "neutral" && !l.child_family) {
      return {
        ok: false,
        error:
          "Inherit/pinned parts must belong to a finish family — pick a finish-variant item or use 'This exact item'.",
      };
    }
    if (rule === "pinned" && !l.pinned_finish) {
      return { ok: false, error: "A pinned line needs a finish to pin to." };
    }
    if (!(Number(l.qty) > 0)) {
      return { ok: false, error: "Every part needs a quantity greater than 0." };
    }
    if (l.child_item_id === parentItemId) {
      return { ok: false, error: "An item can't be a part of itself." };
    }
    clean.push({
      parent_item_id: parentItemId,
      // child_item_id is always the picked item — the resolved child for
      // 'neutral', or a representative of the family for inherit/pinned.
      child_item_id: l.child_item_id,
      child_family: rule === "neutral" ? null : l.child_family,
      qty: Number(l.qty),
      finish_rule: rule,
      pinned_finish: rule === "pinned" ? l.pinned_finish : null,
      sort_order: idx++,
    });
  }

  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("item_bom_lines")
    .delete()
    .eq("parent_item_id", parentItemId);
  if (delErr) return { ok: false, error: delErr.message };

  if (clean.length > 0) {
    const { error: insErr } = await supabase
      .from("item_bom_lines")
      .insert(clean);
    if (insErr) return { ok: false, error: insErr.message };
  }

  revalidateTag("bom-lines");
  revalidateTag("items");
  revalidatePath(`/inventory/${parentItemId}`);
  revalidatePath("/inventory");
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Loose parts (Assembly parts section).
 *
 * A loose part is a cut piece that is never stocked — it lives only as a
 * program output (`operation_outputs.role = 'cut_part'`). Two states:
 *   - a real phantom item (stock_behaviour='phantom'), already promoted, or
 *   - a plain label on one-or-more program outputs (item_id IS NULL).
 * The Assembly-parts picker searches ONLY this universe (never all stock).
 * To attach a label to an assembly it must first become a phantom item;
 * promoting also relinks every program output that shares the label, so the
 * /mrp/plan explode can route the assembly through the cutting program.
 * ------------------------------------------------------------------ */

export type LoosePartCandidate =
  | { kind: "item"; id: string; code: string; name: string; uom: string }
  | { kind: "label"; label: string; programs: number };

/** Search loose parts: phantom loose-part items + unlinked cut_part labels. */
export async function searchLooseParts(
  query: string,
  limit = 30,
): Promise<LoosePartCandidate[]> {
  const supabase = createCacheClient();
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  // (a) phantom loose-part items already created
  let pq = supabase
    .from("items")
    .select(`id, code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation)`)
    .eq("is_active", true)
    .eq("stock_behaviour", "phantom");
  for (const t of tokens) {
    const safe = t.replace(/[%,]/g, "");
    pq = pq.or(`name.ilike.%${safe}%,code.ilike.%${safe}%`);
  }
  const { data: pitems, error: pErr } = await pq.order("name").limit(limit);
  if (pErr) throw pErr;

  const phantomNames = new Set(
    (pitems ?? []).map((r: any) => String(r.name).trim().toLowerCase()),
  );
  const items: LoosePartCandidate[] = (pitems ?? []).map((r: any) => ({
    kind: "item",
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    uom: (flatten<any>(r.uom)?.abbreviation as string) ?? "",
  }));

  // (b) loose-part LABELS on program outputs not yet linked to an item
  const { data: rows, error: lErr } = await supabase
    .from("operation_outputs")
    .select("label, operation_id")
    .eq("role", "cut_part")
    .is("item_id", null)
    .not("label", "is", null);
  if (lErr) throw lErr;

  const byLabel = new Map<string, { label: string; programs: Set<string> }>();
  for (const r of rows ?? []) {
    const raw = String((r as any).label ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (phantomNames.has(key)) continue; // already shown as a phantom item
    if (tokens.length && !tokens.every((t) => key.includes(t))) continue;
    const e = byLabel.get(key) ?? { label: raw, programs: new Set<string>() };
    e.programs.add(String((r as any).operation_id));
    byLabel.set(key, e);
  }
  const labels: LoosePartCandidate[] = [...byLabel.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((e) => ({ kind: "label", label: e.label, programs: e.programs.size }));

  return [...items, ...labels].slice(0, limit);
}

export type PromoteLoosePartResult =
  | {
      ok: true;
      item: { id: string; code: string; name: string; uom: string };
      linkedOutputs: number;
    }
  | { ok: false; error: string };

/**
 * Turn a loose-part label into a tracked phantom item (reusing an existing
 * one of the same name when present), then relink every unlinked cut_part
 * output sharing that label to it. Returns the item for the picker to attach.
 */
export async function promoteLoosePartLabel(
  rawLabel: string,
): Promise<PromoteLoosePartResult> {
  const label = (rawLabel ?? "").trim();
  if (!label) return { ok: false, error: "Missing loose part name." };

  const supabase = await createClient();

  // Reuse an existing active item with this exact name when possible.
  const { data: existing, error: exErr } = await supabase
    .from("items")
    .select(
      `id, code, name, stock_behaviour, uom:units_of_measurement!items_uom_id_fkey(abbreviation)`,
    )
    .eq("is_active", true)
    .ilike("name", label)
    .limit(10);
  if (exErr) return { ok: false, error: exErr.message };

  const match = (existing ?? []).find(
    (r: any) => String(r.name).trim().toLowerCase() === label.toLowerCase(),
  );

  let item: { id: string; code: string; name: string; uom: string };

  if (match) {
    if ((match as any).stock_behaviour !== "phantom") {
      return {
        ok: false,
        error: `An item named "${label}" already exists in inventory as a ${(match as any).stock_behaviour} item. Add it under "Built from" instead of Assembly parts.`,
      };
    }
    item = {
      id: (match as any).id,
      code: (match as any).code,
      name: (match as any).name,
      uom: (flatten<any>((match as any).uom)?.abbreviation as string) ?? "",
    };
  } else {
    // Default loose parts to the "Numbers" (nos) unit; fall back to any unit.
    const { data: uoms } = await supabase
      .from("units_of_measurement")
      .select("id, abbreviation");
    const nos =
      (uoms ?? []).find(
        (u: any) => String(u.abbreviation).toLowerCase() === "nos",
      ) ?? (uoms ?? [])[0];
    if (!nos) return { ok: false, error: "No unit of measurement configured." };

    // Next code in the LP-NNN loose-part series.
    // Page past PostgREST's 1000-row cap so the LP series max is accurate.
    let max = 0;
    for (let off = 0; ; off += 1000) {
      const { data: lps } = await supabase
        .from("items")
        .select("code")
        .ilike("code", "LP-%")
        .order("code")
        .range(off, off + 999);
      for (const r of lps ?? []) {
        const m = /^LP-(\d+)$/i.exec(String((r as any).code));
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      if (!lps || lps.length < 1000) break;
    }
    const code = `LP-${String(max + 1).padStart(3, "0")}`;

    const { data: created, error: insErr } = await supabase
      .from("items")
      .insert({
        code,
        name: label,
        lookup_key: label,
        item_type: "sub_assembly",
        stock_behaviour: "phantom",
        is_child_part: true,
        procurement_type: "make",
        uom_id: (nos as any).id,
        is_active: true,
      })
      .select("id, code, name")
      .single();
    if (insErr) {
      const msg =
        (insErr as any).code === "23505"
          ? `An item named "${label}" (or code ${code}) already exists.`
          : insErr.message;
      return { ok: false, error: msg };
    }
    item = {
      id: (created as any).id,
      code: (created as any).code,
      name: (created as any).name,
      uom: (nos as any).abbreviation as string,
    };
  }

  // Close the loop: link every unlinked cut_part output sharing this label.
  // Match by exact trimmed/lowercased label in JS (ilike would treat %/_ as
  // wildcards), then update those rows by id.
  const { data: candidates, error: candErr } = await supabase
    .from("operation_outputs")
    .select("id, label")
    .eq("role", "cut_part")
    .is("item_id", null);
  if (candErr) return { ok: false, error: candErr.message };

  const ids = (candidates ?? [])
    .filter(
      (r: any) =>
        String(r.label ?? "").trim().toLowerCase() === label.toLowerCase(),
    )
    .map((r: any) => r.id as string);

  if (ids.length > 0) {
    const { error: relErr } = await supabase
      .from("operation_outputs")
      .update({ item_id: item.id })
      .in("id", ids);
    if (relErr) return { ok: false, error: relErr.message };
  }

  revalidateTag("items");
  revalidateTag("operations");
  revalidateTag("bom-lines");
  revalidatePath("/programs");
  revalidatePath("/inventory");
  revalidatePath("/subassemblies");
  return { ok: true, item, linkedOutputs: ids.length };
}

/* ------------------------------------------------------------------ *
 * Sub-assemblies list — every item that has a parts list defined
 * (built-from and/or assembly parts). Powers the /subassemblies page.
 * Starts empty; grows one item at a time as engineers define structures.
 * ------------------------------------------------------------------ */

export interface SubassemblyRow {
  id: string;
  code: string;
  name: string;
  family: string | null;
  finish: string | null;
  stock_behaviour: StockBehaviour;
  effective_procurement_type: "make" | "trade" | null;
  built_count: number;
  loose_count: number;
  /**
   * How many of this sub-assembly's child parts are make pieces that NO program
   * produces (and aren't sub-assemblies themselves). > 0 drives the RED
   * "missing program" warning. Bought/trade children are never counted.
   */
  missing_program_children: number;
};

const _getSubassembliesUncached = async (): Promise<SubassemblyRow[]> => {
  const supabase = createCacheClient();
  const { data, error } = await supabase.from("item_bom_lines").select(
    `parent_item_id, child_item_id,
     child:items!item_bom_lines_child_item_id_fkey(
       stock_behaviour, procurement_type,
       category:item_categories!items_category_id_fkey(procurement_type)
     ),
     parent:items!item_bom_lines_parent_item_id_fkey(
       id, code, name, family, finish, stock_behaviour, procurement_type,
       category:item_categories!items_category_id_fkey(procurement_type)
     )`,
  );
  if (error) throw error;

  const byParent = new Map<string, SubassemblyRow>();
  // Per parent, its children as {id, make?} — used to count missing programs once
  // we know which children a program produces.
  const childrenOf = new Map<string, { id: string; isMake: boolean }[]>();
  const parentSet = new Set<string>(); // every sub-assembly id (a child that is one is "covered")
  const allChildIds = new Set<string>();

  for (const r of data ?? []) {
    const parent = flatten<any>((r as any).parent);
    if (!parent) continue;
    const id = parent.id as string;
    parentSet.add(id);
    const childRel = flatten<any>((r as any).child);
    const childBeh =
      (childRel?.stock_behaviour as StockBehaviour) ?? "stocked";
    const childId = ((r as any).child_item_id as string | null) ?? null;
    const childPT =
      (childRel?.procurement_type as "make" | "trade" | null) ??
      (flatten<any>(childRel?.category)?.procurement_type as
        | "make"
        | "trade"
        | null) ??
      null;
    let row = byParent.get(id);
    if (!row) {
      const itemPT = (parent.procurement_type as "make" | "trade" | null) ?? null;
      const catPT =
        (flatten<any>(parent.category)?.procurement_type as
          | "make"
          | "trade"
          | null) ?? null;
      row = {
        id,
        code: parent.code as string,
        name: parent.name as string,
        family: (parent.family as string | null) ?? null,
        finish: (parent.finish as string | null) ?? null,
        stock_behaviour:
          (parent.stock_behaviour as StockBehaviour) ?? "stocked",
        effective_procurement_type: itemPT ?? catPT,
        built_count: 0,
        loose_count: 0,
        missing_program_children: 0,
      };
      byParent.set(id, row);
      childrenOf.set(id, []);
    }
    if (childBeh === "phantom") row.loose_count++;
    else row.built_count++;
    if (childId) {
      allChildIds.add(childId);
      childrenOf.get(id)!.push({ id: childId, isMake: childPT !== "trade" });
    }
  }

  // One coverage pass over every child, then tally per parent.
  const producedSet = await producedItemIds(supabase, [...allChildIds]);
  for (const [id, kids] of childrenOf) {
    const row = byParent.get(id)!;
    row.missing_program_children = kids.filter(
      (k) => k.isMake && !parentSet.has(k.id) && !producedSet.has(k.id),
    ).length;
  }

  return [...byParent.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export async function getSubassemblies(): Promise<SubassemblyRow[]> {
  const cached = unstable_cache(_getSubassembliesUncached, ["subassemblies"], {
    revalidate: 600,
    tags: ["bom-lines", "items"],
  });
  return cached();
}
