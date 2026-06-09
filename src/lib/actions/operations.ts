"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import type { OperationMachine, OutputRole } from "@/lib/supabase/types";

/* ------------------------------------------------------------------ *
 * Operations catalog (production-visibility Phase 0).
 *
 * An operation is a program/recipe: one run consumes some raw items and
 * produces many parts at once (the nest). Phase 0 is catalog-only — no
 * inventory effects. Reads are cached under the "operations" tag; every
 * mutation revalidates it (plus /programs and /inventory, since the item
 * modal shows produced-by / consumed-by badges).
 * ------------------------------------------------------------------ */

/** A row in the Programs list. */
export interface OperationListRow {
  id: string;
  code: string | null;
  name: string;
  machine: OperationMachine;
  family_key: string | null;
  material_label: string | null;
  program_label: string | null;
  audited_at: string | null;
  input_count: number;
  output_count: number;
  /** Input lines already linked to an inventory item (item_id not null). */
  input_matched: number;
  /** Output lines already linked to an inventory item (item_id not null). */
  output_matched: number;
  /** Lowercased name+code+family+material plus all input/output item names &
   *  to-be-filled labels, so the list search can match inside a program. */
  search_text: string;
  is_active: boolean;
}

/**
 * One input/output line. When `item_id` is null the line is "to be filled":
 * `label` holds the captured original name and `item_code`/`item_name` are empty.
 */
export interface OperationLineDetail {
  id: string;
  item_id: string | null;
  label: string | null;
  item_code: string;
  item_name: string;
  uom: string;
  qty_per_run: number;
  notes: string | null;
  sort_order: number;
  /** Outputs only: component | cut_part | tooling | scrap. Inputs are always 'component'. */
  role: OutputRole;
}

/** Full operation with resolved input/output lines. */
export interface OperationDetail {
  id: string;
  code: string | null;
  name: string;
  machine: OperationMachine;
  family_key: string | null;
  material_label: string | null;
  audited_at: string | null;
  description: string | null;
  sketch_url: string | null;
  sketch_filename: string | null;
  sketch_uploaded_at: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  inputs: OperationLineDetail[];
  outputs: OperationLineDetail[];
}

/** A line as supplied by the form when saving an operation. */
export interface OperationLineInput {
  /** null = "to be filled" (no item chosen yet). */
  item_id: string | null;
  /** Captured original name for to-be-filled lines. */
  label?: string | null;
  qty_per_run: number;
  notes?: string | null;
  /** Outputs only: classification role. Ignored for inputs. */
  role?: OutputRole;
}

/**
 * Discriminated result so the form can surface real validation messages —
 * Next.js strips thrown-error messages from server actions in production.
 * (Same pattern as createItem/updateItem.)
 */
export type OperationSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** Lightweight operation reference for the item "produced/consumed by" widget. */
export interface ItemOperationRef {
  id: string;
  code: string | null;
  name: string;
  machine: OperationMachine;
  qty_per_run: number;
}

export interface ItemOperationsResult {
  produces: ItemOperationRef[];
  consumes: ItemOperationRef[];
}

/* ------------------------------ reads ------------------------------ */

