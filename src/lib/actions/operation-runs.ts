"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidatePath } from "next/cache";

/* ------------------------------------------------------------------ *
 * Daily Program Runs — the factory's logbook of which programs actually
 * ran on a given day. Recording is Phase-0 style: it does NOT consume
 * or produce inventory (that's a future phase). One row per
 * (program, day) with a run count.
 * ------------------------------------------------------------------ */

function flatten<T>(rel: unknown): T | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return (rel[0] ?? null) as T | null;
  return rel as T;
}

export interface DailyRunRow {
  id: string;
  operation_id: string;
  code: string | null;
  name: string;
  machine: string;
  machining_time_seconds: number | null;
  runs_count: number;
  note: string | null;
  created_at: string;
}

export async function getRunsForDate(date: string): Promise<DailyRunRow[]> {
  if (!date) return [];
  const supabase = createCacheClient();
  const { data, error } = await supabase
    .from("operation_runs")
    .select(
      `id, operation_id, runs_count, note, created_at,
       operation:operations(code, name, machine, machining_time_seconds)`,
    )
    .eq("run_date", date)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((r: any) => {
    const op = flatten<any>(r.operation);
    return {
      id: r.id as string,
      operation_id: r.operation_id as string,
      code: (op?.code as string) ?? null,
      name: (op?.name as string) ?? "(deleted program)",
      machine: (op?.machine as string) ?? "",
      machining_time_seconds: (op?.machining_time_seconds as number | null) ?? null,
      runs_count: Number(r.runs_count),
      note: (r.note as string | null) ?? null,
      created_at: r.created_at as string,
    };
  });
}

export interface AuditedProgramHit {
  id: string;
  code: string | null;
  name: string;
  machine: string;
  machining_time_seconds: number | null;
}

/** Search ONLY audited, active programs — the factory may only log what has
 *  been reviewed. New/unreviewed programs must be created + audited first. */
export async function searchAuditedPrograms(
  query: string,
  limit = 20,
): Promise<AuditedProgramHit[]> {
  const q = query.trim();
  if (!q) return [];
  const supabase = createCacheClient();
  let req = supabase
    .from("operations")
    .select("id, code, name, machine, machining_time_seconds")
    .eq("is_active", true)
    .not("audited_at", "is", null);
  for (const token of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const safe = token.replace(/[%,()]/g, "");
    if (!safe) continue;
    req = req.or(`name.ilike.%${safe}%,code.ilike.%${safe}%`);
  }
  const { data, error } = await req.order("name").limit(limit);
  if (error) throw error;
  return (data ?? []).map((o: any) => ({
    id: o.id as string,
    code: (o.code as string) ?? null,
    name: o.name as string,
    machine: o.machine as string,
    machining_time_seconds: (o.machining_time_seconds as number | null) ?? null,
  }));
}

export type RunResult = { ok: true; id: string } | { ok: false; error: string };

export async function recordRun(input: {
  operation_id: string;
  run_date: string;
  runs_count: number;
  note?: string | null;
}): Promise<RunResult> {
  if (!input.operation_id) return { ok: false, error: "Pick a program first." };
  if (!input.run_date) return { ok: false, error: "Pick a date." };
  const count = Number(input.runs_count);
  if (!Number.isFinite(count) || count <= 0)
    return { ok: false, error: "Run count must be greater than 0." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("operation_runs")
    .insert({
      operation_id: input.operation_id,
      run_date: input.run_date,
      runs_count: count,
      note: input.note?.trim() || null,
    })
    .select("id")
    .single();
  if (error) {
    const msg =
      (error as any).code === "23505"
        ? "This program is already recorded for this date — adjust its count in the list instead."
        : error.message;
    return { ok: false, error: msg };
  }
  revalidatePath("/program-runs");
  return { ok: true, id: data.id as string };
}

export async function updateRunCount(
  id: string,
  runs_count: number,
): Promise<RunResult> {
  const count = Number(runs_count);
  if (!Number.isFinite(count) || count <= 0)
    return { ok: false, error: "Run count must be greater than 0." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("operation_runs")
    .update({ runs_count: count })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/program-runs");
  return { ok: true, id };
}

export async function deleteRun(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: "Missing id." };
  const supabase = await createClient();
  const { error } = await supabase.from("operation_runs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/program-runs");
  return { ok: true };
}
