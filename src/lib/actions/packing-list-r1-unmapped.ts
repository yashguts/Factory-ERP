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
import { revalidatePath } from "next/cache";
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

/** Cross an unmapped BOM item off a job's R1 carry-over list. Records a hidden-
 *  reminder row only — never edits job_bom_lines or the R1 list. Reversible. */
export async function dismissUnmappedItem(jobId: string, itemId: string): Promise<R1DismissResult> {
  if (!jobId || !itemId) return { ok: false, error: "Missing job or item." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("packing_r1_unmapped_dismissed")
    .upsert({ job_id: jobId, item_id: itemId }, { onConflict: "job_id,item_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/packing-list-r1/${jobId}`);
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
  revalidatePath(`/packing-list-r1/${jobId}`);
  return { ok: true };
}
