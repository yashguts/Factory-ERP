"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { dispatchPhaseOf, type DispatchPhase } from "@/lib/bom/bom-sections";

/* ------------------------------------------------------------------ *
 * Job dispatch.
 *
 * A job ships in one or more dispatches over time: first phase early,
 * second phase later, sometimes partial quantities, sometimes the whole
 * job at once. Each dispatch is a dated event with line items; the actual
 * item/qty sent can differ from the job's BOM, so dispatch lines are
 * editable and tracked independently. "Remaining" per BOM line =
 * required − sum(all dispatched against that line).
 *
 * Phase 0: NO inventory effect (stock is managed by another team). We only
 * record what went out. Inventory deduction can be layered on later.
 * ------------------------------------------------------------------ */

export type PhaseScope = "first" | "second" | "full";

function flatten<T>(rel: unknown): T | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return (rel[0] ?? null) as T | null;
  return rel as T;
}

/** A job BOM line with its running dispatch state (for the dispatch picker). */
export interface DispatchSummaryLine {
  job_bom_line_id: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  uom: string | null;
  category: string;
  phase: DispatchPhase;
  required: number;
  dispatched: number; // cumulative across all prior dispatches
  remaining: number;
}

export interface DispatchHistoryLine {
  id: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  label: string | null;
  category: string | null;
  phase: DispatchPhase;
  qty: number;
  /** True when this line was not tied to a BOM line (added at dispatch time). */
  adhoc: boolean;
}

export interface DispatchHistory {
  id: string;
  dispatch_date: string;
  phase_scope: PhaseScope;
  note: string | null;
  created_at: string;
  lines: DispatchHistoryLine[];
}

export interface JobDispatchSummary {
  lines: DispatchSummaryLine[];
  dispatches: DispatchHistory[];
}

export async function getJobDispatchSummary(
  jobId: string,
): Promise<JobDispatchSummary> {
  const supabase = await createClient();

  // BOM lines (item-based, real sections) for the job.
  const { data: header } = await supabase
    .from("job_bom_headers")
    .select("id")
    .eq("job_id", jobId)
    .limit(1)
    .maybeSingle();

  let lines: DispatchSummaryLine[] = [];
  if (header) {
    const { data: bl, error } = await supabase
      .from("job_bom_lines")
      .select(
        `id, category, required_quantity, item_id,
         item:items!job_bom_lines_item_id_fkey(code, name, uom:units_of_measurement(abbreviation))`,
      )
      .eq("job_bom_id", header.id)
      .not("category", "is", null)
      .order("sort_order");
    if (error) throw error;
    lines = (bl ?? []).map((r: any) => {
      const it = flatten<any>(r.item);
      const uom = it ? flatten<any>(it.uom) : null;
      const category = (r.category as string) ?? "";
      const required = Number(r.required_quantity ?? 0);
      return {
        job_bom_line_id: r.id as string,
        item_id: (r.item_id as string | null) ?? null,
        item_code: (it?.code as string) ?? null,
        item_name: (it?.name as string) ?? null,
        uom: (uom?.abbreviation as string) ?? null,
        category,
        phase: dispatchPhaseOf(category),
        required,
        dispatched: 0,
        remaining: required,
      };
    });
  }

  // Dispatch events + their lines.
  const { data: disp } = await supabase
    .from("job_dispatches")
    .select("id, dispatch_date, phase_scope, note, created_at")
    .eq("job_id", jobId)
    .order("dispatch_date", { ascending: false })
    .order("created_at", { ascending: false });
  const dispatchIds = (disp ?? []).map((d: any) => d.id as string);

  let dlines: any[] = [];
  if (dispatchIds.length > 0) {
    const { data: dl } = await supabase
      .from("job_dispatch_lines")
      .select(
        `id, dispatch_id, job_bom_line_id, item_id, category, label, qty,
         item:items!job_dispatch_lines_item_id_fkey(code, name)`,
      )
      .in("dispatch_id", dispatchIds);
    dlines = dl ?? [];
  }

  // Cumulative dispatched per BOM line → fill remaining.
  const byLine = new Map<string, number>();
  for (const d of dlines) {
    if (d.job_bom_line_id)
      byLine.set(
        d.job_bom_line_id,
        (byLine.get(d.job_bom_line_id) ?? 0) + Number(d.qty),
      );
  }
  for (const ln of lines) {
    ln.dispatched = byLine.get(ln.job_bom_line_id) ?? 0;
    ln.remaining = Math.max(0, ln.required - ln.dispatched);
  }

  // History, grouped by dispatch.
  const linesByDispatch = new Map<string, DispatchHistoryLine[]>();
  for (const d of dlines) {
    const it = flatten<any>(d.item);
    const cat = (d.category as string | null) ?? null;
    const arr = linesByDispatch.get(d.dispatch_id) ?? [];
    arr.push({
      id: d.id as string,
      item_id: (d.item_id as string | null) ?? null,
      item_code: (it?.code as string) ?? null,
      item_name: (it?.name as string) ?? null,
      label: (d.label as string | null) ?? null,
      category: cat,
      phase: dispatchPhaseOf(cat ?? ""),
      qty: Number(d.qty),
      adhoc: !d.job_bom_line_id,
    });
    linesByDispatch.set(d.dispatch_id, arr);
  }

  const dispatches: DispatchHistory[] = (disp ?? []).map((d: any) => ({
    id: d.id as string,
    dispatch_date: d.dispatch_date as string,
    phase_scope: d.phase_scope as PhaseScope,
    note: (d.note as string | null) ?? null,
    created_at: d.created_at as string,
    lines: linesByDispatch.get(d.id) ?? [],
  }));

  return { lines, dispatches };
}

