"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidatePath } from "next/cache";
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

async function cabinCategoryIds(
  supabase: ReturnType<typeof createCacheClient>,
  cabinType?: string | null,
): Promise<{ ids: string[]; nameById: Map<string, string> }> {
  const { data: cats } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  const list = (cats ?? []) as any[];
  const nameById = new Map<string, string>(list.map((c) => [c.id, c.name]));
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
  if (!cabinRoot) return { ids: [], nameById };

  let roots: string[];
  if (cabinType) {
    const typeCat = list.find(
      (c) => c.name === cabinType && c.parent_id === cabinRoot.id,
    );
    if (!typeCat) return { ids: [], nameById };
    roots = [typeCat.id];
  } else {
    roots = [cabinRoot.id];
  }
  const ids: string[] = [];
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop() as string;
    ids.push(id);
    for (const ch of childrenOf.get(id) ?? []) stack.push(ch);
  }
  return { ids, nameById };
}

export interface CabinSearchItem {
  id: string;
  code: string;
  name: string;
  uom: string;
  sub_category: string | null;
}

export async function searchCabinItems(
  query: string,
  cabinType?: string | null,
  limit = 20,
): Promise<CabinSearchItem[]> {
  const supabase = createCacheClient();
  const { ids, nameById } = await cabinCategoryIds(supabase, cabinType);
  if (ids.length === 0) return [];

  let q = supabase
    .from("items")
    .select(
      `id, code, name, category_id, uom:units_of_measurement(abbreviation)`,
    )
    .eq("is_active", true)
    .in("category_id", ids);

  for (const token of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const safe = token.replace(/[%,]/g, "");
    q = q.or(`name.ilike.%${safe}%,code.ilike.%${safe}%`);
  }
  const { data, error } = await q.order("name").limit(limit);
  if (error) throw error;

  return (data ?? []).map((it: any) => ({
    id: it.id as string,
    code: it.code as string,
    name: it.name as string,
    uom: (flatten<any>(it.uom)?.abbreviation as string) ?? "",
    sub_category: nameById.get(it.category_id as string) ?? null,
  }));
}

export interface CabinJobListRow {
  id: string;
  job_number: string;
  customer_name: string | null;
  line_count: number;
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
  if (ids.length) {
    const { data: lines } = await supabase
      .from("cabin_job_lines")
      .select("cabin_job_id")
      .in("cabin_job_id", ids);
    for (const l of lines ?? [])
      countByJob.set(
        l.cabin_job_id as string,
        (countByJob.get(l.cabin_job_id as string) ?? 0) + 1,
      );
  }
  return (jobs ?? []).map((j: any) => ({
    id: j.id as string,
    job_number: j.job_number as string,
    customer_name: (j.customer_name as string | null) ?? null,
    line_count: countByJob.get(j.id as string) ?? 0,
    created_at: j.created_at as string,
  }));
}

export interface CabinJobLine {
  id: string;
  cabin_type: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
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
       item:items!cabin_job_lines_item_id_fkey(code, name, uom:units_of_measurement(abbreviation))`,
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
  const { error: ue } = await supabase
    .from("cabin_jobs")
    .update({
      job_number,
      customer_name: input.customer_name?.trim() || null,
      note: input.note?.trim() || null,
      updated_at: new Date().toISOString(),
    })
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
  return { ok: true };
}
