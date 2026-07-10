"use server";

import { createClient } from "@/lib/supabase/server";

/* ------------------------------------------------------------------ *
 * Printed packing-list snapshots.
 *
 * The R1 "PDF Export" tab is a SCRATCH view: the dispatcher unticks
 * sections/items and adjusts quantities freely — none of it touches the
 * job's live Packing List / BOM. When they confirm the print ("this is
 * the material going out"), the exact printed list is saved here as a
 * snapshot. Marking a dispatch within 72 hours then diffs the dispatch
 * lines against the newest snapshot and surfaces item-wise differences
 * for an explicit OK. Live data changes ONLY through Mark Dispatched.
 * ------------------------------------------------------------------ */

export interface PrintedLine {
  item_id: string;
  code: string | null;
  name: string | null;
  part: string | null;
  qty: number;
}

export interface PackingPrintSnapshot {
  id: string;
  printed_at: string;
  printed_by: string | null;
  lines: PrintedLine[];
}

/** Window within which a dispatch is checked against the latest print. */
const DIFF_WINDOW_HOURS = 72;

export async function savePackingPrint(
  jobId: string,
  lines: PrintedLine[],
  printedBy?: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!jobId) return { ok: false, error: "Missing job id." };
  const clean = (lines ?? []).filter((l) => l.item_id && Number(l.qty) > 0);
  if (clean.length === 0)
    return { ok: false, error: "Nothing selected — tick at least one item to print." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("packing_r1_prints")
    .insert({
      job_id: jobId,
      printed_by: printedBy?.trim() || null,
      lines: clean.map((l) => ({
        item_id: l.item_id,
        code: l.code,
        name: l.name,
        part: l.part,
        qty: Number(l.qty),
      })),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** Newest print snapshot for the job within the 72-hour diff window (or null).
 *  Uncached — it's read once when a dispatch is about to be recorded. */
export async function getLatestPackingPrint(
  jobId: string,
): Promise<PackingPrintSnapshot | null> {
  if (!jobId) return null;
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - DIFF_WINDOW_HOURS * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from("packing_r1_prints")
    .select("id, printed_at, printed_by, lines")
    .eq("job_id", jobId)
    .gte("printed_at", cutoff)
    .order("printed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    printed_at: data.printed_at as string,
    printed_by: (data.printed_by as string | null) ?? null,
    lines: (data.lines as PrintedLine[]) ?? [],
  };
}