const _getOperationsUncached = async (): Promise<OperationListRow[]> => {
  const supabase = createCacheClient();
  const { data, error } = await supabase
    .from("operations")
    .select(
      `id, code, name, machine, family_key, material_label, program_label, audited_at, is_active,
       operation_inputs(item_id, label, item:items(name)),
       operation_outputs(item_id, label, role, item:items(name))`,
    )
    .eq("is_active", true)
    .order("name");
  if (error) throw error;

  const partName = (r: any): string =>
    r.label || (Array.isArray(r.item) ? r.item[0]?.name : r.item?.name) || "";

  return (data ?? []).map((row: any) => {
    const ins = Array.isArray(row.operation_inputs) ? row.operation_inputs : [];
    const outs = Array.isArray(row.operation_outputs) ? row.operation_outputs : [];
    const search_text = [
      row.name,
      row.code,
      row.family_key,
      row.material_label,
      row.program_label,
      ...ins.map(partName),
      ...outs.map(partName),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return {
      id: row.id as string,
      code: (row.code as string | null) ?? null,
      name: row.name as string,
      machine: row.machine as OperationMachine,
      family_key: (row.family_key as string | null) ?? null,
      material_label: (row.material_label as string | null) ?? null,
      program_label: (row.program_label as string | null) ?? null,
      audited_at: (row.audited_at as string | null) ?? null,
      input_count: ins.length,
      output_count: outs.length,
      input_matched: ins.filter((r: any) => r.item_id).length,
      // An output is "resolved" if it's linked to an item OR intentionally not
      // an item (cut_part/tooling/scrap). Only unmapped 'component' outputs are
      // true gaps that still need an inventory item.
      output_matched: outs.filter(
        (r: any) => r.item_id || (r.role && r.role !== "component"),
      ).length,
      search_text,
      is_active: row.is_active as boolean,
    };
  });
};

export const getOperations = unstable_cache(
  _getOperationsUncached,
  ["operations-list"],
  { revalidate: 600, tags: ["operations"] },
);

const _getOperationDetailUncached = async (
  id: string,
): Promise<OperationDetail | null> => {
  const supabase = createCacheClient();
  const { data, error } = await supabase
    .from("operations")
    .select(
      `*,
       inputs:operation_inputs(
         id, item_id, label, qty_per_run, notes, sort_order,
         item:items(id, code, name, uom:units_of_measurement(abbreviation))
       ),
       outputs:operation_outputs(
         id, item_id, label, qty_per_run, notes, sort_order, role,
         item:items(id, code, name, uom:units_of_measurement(abbreviation))
       )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    code: data.code ?? null,
    name: data.name,
    machine: data.machine as OperationMachine,
    family_key: data.family_key ?? null,
    material_label: data.material_label ?? null,
    audited_at: data.audited_at ?? null,
    description: data.description ?? null,
    sketch_url: data.sketch_url ?? null,
    sketch_filename: data.sketch_filename ?? null,
    sketch_uploaded_at: data.sketch_uploaded_at ?? null,
    notes: data.notes ?? null,
    is_active: data.is_active,
    created_at: data.created_at,
    updated_at: data.updated_at,
    inputs: mapLines(data.inputs),
    outputs: mapLines(data.outputs),
  };
};

export async function getOperationDetail(
  id: string,
): Promise<OperationDetail | null> {
  const cached = unstable_cache(
    () => _getOperationDetailUncached(id),
    ["operation-detail", id],
    { revalidate: 600, tags: ["operations"] },
  );
  return cached();
}

const _getOperationsForItemUncached = async (
  itemId: string,
): Promise<ItemOperationsResult> => {
  const supabase = createCacheClient();
  const [outRes, inRes] = await Promise.all([
    supabase
      .from("operation_outputs")
      .select(
        `qty_per_run, operation:operations(id, code, name, machine, is_active)`,
      )
      .eq("item_id", itemId),
    supabase
      .from("operation_inputs")
      .select(
        `qty_per_run, operation:operations(id, code, name, machine, is_active)`,
      )
      .eq("item_id", itemId),
  ]);
  if (outRes.error) throw outRes.error;
  if (inRes.error) throw inRes.error;

  return {
    produces: mapItemOps(outRes.data),
    consumes: mapItemOps(inRes.data),
  };
};

export async function getOperationsForItem(
  itemId: string,
): Promise<ItemOperationsResult> {
  if (!itemId) return { produces: [], consumes: [] };
  const cached = unstable_cache(
    () => _getOperationsForItemUncached(itemId),
    ["operations-for-item", itemId],
    { revalidate: 600, tags: ["operations"] },
  );
  return cached();
}

/** A sibling program in the same family — a material/finish variant. */
export interface FamilyVariant {
  id: string;
  code: string | null;
  name: string;
  material_label: string | null;
  audited_at: string | null;
  input_count: number;
  input_matched: number;
  output_count: number;
  output_matched: number;
}

const _getFamilyVariantsUncached = async (
  familyKey: string,
): Promise<FamilyVariant[]> => {
  const supabase = createCacheClient();
  const { data, error } = await supabase
    .from("operations")
    .select(
      `id, code, name, material_label, audited_at,
       operation_inputs(item_id),
       operation_outputs(item_id)`,
    )
    .eq("is_active", true)
    .eq("family_key", familyKey)
    .order("material_label");
  if (error) throw error;

  return (data ?? []).map((row: any) => {
    const ins = Array.isArray(row.operation_inputs) ? row.operation_inputs : [];
    const outs = Array.isArray(row.operation_outputs)
      ? row.operation_outputs
      : [];
    return {
      id: row.id as string,
      code: (row.code as string | null) ?? null,
      name: row.name as string,
      material_label: (row.material_label as string | null) ?? null,
      audited_at: (row.audited_at as string | null) ?? null,
      input_count: ins.length,
      input_matched: ins.filter((r: any) => r.item_id).length,
      output_count: outs.length,
      output_matched: outs.filter((r: any) => r.item_id).length,
    };
  });
};

/**
 * Sibling material/finish variants of a program (same `family_key`). Returns
 * all active members of the family — the caller decides whether to highlight
 * or exclude the current one. Empty array when familyKey is null/blank.
 */
export async function getFamilyVariants(
  familyKey: string | null,
): Promise<FamilyVariant[]> {
  if (!familyKey || !familyKey.trim()) return [];
  const cached = unstable_cache(
    () => _getFamilyVariantsUncached(familyKey),
    ["operation-family", familyKey],
    { revalidate: 600, tags: ["operations"] },
  );
  return cached();
}

/** An existing family for the form's family-autocomplete. */
export interface FamilyOption {
  key: string;
  /** How many active programs already use this family. */
  count: number;
  /** Distinct material/finish labels seen in this family. */
  materials: string[];
}

const _getFamilyOptionsUncached = async (): Promise<FamilyOption[]> => {
  const supabase = createCacheClient();
  const { data, error } = await supabase
    .from("operations")
    .select("family_key, material_label")
    .eq("is_active", true)
    .not("family_key", "is", null);
  if (error) throw error;

  const map = new Map<string, { count: number; materials: Set<string> }>();
  for (const row of (data ?? []) as any[]) {
    const key = (row.family_key as string | null)?.trim();
    if (!key) continue;
    const entry = map.get(key) ?? { count: 0, materials: new Set<string>() };
    entry.count += 1;
    const mat = (row.material_label as string | null)?.trim();
    if (mat) entry.materials.add(mat);
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({
      key,
      count: v.count,
      materials: Array.from(v.materials).sort(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
};

/**
 * Distinct families (with counts + seen materials) for the program form's
 * family-autocomplete, so a manually-typed variant lands in an existing
 * family instead of creating a near-duplicate group from a typo.
 */
export const getFamilyOptions = unstable_cache(
  _getFamilyOptionsUncached,
  ["operation-family-options"],
  { revalidate: 600, tags: ["operations"] },
);

/* ---------------------------- mutations ---------------------------- */

export async function createOperation(input: {
  name: string;
  code?: string | null;
  machine?: OperationMachine;
  family_key?: string | null;
  material_label?: string | null;
  description?: string | null;
  notes?: string | null;
  inputs?: OperationLineInput[];
  outputs?: OperationLineInput[];
}): Promise<OperationSaveResult> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Program name is required." };

  const supabase = await createClient();
  const machine = input.machine ?? "cnc_cutting";
  const code = await resolveCode(supabase, input.code, name, null, machine);

  const { data: op, error } = await supabase
    .from("operations")
    .insert({
      name,
      code,
      machine,
      family_key: input.family_key?.trim() || null,
      material_label: input.material_label?.trim() || null,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateOperationError(error, code) };

  const operationId = op.id as string;
  const lineErr = await replaceLines(
    supabase,
    operationId,
    input.inputs,
    input.outputs,
  );
  if (lineErr) return { ok: false, error: lineErr };

  revalidateOperations(operationId);
  return { ok: true, id: operationId };
}

export async function updateOperation(
  id: string,
  input: {
    name: string;
    code?: string | null;
    machine?: OperationMachine;
    family_key?: string | null;
    material_label?: string | null;
    description?: string | null;
    notes?: string | null;
    inputs?: OperationLineInput[];
    outputs?: OperationLineInput[];
  },
): Promise<OperationSaveResult> {
  if (!id) return { ok: false, error: "Missing operation id." };
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Program name is required." };

  const supabase = await createClient();
  const machine = input.machine ?? "cnc_cutting";
  const code = await resolveCode(supabase, input.code, name, id, machine);

  const { error } = await supabase
    .from("operations")
    .update({
      name,
      code,
      machine,
      family_key: input.family_key?.trim() || null,
      material_label: input.material_label?.trim() || null,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: translateOperationError(error, code) };

  const lineErr = await replaceLines(
    supabase,
    id,
    input.inputs,
    input.outputs,
  );
  if (lineErr) return { ok: false, error: lineErr };

  revalidateOperations(id);
  return { ok: true, id };
}

/** Mark a program as audited (reviewed) or clear it. */
export async function setOperationAudited(
  id: string,
  audited: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: "Missing operation id." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("operations")
    .update({ audited_at: audited ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  // Auditing only flips a flag — it does NOT change any inventory item, so skip the
  // heavy /inventory revalidation that revalidateOperations() does (regenerating
  // that large page inside this action was crashing the function -> 503). Just
  // refresh the programs views.
  revalidateTag("operations");
  revalidatePath("/programs");
  revalidatePath(`/programs/${id}`);
  return { ok: true };
}

export type DeleteOperationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Hard delete — the CASCADE on operation_inputs/outputs cleans up the
 * lines. Also removes the sketch file from storage if present. (Phase 1
 * will switch this to a soft-delete once runs reference operations.)
 */
export async function deleteOperation(
  id: string,
): Promise<DeleteOperationResult> {
  if (!id) return { ok: false, error: "Missing operation id." };
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("operations")
    .select("sketch_url")
    .eq("id", id)
    .maybeSingle();
  const sketchUrl = (row?.sketch_url as string | null) ?? null;
  if (sketchUrl) {
    const path = extractStoragePath(sketchUrl);
    if (path) await supabase.storage.from(BUCKET).remove([path]);
  }

  const { error } = await supabase.from("operations").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateOperations(id);
  return { ok: true };
}

/* ----------------------------- sketches ---------------------------- */

const BUCKET = "program-sketches";
// Size/MIME are validated client-side before the direct-to-storage upload
// (see lib/storage/upload.ts); here we just sanity-check the filename extension.
const ALLOWED_EXTENSION = /\.(pdf|png|jpe?g|webp)$/i;

export interface ProgramSketchInfo {
  url: string;
  filename: string;
  uploaded_at: string;
}

/**
 * Record a sketch the browser has ALREADY uploaded directly to Storage
 * (see lib/storage/upload.ts). The file never passes through this server
 * function — only its storage object `path` — keeping us under serverless body
 * limits. Mirrors recordGadDrawing.
 */
export async function recordProgramSketch(
  operationId: string,
  path: string,
  filename: string,
): Promise<ProgramSketchInfo> {
  if (!operationId) throw new Error("Missing operationId");
  if (!path || !path.startsWith(`${operationId}/`)) {
    throw new Error("Invalid upload path");
  }
  if (!ALLOWED_EXTENSION.test(filename)) {
    throw new Error("Unsupported file type. Use PDF, PNG, JPG, or WebP.");
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("operations")
    .select("sketch_url")
    .eq("id", operationId)
    .maybeSingle();
  const previousUrl = (existing?.sketch_url as string | null) ?? null;
  if (previousUrl) {
    const previousPath = extractStoragePath(previousUrl);
    if (previousPath && previousPath !== path) {
      await supabase.storage.from(BUCKET).remove([previousPath]);
    }
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const uploaded_at = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("operations")
    .update({
      sketch_url: publicUrl,
      sketch_filename: filename,
      sketch_uploaded_at: uploaded_at,
    })
    .eq("id", operationId);
  if (updateError) throw updateError;

  revalidateOperations(operationId);
  return { url: publicUrl, filename, uploaded_at };
}

export async function deleteProgramSketch(operationId: string): Promise<void> {
  if (!operationId) throw new Error("Missing operationId");
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("operations")
    .select("sketch_url")
    .eq("id", operationId)
    .maybeSingle();
  const url = (row?.sketch_url as string | null) ?? null;
  if (url) {
    const path = extractStoragePath(url);
    if (path) await supabase.storage.from(BUCKET).remove([path]);
  }

  const { error } = await supabase
    .from("operations")
    .update({
      sketch_url: null,
      sketch_filename: null,
      sketch_uploaded_at: null,
    })
    .eq("id", operationId);
  if (error) throw error;

  revalidateOperations(operationId);
}

/* ----------------------------- helpers ----------------------------- */

type Db = Awaited<ReturnType<typeof createClient>>;

function revalidateOperations(id?: string) {
  revalidateTag("operations");
  revalidatePath("/programs");
  if (id) revalidatePath(`/programs/${id}`);
  // Item modal shows produced-by / consumed-by badges sourced from here.
  revalidatePath("/inventory");
}

/**
 * Delete all input/output lines for an operation and re-insert from the
 * picker — the form is the source of truth (same approach as saveBomSection).
 * Rows without an item or with a non-positive qty are dropped. Returns an
 * error string on failure, else null.
 */
async function replaceLines(
  supabase: Db,
  operationId: string,
  inputs?: OperationLineInput[],
  outputs?: OperationLineInput[],
): Promise<string | null> {
  const [delIn, delOut] = await Promise.all([
    supabase.from("operation_inputs").delete().eq("operation_id", operationId),
    supabase.from("operation_outputs").delete().eq("operation_id", operationId),
  ]);
  if (delIn.error) return delIn.error.message;
  if (delOut.error) return delOut.error.message;

  // Inputs have no role column; outputs carry the component/cut_part/tooling role.
  const inRows = cleanLines(operationId, inputs, false);
  const outRows = cleanLines(operationId, outputs, true);

  if (inRows.length > 0) {
    const { error } = await supabase.from("operation_inputs").insert(inRows);
    if (error) return error.message;
  }
  if (outRows.length > 0) {
    const { error } = await supabase.from("operation_outputs").insert(outRows);
    if (error) return error.message;
  }
  return null;
}

const VALID_OUTPUT_ROLES: OutputRole[] = ["component", "cut_part", "tooling", "scrap"];

function cleanLines(
  operationId: string,
  lines: OperationLineInput[] | undefined,
  includeRole: boolean,
) {
  return (lines ?? [])
    .filter(
      (l) =>
        (l.item_id || (l.label && l.label.trim())) &&
        Number(l.qty_per_run) > 0,
    )
    .map((l, idx) => {
      const base = {
        operation_id: operationId,
        item_id: l.item_id || null,
        label: l.label?.trim() || null,
        qty_per_run: Number(l.qty_per_run),
        notes: l.notes?.trim() || null,
        sort_order: idx,
      };
      if (!includeRole) return base;
      const role: OutputRole =
        l.role && VALID_OUTPUT_ROLES.includes(l.role) ? l.role : "component";
      return { ...base, role };
    });
}

/**
 * Decide the code to store. If the user typed one, use it (trimmed).
 * Otherwise auto-derive `CNC-<SLUG>` from the name and append -2, -3, …
 * until it's free. `excludeId` lets an update keep its own code.
 */
async function resolveCode(
  supabase: Db,
  provided: string | null | undefined,
  name: string,
  excludeId: string | null,
  machine: OperationMachine,
): Promise<string | null> {
  const typed = provided?.trim();
  if (typed) return typed;

  const base = slugifyCode(name, machine === "assembly_fit" ? "ASM" : "CNC");
  if (!base) return null;

  let candidate = base;
  let n = 1;
  // Bounded loop — catalog is small; this just avoids auto-derived clashes.
  while (n < 50) {
    let q = supabase.from("operations").select("id").eq("code", candidate);
    if (excludeId) q = q.neq("id", excludeId);
    const { data } = await q.maybeSingle();
    if (!data) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
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

function translateOperationError(
  error: { code?: string; message: string },
  attemptedCode?: string | null,
): string {
  if (error.code === "23505") {
    return attemptedCode
      ? `Program code "${attemptedCode}" already exists. Pick a different code.`
      : "A program with this code already exists.";
  }
  if (error.code === "23514") {
    return "A value failed validation: " + error.message;
  }
  return error.message;
}

/** Flatten a PostgREST belongsTo relation that may be `{...}` or `[{...}]`. */
function flatten<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return (rel[0] as T) ?? null;
  return (rel as T) ?? null;
}

function mapLines(rows: any): OperationLineDetail[] {
  return (Array.isArray(rows) ? rows : [])
    .map((r: any) => {
      const item = flatten<any>(r.item);
      const uom = flatten<any>(item?.uom);
      return {
        id: r.id as string,
        item_id: (r.item_id as string | null) ?? null,
        label: (r.label as string | null) ?? null,
        item_code: (item?.code as string) ?? "",
        item_name: (item?.name as string) ?? "",
        uom: (uom?.abbreviation as string) ?? "",
        qty_per_run: Number(r.qty_per_run ?? 0),
        notes: (r.notes as string | null) ?? null,
        sort_order: Number(r.sort_order ?? 0),
        role: ((r.role as OutputRole | null) ?? "component") as OutputRole,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}

function mapItemOps(rows: any): ItemOperationRef[] {
  return (Array.isArray(rows) ? rows : [])
    .map((r: any) => {
      const op = flatten<any>(r.operation);
      if (!op || op.is_active === false) return null;
      return {
        id: op.id as string,
        code: (op.code as string | null) ?? null,
        name: op.name as string,
        machine: op.machine as OperationMachine,
        qty_per_run: Number(r.qty_per_run ?? 0),
      };
    })
    .filter((x): x is ItemOperationRef => x !== null);
}

/**
 * Public storage URL → object path (`<operationId>/<file>`), or null if it
 * isn't one of ours.
 */
function extractStoragePath(url: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}
