import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import type { createCacheClient } from "@/lib/supabase/cache-client";

/**
 * Car Linton demand for MAKE MRP (owner rule, 2026-07-10).
 *
 * Car Linton panels are demanded by CABIN jobs (cabin_job_lines, type
 * "Car Linton") but they are CUT by the regular CNC door-panel nests — the
 * programs the MAKE run-optimiser schedules (the 2026-07-07 Car Linton merge
 * re-pointed those nests' outputs onto the cabin LINTON items). So their
 * demand belongs in Make MRP, where the one optimiser plans the nests jointly
 * with door-panel demand. Cabin MRP EXCLUDES Car Linton correspondingly
 * (cabin-mrp.ts) so the demand lives in exactly one place.
 *
 * Eligibility mirrors Cabin MRP's owner rule (2026-07-03): the cabin job is
 * NOT marked ready, and its linked Job Order (matched by job_number) is
 * in production with Required = full_material (+ the caller's cutoff date).
 * The remaining two gates — the linked job isn't fully dispatched, and its
 * own BOM doesn't already list the item — are applied by the callers, which
 * already hold the per-line dispatch netting.
 */
export interface CarLintonDemandRow {
  item_id: string;
  qty: number;
  /** The linked Job Order's id (for the fully-dispatched gate + job_count). */
  jobId: string;
  /** The linked Job Order's requirement_dispatch_date (weekly bucketing). */
  date: string | null;
}

export async function fetchCarLintonDemand(
  supabase: ReturnType<typeof createCacheClient>,
  cutoffDate?: string,
  /** Ad-hoc scope (the /mrp/shortfall tool): restrict to these Job Order ids
   *  and skip the in-production filter — the owner picked the jobs. */
  adHocJobIds?: string[] | null,
): Promise<CarLintonDemandRow[]> {
  const { data: cjobs } = await supabase
    .from("cabin_jobs")
    .select("id, job_number, marked_ready_at");
  const notReady = ((cjobs ?? []) as any[]).filter((c) => !c.marked_ready_at);
  if (notReady.length === 0) return [];

  let q = supabase
    .from("jobs")
    .select("id, job_number, requirement_dispatch_date")
    .eq("requirement_stage", "full_material");
  if (adHocJobIds) {
    q = q.in("id", adHocJobIds);
  } else {
    q = q.eq("status", "in_production");
    if (cutoffDate) q = q.lte("requirement_dispatch_date", cutoffDate);
  }
  const { data: jobsRaw } = await q;
  const jobByNumber = new Map<string, { id: string; date: string | null }>();
  for (const j of (jobsRaw ?? []) as any[]) {
    const key = ((j.job_number as string) ?? "").trim().toLowerCase();
    if (key)
      jobByNumber.set(key, {
        id: j.id as string,
        date: (j.requirement_dispatch_date as string | null) ?? null,
      });
  }
  if (jobByNumber.size === 0) return [];

  const linkByCabin = new Map<string, { id: string; date: string | null }>();
  for (const c of notReady) {
    const link = jobByNumber.get(((c.job_number as string) ?? "").trim().toLowerCase());
    if (link) linkByCabin.set(c.id as string, link);
  }
  if (linkByCabin.size === 0) return [];

  const cabinIds = [...linkByCabin.keys()];
  const lines = await fetchAllRanged<{ cabin_job_id: string; item_id: string | null; qty: number }>(
    (from, to, withCount) =>
      supabase
        .from("cabin_job_lines")
        .select("cabin_job_id, item_id, qty", withCount ? { count: "exact" } : {})
        .eq("cabin_type", "Car Linton")
        .not("item_id", "is", null)
        .gt("qty", 0)
        .in("cabin_job_id", cabinIds)
        .range(from, to),
  );

  const out: CarLintonDemandRow[] = [];
  for (const l of lines) {
    if (!l.item_id) continue;
    const link = linkByCabin.get(l.cabin_job_id);
    if (!link) continue;
    out.push({ item_id: l.item_id, qty: Number(l.qty) || 0, jobId: link.id, date: link.date });
  }
  return out;
}
