"use server";

/**
 * Curation for Packing List R1's "Unmapped Items" carry-over list.
 *
 * Unmapped items = a job's BOM items whose item_id isn't on its saved R1 list
 * (computed live by getUnmappedBomItems in packing-list-r1.ts). As R1 becomes the
 * source of truth, the owner wants to "cross off" carry-overs they don't want —
 * WITHOUT touching the job BOM or the R1 list. This records a per-(job,item)
 * dismissal (migration 056) and the curated reader hides dismissed items.
 *
 * NON-DESTRUCTIVE: only ever writes/removes packing_r1_unmapped_dismissed rows.
 * Deliberately a separate file so the (parallel-edited) packing-list-r1.ts is
 * left untouched.
 */
import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidatePath, revalidateTag } from "next/cache";
import { getUnmappedBomItems, type R1UnmappedItem } from "@/lib/actions/packing-list-r1";

export type R1DismissResult = { ok: true } | { ok: false; error: string };

/** Unmapped BOM items for a job MINUS the ones the user has crossed off. */
export async function getCuratedUnmappedBomItems(jobId: string): Promise<R1UnmappedItem[]> {
  const supabase = createCacheClient();
  const [all, dismissed] = await Promise.all([
    getUnmappedBomItems(jobId),
    (async () => {
      const { data } = await supabase
        .from("packing_r1_unmapped_dismissed")
        .select("item_id")
        .eq("job_id", jobId);
      return new Set((data ?? []).map((r) => r.item_id as string));
    })(),
  ]);
  return all.filter((u) => !dismissed.has(u.item_id));
}

/** Cross an unmapped BOM item off a job's R1 carry-over list.
 *
 *  Since R1 became the job's item source of truth (2026-07-03), crossing off
 *  means "this job does NOT need this item" — so besides hiding the reminder it
 *  also clears the legacy BOM line's demand: unreferenced lines are deleted,
 *  dispatch-referenced lines are zeroed (history preserved). Every removed/
 *  zeroed line is snapshotted onto the dismissal row, so restore can put the
 *  data back exactly. */
export async function dismissUnmappedItem(jobId: string, itemId: string): Promise<R1DismissResult> {
  if (!jobId || !itemId) return { ok: false, error: "Missing job or item." };
  const supabase = await createClient();

  // The job's legacy BOM lines for this item (mirrored 'r1' lines can't be
  // unmapped by construction — unmapped = on BOM but NOT on R1).
  const { data: headers } = await supabase.from("job_bom_headers").select("id").eq("job_id", jobId);
  const headerIds = (headers ?? []).map((h) => h.id as string);
  let removedSnapshot: unknown[] = [];
  if (headerIds.length > 0) {
    const { data: lines } = await supabase
      .from("job_bom_lines")
      .select("*")
      .in("job_bom_id", headerIds)
      .eq("item_id", itemId);
    const all = lines ?? [];
    if (all.length > 0) {
      const ids = all.map((l) => l.id as string);
      const { data: refs } = await supabase
        .from("job_dispatch_lines")
        .select("job_bom_line_id")
        .in("job_bom_line_id", ids);
      const referenced = new Set((refs ?? []).map((r) => r.job_bom_line_id as string));
      const toDelete = ids.filter((id) => !referenced.has(id));
      const toZero = ids.filter((id) => referenced.has(id));
      removedSnapshot = all; // full rows, restorable
      // Independent writes (the snapshot is already captured) — one concurrent
      // round-trip wave instead of three sequential cross-region hops. The X in
      // the UI is optimistic, but background latency still matters for rapid
      // job-by-job review sessions.
      const [delRes, zeroRes] = await Promise.all([
        toDelete.length > 0
          ? supabase.from("job_bom_lines").delete().in("id", toDelete)
          : Promise.resolve({ error: null }),
        toZero.length > 0
          ? supabase.from("job_bom_lines").update({ required_quantity: 0 }).in("id", toZero)
          : Promise.resolve({ error: null }),
      ]);
      if (delRes.error || zeroRes.error) {
        // The sibling write may have landed — refresh the cached BOM reads
        // (job detail is cached now) so the UI can't keep serving deleted lines.
        revalidateTag("bom-lines");
        revalidateTag("jobs");
        return { ok: false, error: (delRes.error ?? zeroRes.error)!.message };
      }
    }
  }

  const { error } = await supabase
    .from("packing_r1_unmapped_dismissed")
    .upsert(
      { job_id: jobId, item_id: itemId, removed_bom_lines: removedSnapshot.length ? removedSnapshot : null },
      { onConflict: "job_id,item_id" },
    );
  if (error) return { ok: false, error: error.message };
  revalidateTag("bom-lines");
  revalidateTag("jobs");
  revalidatePath(`/jobs/${jobId}/items`);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Undo a dismissal — the item reappears in Unmapped Items. */
export async function restoreUnmappedItem(jobId: string, itemId: string): Promise<R1DismissResult> {
  if (!jobId || !itemId) return { ok: false, error: "Missing job or item." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("packing_r1_unmapped_dismissed")
    .delete()
    .eq("job_id", jobId)
    .eq("item_id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}/items`);
  return { ok: true };
}
