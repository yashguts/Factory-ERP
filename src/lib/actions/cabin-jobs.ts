"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { CABIN_PARENT } from "@/lib/cabin/cabin-types";

/* ------------------------------------------------------------------ *
 * Cabin jobs — a job number with cabin inventory items grouped by the
 * 11 cabin types. Item search is restricted to Cabin Inventory (the
 * "Cabin" category subtree), optionally scoped to a single type.
 * ------------------------------------------------------------------ */

function flatten<T>(rel: unknown): T | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return (rel[0] ?? null) as T | null;
  return rel as T;
}

interface CabinSubtree {
  ids: string[];
  /** Category name per id, subtree only (used to label + token-match sub-types). */
  names: Record<string, string>;
}

async function _cabinSubtreeUncached(
  cabinType: string | null,
): Promise<CabinSubtree> {
  const supabase = createCacheClient();
  const { data: cats } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  const list = (cats ?? []) as any[];
  const childrenOf = new Map<string, string[]>();
  for (const c of list) {
    if (c.parent_id) {
      const a = childrenOf.get(c.parent_id) ?? [];
      a.push(c.id);
      childrenOf.set(c.parent_id, a);
    }
  }
  const cabinRoot = list.find(
    (c) => c.name === CABIN_PARENT && c.parent_id === null,
  );
  if (!cabinRoot) return { ids: [], names: {} };

  let roots: string[];
  if (cabinType) {
    // "Cabin Glass" lives under the top-level "Glass" category (not under Cabin),
    // so the Cabin Jobs "Cabin Glass" block searches that sub-category by name.
    const typeCat =
      cabinType === "Cabin Glass"
        ? list.find((c) => c.name === "Cabin Glass")
        : list.find((c) => c.name === cabinType && c.parent_id === cabinRoot.id);
    if (!typeCat) return { ids: [], names: {} };
    roots = [typeCat.id];
  } else {
    roots = [cabinRoot.id];
  }
  const nameById = new Map<string, string>(list.map((c) => [c.id, c.name]));
  const ids: string[] = [];
  const names: Record<string, string> = {};
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop() as string;
    ids.push(id);
    names[id] = nameById.get(id) ?? "";
    for (const ch of childrenOf.get(id) ?? []) stack.push(ch);
  }
  return { ids, names };
}

/** Category subtree per cabin type, cached — the search actions run on every
 *  keystroke and were re-reading the whole category table each time. */
function getCabinSubtree(cabinType?: string | null): Promise<CabinSubtree> {
  const key = cabinType ?? "__all__";
  return unstable_cache(_cabinSubtreeUncached, ["cabin-subtree", key], {
    revalidate: 3600,
    tags: ["categories"],
  })(cabinType ?? null);
}

/** Build one token's OR-condition: name/code match, plus "the token names a
 *  sub-category" (e.g. "fan" under Canopy, "ACO" under Platform) — items in
 *  that sub-category match even when their name doesn't repeat the word. */
function tokenOrCondition(
  safeToken: string,
  subtree: CabinSubtree,
  extraFields: string[] = [],
): string {
  const ors = [
    `name.ilike.%${safeToken}%`,
    `code.ilike.%${safeToken}%`,
    ...extraFields.map((f) => `${f}.ilike.%${safeToken}%`),
  ];
  const catIds = subtree.ids
    .filter((id) => (subtree.names[id] ?? "").toLowerCase().includes(safeToken))
    .slice(0, 50);
  if (catIds.length) ors.push(`category_id.in.(${catIds.join(",")})`);
  return ors.join(",");
}

export interface CabinSearchItem {
  id: string;
  code: string;
  name: string;
  uom: string;
  sub_category: string | null;
  total_stock: number;
}

