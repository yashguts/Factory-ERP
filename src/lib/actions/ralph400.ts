"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Ralph400Inputs } from "@/lib/ralph400/model";
import type { PartLine } from "@/lib/ralph400/part-list";

/* ------------------------------------------------------------------ *
 * RALPH 400 part list saved against a job (table ralph400_part_lists).
 * Read uncached: a list someone just saved must show on the next open.
 * ------------------------------------------------------------------ */

export interface SavedRalph400PartList {
  inputs: Ralph400Inputs;
  savedBy: string | null;
  savedAt: string;
  pieces: number | null;
}

export type SaveRalph400Result =
  | { ok: true; savedAt: string; savedBy: string | null }
  | { ok: false; error: string };

async function jobIdFor(jobNumber: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("job_number", jobNumber.trim())
    .maybeSingle();
  return (data?.id as string) ?? null;
}

export async function getRalph400PartList(jobNumber: string): Promise<SavedRalph400PartList | null> {
  if (!jobNumber?.trim()) return null;
  const jobId = await jobIdFor(jobNumber);
  if (!jobId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("ralph400_part_lists")
    .select("inputs, saved_by, saved_at, pieces")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!data) return null;
  return {
    inputs: data.inputs as Ralph400Inputs,
    savedBy: (data.saved_by as string | null) ?? null,
    savedAt: data.saved_at as string,
    pieces: (data.pieces as number | null) ?? null,
  };
}

export async function saveRalph400PartList(
  jobNumber: string,
  inputs: Ralph400Inputs,
  lines: PartLine[],
  pieces: number,
): Promise<SaveRalph400Result> {
  if (!jobNumber?.trim()) return { ok: false, error: "Pick a job first." };
  const jobId = await jobIdFor(jobNumber);
  if (!jobId) return { ok: false, error: `Job ${jobNumber} not found.` };

  // Audit name mirrored to a cookie by use-operator (no auth in this app).
  let savedBy: string | null = null;
  try {
    const raw = (await cookies()).get("factory.operator")?.value;
    savedBy = raw ? decodeURIComponent(raw).trim() || null : null;
  } catch {
    /* no cookie store in this context */
  }

  const savedAt = new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase.from("ralph400_part_lists").upsert(
    {
      job_id: jobId,
      inputs: { ...inputs, jobNo: jobNumber.trim() },
      lines: lines.filter((l) => !l.notNeeded),
      pieces,
      saved_by: savedBy,
      saved_at: savedAt,
    },
    { onConflict: "job_id" },
  );
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  return { ok: true, savedAt, savedBy };
}
