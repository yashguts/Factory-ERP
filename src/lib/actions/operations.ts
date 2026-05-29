"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import type { OperationMachine } from "@/lib/supabase/types";

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
  input_count: number;
  output_count: number;
  is_active: boolean;
}

/** One input/output line with its item resolved for display. */
export interface OperationLineDetail {
  id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  uom: string;
  qty_per_run: number;
  notes: string | null;
  sort_order: number;
}

/** Full operation with resolved input/output lines. */
export interface OperationDetail {
  id: string;
  code: string | null;
  name: string;
  machine: OperationMachine;
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
  item_id: string;
  qty_per_run: number;
  notes?: string | null;
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
      `id, code, name, machine, is_active,
       operation_inputs(count),
       operation_outputs(count)`,
    )
    .eq("is_active", true)
    .order("name");
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id as string,
    code: (row.code as string | null) ?? null,
    name: row.name as string,
    machine: row.machine as OperationMachine,
    input_count: countOf(row.operation_inputs),
    output_count: countOf(row.operation_outputs),
    is_active: row.is_active as boolean,
  }));
};

export const getOperations = unstable_cache(
  _getOperationsUncached,
  ["operations-list"],
  { revalidate: 60, tags: ["operations"] },
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
         id, item_id, qty_per_run, notes, sort_order,
         item:items(id, code, name, uom:units_of_measurement(abbreviation))
       ),
       outputs:operation_outputs(
         id, item_id, qty_per_run, notes, sort_order,
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
    { revalidate: 60, tags: ["operations"] },
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
    { revalidate: 60, tags: ["operations"] },
  );
  return cached();
}

/* ---------------------------- mutations ---------------------------- */

export async function createOperation(input: {
  name: string;
  code?: string | null;
  machine?: OperationMachine;
  description?: string | null;
  notes?: string | null;
  inputs?: OperationLineInput[];
  outputs?: OperationLineInput[];
}): Promise<OperationSaveResult> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Program name is required." };

  const supabase = await createClient();
  const code = await resolveCode(supabase, input.code, name, null);

  const { data: op, error } = await supabase
    .from("operations")
    .insert({
      name,
      code,
      machine: input.machine ?? "cnc_cutting",
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
  const code = await resolveCode(supabase, input.code, name, id);

  const { error } = await supabase
    .from("operations")
    .update({
      name,
      code,
      machine: input.machine ?? "cnc_cutting",
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
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export interface ProgramSketchInfo {
  url: string;
  filename: string;
  uploaded_at: string;
}

/**
 * Upload (or replace) the sketch for an operation. Mirrors uploadGadDrawing:
 * stores at `{operationId}/{timestamp}-{name}` and deletes the previous file
 * on replace.
 */
export async function uploadProgramSketch(
  formData: FormData,
): Promise<ProgramSketchInfo> {
  const operationId = formData.get("operationId");
  const file = formData.get("file");

  if (typeof operationId !== "string" || !operationId) {
    throw new Error("Missing operationId");
  }
  if (!(file instanceof File)) throw new Error("Missing file");
  if (file.size === 0) throw new Error("File is empty");
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(
      `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 50 MB.`,
    );
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error(
      `Unsupported file type "${file.type}". Use PDF, PNG, JPG, or WebP.`,
    );
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
    if (previousPath) await supabase.storage.from(BUCKET).remove([previousPath]);
  }

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${operationId}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const uploaded_at = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("operations")
    .update({
      sketch_url: publicUrl,
      sketch_filename: file.name,
      sketch_uploaded_at: uploaded_at,
    })
    .eq("id", operationId);
  if (updateError) throw updateError;

  revalidateOperations(operationId);
  return { url: publicUrl, filename: file.name, uploaded_at };
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

  const inRows = cleanLines(operationId, inputs);
  const outRows = cleanLines(operationId, outputs);

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

function cleanLines(operationId: string, lines?: OperationLineInput[]) {
  return (lines ?? [])
    .filter((l) => l.item_id && Number(l.qty_per_run) > 0)
    .map((l, idx) => ({
      operation_id: operationId,
      item_id: l.item_id,
      qty_per_run: Number(l.qty_per_run),
      notes: l.notes?.trim() || null,
      sort_order: idx,
    }));
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
): Promise<string | null> {
  const typed = provided?.trim();
  if (typed) return typed;

  const base = slugifyCode(name);
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

function slugifyCode(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug ? `CNC-${slug}` : "";
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

function countOf(rel: unknown): number {
  if (Array.isArray(rel)) {
    return Number((rel[0] as { count?: number } | undefined)?.count ?? 0);
  }
  return 0;
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
        item_id: r.item_id as string,
        item_code: (item?.code as string) ?? "",
        item_name: (item?.name as string) ?? "(unknown item)",
        uom: (uom?.abbreviation as string) ?? "",
        qty_per_run: Number(r.qty_per_run ?? 0),
        notes: (r.notes as string | null) ?? null,
        sort_order: Number(r.sort_order ?? 0),
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