export async function searchCabinItems(
  query: string,
  cabinType?: string | null,
  limit = 20,
): Promise<CabinSearchItem[]> {
  const supabase = createCacheClient();
  const subtree = await getCabinSubtree(cabinType);
  if (subtree.ids.length === 0) return [];

  let q = supabase
    .from("items")
    .select(
      `id, code, name, category_id, uom:units_of_measurement(abbreviation), inventory(quantity)`,
    )
    .eq("is_active", true)
    .in("category_id", subtree.ids);

  for (const token of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    // strip PostgREST-special chars incl. parentheses — cabin names have "(Glass)" etc.
    const safe = token.replace(/[%,()]/g, "");
    if (!safe) continue;
    q = q.or(tokenOrCondition(safe, subtree));
  }
  const { data, error } = await q.order("name").limit(limit);
  if (error) throw error;

  return (data ?? []).map((it: any) => ({
    id: it.id as string,
    code: it.code as string,
    name: it.name as string,
    uom: (flatten<any>(it.uom)?.abbreviation as string) ?? "",
    sub_category: subtree.names[it.category_id as string] ?? null,
    total_stock: Array.isArray(it.inventory)
      ? it.inventory.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0)
      : 0,
  }));
}

/** Look up a single active item by exact name (case-insensitive). Used by the
 *  cabin-job form to auto-fill the matching "... Cover" when a Support is picked. */
export async function getCabinItemByName(
  name: string,
): Promise<CabinSearchItem | null> {
  const n = (name ?? "").trim();
  if (!n) return null;
  const supabase = createCacheClient();
  const { data } = await supabase
    .from("items")
    .select(`id, code, name, uom:units_of_measurement(abbreviation)`)
    .eq("is_active", true)
    .ilike("name", n)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: (data as any).id as string,
    code: (data as any).code as string,
    name: (data as any).name as string,
    uom: (flatten<any>((data as any).uom)?.abbreviation as string) ?? "",
    sub_category: null,
    total_stock: 0,
  };
}

/* ------------------------------------------------------------------ *
 * Two-step picker for finish-fanned types (Side Panel / Front Wall /
 * Car Linton). Items carry items.family (= base item) and items.finish.
 * Step 1 searches BASES; step 2 lists that base's finishes -> the exact
 * item_id. cabinType here is the INVENTORY type (caller maps RHS/LHS).
 * ------------------------------------------------------------------ */

export interface CabinBase {
  family: string;
  finish_count: number;
  total_stock: number;
  uom: string;
}

export async function searchCabinBases(
  query: string,
  cabinType: string,
  limit = 20,
): Promise<CabinBase[]> {
  const supabase = createCacheClient();
  const subtree = await getCabinSubtree(cabinType);
  if (subtree.ids.length === 0) return [];

  // No inventory join here: the base list only shows the finish count (stock
  // appears in the finish step). The join made every keystroke pull up to
  // 1,000 rows with stock arrays — the main reason these searches felt broken.
  // NOTE: items with NO family (manually added, e.g. "P6C 500") are included
  // and grouped under their own NAME as a single-finish base — otherwise
  // hand-added panels are unfindable in cabin jobs.
  let q = supabase
    .from("items")
    .select(`name, family, finish, uom:units_of_measurement(abbreviation)`)
    .eq("is_active", true)
    .in("category_id", subtree.ids);
  for (const token of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const safe = token.replace(/[%,()]/g, ""); // PostgREST-special chars
    if (!safe) continue;
    q = q.or(tokenOrCondition(safe, subtree, ["family"]));
  }
  const { data, error } = await q.limit(1000);
  if (error) throw error;

  const byFam = new Map<string, { uom: string; finishes: Set<string> }>();
  for (const it of (data ?? []) as any[]) {
    const fam = (it.family as string | null) ?? (it.name as string);
    const cur =
      byFam.get(fam) ??
      { uom: (flatten<any>(it.uom)?.abbreviation as string) ?? "", finishes: new Set<string>() };
    cur.finishes.add((it.finish as string | null) ?? " "); // null = the "no finish" variant
    byFam.set(fam, cur);
  }
  return [...byFam.entries()]
    .map(([family, v]) => ({
      family,
      finish_count: v.finishes.size,
      total_stock: 0, // not shown in the base list; per-finish stock loads in step 2
      uom: v.uom,
    }))
    .sort((a, b) => a.family.localeCompare(b.family))
    .slice(0, limit);
}