export type DispatchSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export interface DispatchLineInput {
  job_bom_line_id: string | null;
  item_id: string | null;
  category: string | null;
  label?: string | null;
  qty: number;
}

export async function createDispatch(input: {
  job_id: string;
  dispatch_date: string;
  phase_scope: PhaseScope;
  note?: string | null;
  lines: DispatchLineInput[];
}): Promise<DispatchSaveResult> {
  if (!input.job_id) return { ok: false, error: "Missing job." };
  if (!input.dispatch_date)
    return { ok: false, error: "Pick a dispatch date." };

  const lines = (input.lines ?? []).filter(
    (l) => Number(l.qty) > 0 && (l.item_id || (l.label && l.label.trim())),
  );
  if (lines.length === 0)
    return {
      ok: false,
      error: "Add at least one item with a quantity greater than 0 to dispatch.",
    };

  const supabase = await createClient();
  const { data: head, error: he } = await supabase
    .from("job_dispatches")
    .insert({
      job_id: input.job_id,
      dispatch_date: input.dispatch_date,
      phase_scope: input.phase_scope,
      note: input.note?.trim() || null,
    })
    .select("id")
    .single();
  if (he) return { ok: false, error: he.message };

  const rows = lines.map((l) => ({
    dispatch_id: head.id as string,
    job_bom_line_id: l.job_bom_line_id ?? null,
    item_id: l.item_id ?? null,
    category: l.category ?? null,
    label: l.label?.trim() || null,
    qty: Number(l.qty),
  }));
  const { error: le } = await supabase.from("job_dispatch_lines").insert(rows);
  if (le) {
    // Best-effort rollback so we never leave an empty dispatch header behind.
    await supabase.from("job_dispatches").delete().eq("id", head.id);
    return { ok: false, error: le.message };
  }

  revalidatePath(`/jobs/${input.job_id}`);
  revalidatePath("/jobs");
  return { ok: true, id: head.id as string };
}

export async function deleteDispatch(
  dispatchId: string,
  jobId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!dispatchId) return { ok: false, error: "Missing dispatch id." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("job_dispatches")
    .delete()
    .eq("id", dispatchId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { ok: true };
}

export type DispatchStatus = "none" | "partial" | "full";

/** Per-job dispatch status for the jobs list (none / partial / full). */
export async function getJobsDispatchStatus(
  jobIds: string[],
): Promise<Record<string, DispatchStatus>> {
  const out: Record<string, DispatchStatus> = {};
  for (const id of jobIds) out[id] = "none";
  if (jobIds.length === 0) return out;

  const supabase = await createClient();
  const { data: disp } = await supabase
    .from("job_dispatches")
    .select("id, job_id")
    .in("job_id", jobIds);
  if (!disp || disp.length === 0) return out;

  const dispJobIds = [...new Set(disp.map((d: any) => d.job_id as string))];
  const dispIds = disp.map((d: any) => d.id as string);

  const { data: headers } = await supabase
    .from("job_bom_headers")
    .select("id, job_id")
    .in("job_id", dispJobIds);
  const headerToJob = new Map(
    (headers ?? []).map((h: any) => [h.id as string, h.job_id as string]),
  );
  const headerIds = (headers ?? []).map((h: any) => h.id as string);

  const { data: bl } =
    headerIds.length > 0
      ? await supabase
          .from("job_bom_lines")
          .select("id, job_bom_id, required_quantity")
          .in("job_bom_id", headerIds)
          .not("category", "is", null)
      : { data: [] as any[] };

  const requiredByLine = new Map<string, number>();
  const linesByJob = new Map<string, string[]>();
  for (const l of bl ?? []) {
    const job = headerToJob.get(l.job_bom_id as string);
    if (!job) continue;
    requiredByLine.set(l.id as string, Number(l.required_quantity ?? 0));
    const arr = linesByJob.get(job) ?? [];
    arr.push(l.id as string);
    linesByJob.set(job, arr);
  }

  const { data: dl } = await supabase
    .from("job_dispatch_lines")
    .select("job_bom_line_id, qty")
    .in("dispatch_id", dispIds);
  const dispatchedByLine = new Map<string, number>();
  for (const d of dl ?? []) {
    if (d.job_bom_line_id)
      dispatchedByLine.set(
        d.job_bom_line_id as string,
        (dispatchedByLine.get(d.job_bom_line_id as string) ?? 0) +
          Number(d.qty),
      );
  }

  for (const job of dispJobIds) {
    const lineIds = linesByJob.get(job) ?? [];
    if (lineIds.length === 0) {
      out[job] = "partial"; // dispatched, but no BOM to measure completeness
      continue;
    }
    const open = lineIds.some(
      (id) =>
        (requiredByLine.get(id) ?? 0) - (dispatchedByLine.get(id) ?? 0) >
        0.0001,
    );
    out[job] = open ? "partial" : "full";
  }
  return out;
}
