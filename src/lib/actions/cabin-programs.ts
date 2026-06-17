"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import {
  CABIN_PROGRAM_CATEGORIES,
  sheetThicknessMm,
  type CabinProgramCategory,
} from "@/lib/cabin/cabin-program-meta";

/* ------------------------------------------------------------------ *
 * Cabin Item Programs — a single cutting program (one nest) that can be
 * cut in many finishes. The finish dimension lives in cabin_program_finishes
 * (no per-finish duplication). Outputs name a finish-varying cabin family OR a
 * fixed item; the Cabin MRP resolves a demanded finish to its concrete panel
 * item + the sheet of that finish at plan time. NOTE: this is a "use server"
 * module — only async functions may be exported. Constants + sync helpers live
 * in cabin-program-meta.ts.
 * ------------------------------------------------------------------ */

type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createCacheClient>;

function flatten<T>(rel: unknown): T | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return (rel[0] ?? null) as T | null;
  return rel as T;
}

function slugifyCode(name: string, prefix: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug ? `${prefix}-${slug}` : "";
}

async function resolveCabinCode(
  supabase: Db,
  provided: string | null | undefined,
  name: string,
  excludeId: string | null,
): Promise<string | null> {
  const typed = provided?.trim();
  if (typed) return typed;
  const base = slugifyCode(name, "CAB");
  if (!base) return null;
  let candidate = base;
  let n = 1;
  while (n < 50) {
    let q = supabase.from("cabin_programs").select("id").eq("code", candidate);
    if (excludeId) q = q.neq("id", excludeId);
    const { data } = await q.maybeSingle();
    if (!data) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

/* ============================ Types ============================ */

export interface CabinProgramListRow {
  id: string;
  name: string;
  code: string | null;
  category: CabinProgramCategory;
  machine: string | null;
  audited: boolean;
  finish_count: number;
  output_count: number;
  input_sheet_name: string | null;
  thickness_mm: number | null;
}

export interface CabinProgramOutputDetail {
  id: string;
  item_id: string | null;
  code: string | null;
  name: string | null;
  family: string | null;
  cabin_type: string | null;
  label: string | null;
  qty_per_run: number;
  uom: string | null;
  /** True when this output varies by finish (it has a panel family). */
  finish_varying: boolean;
}

export interface CabinProgramDetail {
  id: string;
  name: string;
  code: string | null;
  category: CabinProgramCategory;
  machine: string | null;
  input_sheet_item_id: string | null;
  input_sheet_code: string | null;
  input_sheet_name: string | null;
  thickness_mm: number | null;
  sheets_per_run: number;
  machining_time_seconds: number | null;
  audited_at: string | null;
  sketch_url: string | null;
  sketch_filename: string | null;
  sketch_uploaded_at: string | null;
  description: string | null;
  notes: string | null;
  finishes: string[];
  outputs: CabinProgramOutputDetail[];
}

export interface CabinProgramOutputInput {
  item_id: string | null;
  family?: string | null;
  cabin_type?: string | null;
  label?: string | null;
  qty_per_run: number;
}

export interface CabinProgramFormInput {
  name: string;
  code?: string | null;
  category: CabinProgramCategory;
  machine?: string | null;
  input_sheet_item_id?: string | null;
  sheets_per_run?: number;
  machining_time_seconds?: number | null;
  description?: string | null;
  notes?: string | null;
  finishes: string[];
  outputs: CabinProgramOutputInput[];
}

export type CabinProgramResult = { ok: true; id: string } | { ok: false; error: string };

/* ============================ Reads ============================ */

const _getCabinProgramsUncached = async (): Promise<CabinProgramListRow[]> => {
  const supabase = createCacheClient();
  const { data: progs, error } = await supabase
    .from("cabin_programs")
    .select(`*, input_sheet:items!cabin_programs_input_sheet_item_id_fkey(code, name)`)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const ids = (progs ?? []).map((p: any) => p.id as string);
  const outCount = new Map<string, number>();
  const finCount = new Map<string, number>();
  if (ids.length) {
    const [{ data: outs }, { data: fins }] = await Promise.all([
      supabase.from("cabin_program_outputs").select("cabin_program_id").in("cabin_program_id", ids),
      supabase.from("cabin_program_finishes").select("cabin_program_id").in("cabin_program_id", ids),
    ]);
    for (const o of outs ?? []) outCount.set(o.cabin_program_id as string, (outCount.get(o.cabin_program_id as string) ?? 0) + 1);
    for (const f of fins ?? []) finCount.set(f.cabin_program_id as string, (finCount.get(f.cabin_program_id as string) ?? 0) + 1);
  }

  return (progs ?? []).map((p: any) => {
    const sheet = flatten<{ code: string; name: string }>(p.input_sheet);
    return {
      id: p.id as string,
      name: p.name as string,
      code: (p.code as string | null) ?? null,
      category: p.category as CabinProgramCategory,
      machine: (p.machine as string | null) ?? null,
      audited: p.audited_at != null,
      finish_count: finCount.get(p.id as string) ?? 0,
      output_count: outCount.get(p.id as string) ?? 0,
      input_sheet_name: sheet?.name ?? null,
      thickness_mm: sheetThicknessMm(sheet?.name),
    };
  });
};

export const getCabinPrograms = unstable_cache(_getCabinProgramsUncached, ["cabin-programs-list"], {
  revalidate: 300,
  tags: ["cabin-programs"],
});

export async function getCabinProgramDetail(id: string): Promise<CabinProgramDetail | null> {
  if (!id) return null;
  const supabase = createCacheClient();
  const { data: p } = await supabase
    .from("cabin_programs")
    .select(`*, input_sheet:items!cabin_programs_input_sheet_item_id_fkey(code, name)`)
    .eq("id", id)
    .maybeSingle();
  if (!p) return null;

  const [{ data: outs }, { data: fins }] = await Promise.all([
    supabase
      .from("cabin_program_outputs")
      .select(`*, item:items!cabin_program_outputs_item_id_fkey(code, name, uom:units_of_measurement!items_uom_id_fkey(abbreviation))`)
      .eq("cabin_program_id", id)
      .order("sort_order"),
    supabase.from("cabin_program_finishes").select("finish").eq("cabin_program_id", id),
  ]);

  const sheet = flatten<{ code: string; name: string }>((p as any).input_sheet);
  return {
    id: p.id as string,
    name: p.name as string,
    code: (p.code as string | null) ?? null,
    category: p.category as CabinProgramCategory,
    machine: (p.machine as string | null) ?? null,
    input_sheet_item_id: (p.input_sheet_item_id as string | null) ?? null,
    input_sheet_code: sheet?.code ?? null,
    input_sheet_name: sheet?.name ?? null,
    thickness_mm: sheetThicknessMm(sheet?.name),
    sheets_per_run: Number(p.sheets_per_run ?? 1),
    machining_time_seconds: (p.machining_time_seconds as number | null) ?? null,
    audited_at: (p.audited_at as string | null) ?? null,
    sketch_url: (p.sketch_url as string | null) ?? null,
    sketch_filename: (p.sketch_filename as string | null) ?? null,
    sketch_uploaded_at: (p.sketch_uploaded_at as string | null) ?? null,
    description: (p.description as string | null) ?? null,
    notes: (p.notes as string | null) ?? null,
    finishes: (fins ?? []).map((f: any) => f.finish as string).sort(),
    outputs: (outs ?? []).map((o: any) => {
      const it = flatten<any>(o.item);
      return {
        id: o.id as string,
        item_id: (o.item_id as string | null) ?? null,
        code: (it?.code as string) ?? null,
        name: (it?.name as string) ?? (o.label as string) ?? null,
        family: (o.family as string | null) ?? null,
        cabin_type: (o.cabin_type as string | null) ?? null,
        label: (o.label as string | null) ?? null,
        qty_per_run: Number(o.qty_per_run ?? 1),
        uom: (flatten<any>(it?.uom)?.abbreviation as string) ?? null,
        finish_varying: !!(o.family as string | null),
      };
    }),
  };
}

/* ============================ Search ============================ */

export interface SheetSearchItem {
  id: string;
  code: string;
  name: string;
  category: string | null;
  thickness_mm: number | null;
  total_stock: number;
}

/** Raw-material sheet/plate items for the program input picker. */
export async function searchSheetItems(query: string, limit = 20): Promise<SheetSearchItem[]> {
  const supabase = createCacheClient();
  let q = supabase
    .from("items")
    .select(`id, code, name, category:item_categories!items_category_id_fkey(name), inventory(quantity)`)
    .eq("is_active", true)
    .eq("item_type", "raw_material");
  for (const token of (query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const safe = token.replace(/[%,()]/g, "");
    if (!safe) continue;
    q = q.or(`name.ilike.%${safe}%,code.ilike.%${safe}%`);
  }
  const { data, error } = await q.order("name").limit(limit);
  if (error) throw error;
  return (data ?? []).map((it: any) => ({
    id: it.id as string,
    code: it.code as string,
    name: it.name as string,
    category: flatten<any>(it.category)?.name ?? null,
    thickness_mm: sheetThicknessMm(it.name),
    total_stock: Array.isArray(it.inventory) ? it.inventory.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0) : 0,
  }));
}

export interface OutputSearchItem {
  id: string;
  code: string;
  name: string;
  family: string | null;
  finish: string | null;
  category: string | null;
  item_type: string;
}

/** Combined output search across BOTH normal Inventory and Cabin Inventory items.
 *  An item with a `family` is treated as finish-varying on the form. */
export async function searchCabinProgramOutputs(query: string, limit = 20): Promise<OutputSearchItem[]> {
  const supabase = createCacheClient();
  let q = supabase
    .from("items")
    .select(`id, code, name, family, finish, item_type, category:item_categories!items_category_id_fkey(name)`)
    .eq("is_active", true);
  for (const token of (query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const safe = token.replace(/[%,()]/g, "");
    if (!safe) continue;
    q = q.or(`name.ilike.%${safe}%,code.ilike.%${safe}%,family.ilike.%${safe}%`);
  }
  const { data, error } = await q.order("name").limit(limit);
  if (error) throw error;
  return (data ?? []).map((it: any) => ({
    id: it.id as string,
    code: it.code as string,
    name: it.name as string,
    family: (it.family as string | null) ?? null,
    finish: (it.finish as string | null) ?? null,
    category: flatten<any>(it.category)?.name ?? null,
    item_type: it.item_type as string,
  }));
}

/* ============================ Mutations ============================ */

function cleanOutputs(programId: string, outputs: CabinProgramOutputInput[] | undefined) {
  return (outputs ?? [])
    .filter((o) => (o.item_id || (o.label && o.label.trim())) && Number(o.qty_per_run) > 0)
    .map((o, idx) => ({
      cabin_program_id: programId,
      item_id: o.item_id || null,
      family: o.family?.trim() || null,
      cabin_type: o.cabin_type?.trim() || null,
      label: o.label?.trim() || null,
      qty_per_run: Number(o.qty_per_run),
      sort_order: idx,
    }));
}

async function replaceChildren(
  supabase: Awaited<ReturnType<typeof createClient>>,
  programId: string,
  outputs: CabinProgramOutputInput[],
  finishes: string[],
): Promise<{ error: string | null }> {
  await supabase.from("cabin_program_outputs").delete().eq("cabin_program_id", programId);
  await supabase.from("cabin_program_finishes").delete().eq("cabin_program_id", programId);

  const outRows = cleanOutputs(programId, outputs);
  if (outRows.length) {
    const { error } = await supabase.from("cabin_program_outputs").insert(outRows);
    if (error) return { error: error.message };
  }
  const finRows = [...new Set((finishes ?? []).map((f) => f.trim()).filter(Boolean))].map((finish) => ({
    cabin_program_id: programId,
    finish,
  }));
  if (finRows.length) {
    const { error } = await supabase.from("cabin_program_finishes").insert(finRows);
    if (error) return { error: error.message };
  }
  return { error: null };
}

function validate(input: CabinProgramFormInput): string | null {
  if (!input.name?.trim()) return "Program name is required.";
  if (!CABIN_PROGRAM_CATEGORIES.includes(input.category)) return "Pick a program category.";
  if (!input.finishes || input.finishes.length === 0) return "Pick at least one finish this program is cut in.";
  if (!input.outputs?.some((o) => o.item_id || o.label?.trim())) return "Add at least one output.";
  return null;
}

export async function createCabinProgram(input: CabinProgramFormInput): Promise<CabinProgramResult> {
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const supabase = await createClient();
  const code = await resolveCabinCode(supabase, input.code, input.name.trim(), null);
  const { data: head, error } = await supabase
    .from("cabin_programs")
    .insert({
      name: input.name.trim(),
      code,
      category: input.category,
      machine: input.machine?.trim() || null,
      input_sheet_item_id: input.input_sheet_item_id || null,
      sheets_per_run: input.sheets_per_run && input.sheets_per_run > 0 ? input.sheets_per_run : 1,
      machining_time_seconds: input.machining_time_seconds ?? null,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();
  if (error) {
    return { ok: false, error: (error as any).code === "23505" ? `Code "${code}" already exists.` : error.message };
  }

  const r = await replaceChildren(supabase, head.id as string, input.outputs, input.finishes);
  if (r.error) {
    await supabase.from("cabin_programs").delete().eq("id", head.id);
    return { ok: false, error: r.error };
  }
  revalidateTag("cabin-programs");
  revalidatePath("/cabin-programs");
  return { ok: true, id: head.id as string };
}

export async function updateCabinProgram(id: string, input: CabinProgramFormInput): Promise<CabinProgramResult> {
  if (!id) return { ok: false, error: "Missing program id." };
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const supabase = await createClient();
  const code = await resolveCabinCode(supabase, input.code, input.name.trim(), id);
  const { error } = await supabase
    .from("cabin_programs")
    .update({
      name: input.name.trim(),
      code,
      category: input.category,
      machine: input.machine?.trim() || null,
      input_sheet_item_id: input.input_sheet_item_id || null,
      sheets_per_run: input.sheets_per_run && input.sheets_per_run > 0 ? input.sheets_per_run : 1,
      machining_time_seconds: input.machining_time_seconds ?? null,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    return { ok: false, error: (error as any).code === "23505" ? `Code "${code}" already exists.` : error.message };
  }

  const r = await replaceChildren(supabase, id, input.outputs, input.finishes);
  if (r.error) return { ok: false, error: r.error };
  revalidateTag("cabin-programs");
  revalidatePath("/cabin-programs");
  revalidatePath(`/cabin-programs/${id}`);
  return { ok: true, id };
}

export async function setCabinProgramAudited(id: string, audited: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: "Missing id." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cabin_programs")
    .update({ audited_at: audited ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateTag("cabin-programs");
  revalidatePath("/cabin-programs");
  revalidatePath(`/cabin-programs/${id}`);
  return { ok: true };
}

export async function deleteCabinProgram(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: "Missing id." };
  const supabase = await createClient();
  const { error } = await supabase.from("cabin_programs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateTag("cabin-programs");
  revalidatePath("/cabin-programs");
  return { ok: true };
}