export interface CabinFinishOption {
  finish: string | null; // null = no finish (e.g. Granite type, not yet fanned)
  item_id: string;
  code: string;
  name: string;
  uom: string;
  total_stock: number;
}

export async function getCabinBaseFinishes(
  family: string,
  cabinType: string,
): Promise<CabinFinishOption[]> {
  const supabase = createCacheClient();
  if (!family) return [];
  const { ids } = await getCabinSubtree(cabinType);
  if (ids.length === 0) return [];
  // A "base" is either a real family OR a family-less item listed under its
  // own name (see searchCabinBases) — match both. Strip double quotes so the
  // quoted PostgREST values can't break.
  const safe = family.replace(/"/g, "");
  const { data, error } = await supabase
    .from("items")
    .select(`id, code, name, finish, uom:units_of_measurement(abbreviation), inventory(quantity)`)
    .eq("is_active", true)
    .in("category_id", ids)
    .or(`family.eq."${safe}",and(family.is.null,name.eq."${safe}")`);
  if (error) throw error;
  return ((data ?? []) as any[])
    .map((it) => ({
      finish: (it.finish as string | null) ?? null,
      item_id: it.id as string,
      code: it.code as string,
      name: it.name as string,
      uom: (flatten<any>(it.uom)?.abbreviation as string) ?? "",
      total_stock: Array.isArray(it.inventory)
        ? it.inventory.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0)
        : 0,
    }))
    .sort((a, b) => (a.finish ?? "").localeCompare(b.finish ?? ""));
}

export interface CabinJobListRow {
  id: string;
  job_number: string;
  customer_name: string | null;
  line_count: number;
  /** The job's Platform item name (its size/measurement), if one is added. */
  platform: string | null;
  /** Distinct Side Panel finishes for the job, e.g. "SS 430" or "MS + Golden". */
  side_panel_material: string | null;
  created_at: string;
}

export async function getCabinJobs(): Promise<CabinJobListRow[]> {
  const supabase = createCacheClient();
  const { data: jobs } = await supabase
    .from("cabin_jobs")
    .select("id, job_number, customer_name, created_at")
    .order("created_at", { ascending: false });
  const ids = (jobs ?? []).map((j: any) => j.id as string);
  const countByJob = new Map<string, number>();
  const platformByJob = new Map<string, string>();
  const finishesByJob = new Map<string, Set<string>>();
  if (ids.length) {
    const { data: lines } = await supabase
      .from("cabin_job_lines")
      .select(
        `cabin_job_id, cabin_type,
         item:items!cabin_job_lines_item_id_fkey(name, finish)`,
      )
      .in("cabin_job_id", ids);
    for (const l of lines ?? []) {
      const jid = l.cabin_job_id as string;
      countByJob.set(jid, (countByJob.get(jid) ?? 0) + 1);
      const it = flatten<any>((l as any).item);
      if (l.cabin_type === "Platform" && it?.name && !platformByJob.has(jid)) {
        platformByJob.set(jid, it.name as string);
      }
      if (l.cabin_type === "Side Panel" && it?.finish) {
        const set = finishesByJob.get(jid) ?? new Set<string>();
        set.add(it.finish as string);
        finishesByJob.set(jid, set);
      }
    }
  }
  return (jobs ?? []).map((j: any) => {
    const fset = finishesByJob.get(j.id as string);
    return {
      id: j.id as string,
      job_number: j.job_number as string,
      customer_name: (j.customer_name as string | null) ?? null,
      line_count: countByJob.get(j.id as string) ?? 0,
      platform: platformByJob.get(j.id as string) ?? null,
      side_panel_material: fset ? [...fset].sort().join(" + ") : null,
      created_at: j.created_at as string,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Cumulative requirement by sheet/plate finish across ALL cabin jobs.
 * Cabin panels carry items.finish (MS / SS 430 / Rose Gold / …); summing
 * cabin-job line qty per finish tells procurement how much sheet of each
 * finish is needed. Items with no finish (Canopy, un-fanned panels) are
 * grouped under a "(no finish set)" bucket so nothing is silently dropped.
 * ------------------------------------------------------------------ */
export interface CabinFinishJobQty {
  job_id: string;
  job_number: string;
  customer_name: string | null;
  qty: number;
}
export interface CabinFinishItem {
  item_id: string;
  code: string;
  name: string;
  family: string | null;
  cabin_type: string;
  qty: number;
  /** The cabin jobs that need this item, with each job's qty (hover breakdown). */
  jobs: CabinFinishJobQty[];
}
export interface CabinFinishGroup {
  /** null = no finish recorded on the item. */
  finish: string | null;
  total_qty: number;
  job_count: number;
  line_count: number;
  items: CabinFinishItem[];
}

export async function getCabinFinishRequirement(): Promise<CabinFinishGroup[]> {
  const supabase = createCacheClient();

  const lines = await fetchAllRanged<{
    cabin_job_id: string;
    cabin_type: string;
    item_id: string | null;
    qty: number;
  }>((from, to, withCount) =>
    supabase
      .from("cabin_job_lines")
      .select("cabin_job_id, cabin_type, item_id, qty", withCount ? { count: "exact" } : {})
      .not("item_id", "is", null)
      .range(from, to),
  );
  if (lines.length === 0) return [];

  const itemIds = [...new Set(lines.map((l) => l.item_id).filter((id): id is string => !!id))];
  const itemById = new Map<string, { code: string; name: string; family: string | null; finish: string | null }>();
  for (let i = 0; i < itemIds.length; i += 300) {
    const { data, error } = await supabase
      .from("items")
      .select("id, code, name, family, finish")
      .in("id", itemIds.slice(i, i + 300));
    if (error) throw error;
    for (const it of data ?? [])
      itemById.set(it.id as string, {
        code: it.code as string,
        name: it.name as string,
        family: (it.family as string | null) ?? null,
        finish: (it.finish as string | null) ?? null,
      });
  }

  // Cabin job metadata (for the per-item hover breakdown).
  const jobIds = [...new Set(lines.map((l) => l.cabin_job_id))];
  const jobMeta = new Map<string, { job_number: string; customer_name: string | null }>();
  for (let i = 0; i < jobIds.length; i += 300) {
    const { data } = await supabase
      .from("cabin_jobs")
      .select("id, job_number, customer_name")
      .in("id", jobIds.slice(i, i + 300));
    for (const j of data ?? [])
      jobMeta.set(j.id as string, {
        job_number: (j.job_number as string) ?? "",
        customer_name: (j.customer_name as string | null) ?? null,
      });
  }

  // finish key -> aggregate (qty summed per distinct item, tracking each job's qty).
  type AggItem = {
    item_id: string;
    code: string;
    name: string;
    family: string | null;
    cabin_type: string;
    qty: number;
    jobsQty: Map<string, number>;
  };
  const groups = new Map<
    string,
    { finish: string | null; jobs: Set<string>; lines: number; perItem: Map<string, AggItem> }
  >();
  // Owner rule: Canopy is always MS; Platform is always MS/GI. Existing items have
  // been set in the DB (migrations cabin_platform_canopy_finish_msgi +
  // cabin_canopy_finish_ms); this is the fallback so a newly-added Platform/Canopy
  // item with no finish yet still folds into the right material, not "(no finish set)".
  const TYPE_DEFAULT_FINISH: Record<string, string> = { Canopy: "MS", Platform: "MS/GI" };
  for (const l of lines) {
    if (!l.item_id) continue;
    const it = itemById.get(l.item_id);
    if (!it) continue;
    const effFinish = it.finish ?? TYPE_DEFAULT_FINISH[l.cabin_type] ?? null;
    const key = effFinish ?? "__none__";
    const g = groups.get(key) ?? { finish: effFinish, jobs: new Set<string>(), lines: 0, perItem: new Map() };
    g.jobs.add(l.cabin_job_id);
    g.lines += 1;
    const qty = Number(l.qty) || 0;
    const ex = g.perItem.get(l.item_id);
    if (ex) {
      ex.qty += qty;
      ex.jobsQty.set(l.cabin_job_id, (ex.jobsQty.get(l.cabin_job_id) ?? 0) + qty);
    } else {
      g.perItem.set(l.item_id, {
        item_id: l.item_id,
        code: it.code,
        name: it.name,
        family: it.family,
        cabin_type: l.cabin_type,
        qty,
        jobsQty: new Map([[l.cabin_job_id, qty]]),
      });
    }
    groups.set(key, g);
  }

  const toJobs = (jobsQty: Map<string, number>): CabinFinishJobQty[] =>
    [...jobsQty.entries()]
      .map(([job_id, qty]) => ({
        job_id,
        job_number: jobMeta.get(job_id)?.job_number ?? "—",
        customer_name: jobMeta.get(job_id)?.customer_name ?? null,
        qty,
      }))
      .sort((a, b) => b.qty - a.qty || a.job_number.localeCompare(b.job_number, undefined, { numeric: true }));

  return [...groups.values()]
    .map((g) => {
      const items: CabinFinishItem[] = [...g.perItem.values()]
        .map((it) => ({
          item_id: it.item_id,
          code: it.code,
          name: it.name,
          family: it.family,
          cabin_type: it.cabin_type,
          qty: it.qty,
          jobs: toJobs(it.jobsQty),
        }))
        .sort((a, b) => b.qty - a.qty);
      return {
        finish: g.finish,
        total_qty: items.reduce((s, x) => s + x.qty, 0),
        job_count: g.jobs.size,
        line_count: g.lines,
        items,
      };
    })
    .sort((a, b) => {
      // Real finishes by total qty desc; the "(no finish set)" bucket pinned last.
      if (a.finish === null) return 1;
      if (b.finish === null) return -1;
      return b.total_qty - a.total_qty;
    });
}

export interface CabinJobLine {
  id: string;
  cabin_type: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  item_family: string | null;
  uom: string | null;
  qty: number;
  sort_order: number;
}

export interface CabinJobDetail {
  id: string;
  job_number: string;
  customer_name: string | null;
  note: string | null;
  lines: CabinJobLine[];
}

export async function getCabinJob(id: string): Promise<CabinJobDetail | null> {
  if (!id) return null;
  const supabase = createCacheClient();
  const { data: job } = await supabase
    .from("cabin_jobs")
    .select("id, job_number, customer_name, note")
    .eq("id", id)
    .maybeSingle();
  if (!job) return null;

  const { data: lines } = await supabase
    .from("cabin_job_lines")
    .select(
      `id, cabin_type, item_id, qty, sort_order,
       item:items!cabin_job_lines_item_id_fkey(code, name, family, uom:units_of_measurement(abbreviation))`,
    )
    .eq("cabin_job_id", id)
    .order("sort_order");

  return {
    id: job.id as string,
    job_number: job.job_number as string,
    customer_name: (job.customer_name as string | null) ?? null,
    note: (job.note as string | null) ?? null,
    lines: (lines ?? []).map((l: any) => {
      const it = flatten<any>(l.item);
      return {
        id: l.id as string,
        cabin_type: l.cabin_type as string,
        item_id: (l.item_id as string | null) ?? null,
        item_code: (it?.code as string) ?? null,
        item_name: (it?.name as string) ?? null,
        item_family: (it?.family as string) ?? null,
        uom: (flatten<any>(it?.uom)?.abbreviation as string) ?? null,
        qty: Number(l.qty ?? 0),
        sort_order: Number(l.sort_order ?? 0),
      };
    }),
  };
}

export type CabinJobResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export interface CabinJobLineInput {
  cabin_type: string;
  item_id: string | null;
  qty: number;
}

function cleanLines(lines: CabinJobLineInput[]) {
  return lines
    .filter((l) => l.item_id && Number(l.qty) > 0)
    .map((l, i) => ({
      cabin_type: l.cabin_type,
      item_id: l.item_id,
      qty: Number(l.qty),
      sort_order: i,
    }));
}

export async function createCabinJob(input: {
  job_number: string;
  customer_name?: string | null;
  note?: string | null;
  lines: CabinJobLineInput[];
}): Promise<CabinJobResult> {
  const job_number = (input.job_number ?? "").trim();
  if (!job_number) return { ok: false, error: "Job number is required." };

  const supabase = await createClient();
  const { data: head, error } = await supabase
    .from("cabin_jobs")
    .insert({
      job_number,
      customer_name: input.customer_name?.trim() || null,
      note: input.note?.trim() || null,
    })
    .select("id")
    .single();
  if (error) {
    const msg =
      (error as any).code === "23505"
        ? `A cabin job with number "${job_number}" already exists.`
        : error.message;
    return { ok: false, error: msg };
  }

  const rows = cleanLines(input.lines).map((l) => ({
    ...l,
    cabin_job_id: head.id as string,
  }));
  if (rows.length > 0) {
    const { error: le } = await supabase.from("cabin_job_lines").insert(rows);
    if (le) {
      await supabase.from("cabin_jobs").delete().eq("id", head.id);
      return { ok: false, error: le.message };
    }
  }

  revalidatePath("/cabin-jobs");
  // The Job Orders plan board derives a "Cabin BOM" chip from these lines.
  revalidateTag("cabin-jobs");
  revalidatePath("/jobs");
  return { ok: true, id: head.id as string };
}

export async function updateCabinJob(
  id: string,
  input: {
    job_number: string;
    customer_name?: string | null;
    note?: string | null;
    lines: CabinJobLineInput[];
  },
): Promise<CabinJobResult> {
  if (!id) return { ok: false, error: "Missing cabin job id." };
  const job_number = (input.job_number ?? "").trim();
  if (!job_number) return { ok: false, error: "Job number is required." };

  const supabase = await createClient();
  // Only touch customer/note when explicitly provided — the form no longer asks
  // for them, so omitting must leave any existing values untouched.
  const payload: Record<string, unknown> = {
    job_number,
    updated_at: new Date().toISOString(),
  };
  if (input.customer_name !== undefined)
    payload.customer_name = input.customer_name?.trim() || null;
  if (input.note !== undefined) payload.note = input.note?.trim() || null;
  const { error: ue } = await supabase
    .from("cabin_jobs")
    .update(payload)
    .eq("id", id);
  if (ue) {
    const msg =
      (ue as any).code === "23505"
        ? `A cabin job with number "${job_number}" already exists.`
        : ue.message;
    return { ok: false, error: msg };
  }

  // Replace lines (form is source of truth).
  const { error: de } = await supabase
    .from("cabin_job_lines")
    .delete()
    .eq("cabin_job_id", id);
  if (de) return { ok: false, error: de.message };

  const rows = cleanLines(input.lines).map((l) => ({
    ...l,
    cabin_job_id: id,
  }));
  if (rows.length > 0) {
    const { error: le } = await supabase.from("cabin_job_lines").insert(rows);
    if (le) return { ok: false, error: le.message };
  }

  revalidatePath("/cabin-jobs");
  revalidatePath(`/cabin-jobs/${id}`);
  revalidateTag("cabin-jobs");
  revalidatePath("/jobs");
  return { ok: true, id };
}

export async function deleteCabinJob(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: "Missing id." };
  const supabase = await createClient();
  const { error } = await supabase.from("cabin_jobs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/cabin-jobs");
  revalidateTag("cabin-jobs");
  revalidatePath("/jobs");
  return { ok: true };
}
