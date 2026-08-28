import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import type { createCacheClient } from "@/lib/supabase/cache-client";
import type { CarLintonDemandRow } from "./car-linton-demand";

/**
 * Cabin Glass demand for TRADE MRP (owner rule, 2026-08-28).
 *
 * Cabin Glass is BOUGHT, not cut: it's demanded by CABIN jobs (cabin_job_lines,
 * type "Cabin Glass") but no cabin program produces it, so its demand belongs
 * on the Trade side — the Trade requirement table and procurement, via the
 * same fold mechanism as Car Linton (mrp.ts). Cabin MRP EXCLUDES Cabin Glass
 * correspondingly (cabin-mrp.ts) so the demand lives in exactly one place.
 *
 * Eligibility differs from the Car Linton fetch in ONE gate: glass stays
 * demanded until the cabin job is DISPATCHED — not until it's marked ready.
 * The matching stock rule (cabin-jobs.ts, same date) consumes glass from Main
 * Store at dispatch while every other cabin item is consumed at ready: a
 * built-but-undispatched cabin still needs its glass bought and allocated.
 * The linked-Job-Order gates (in production, Required = full_material, cutoff,
 * not fully dispatched, not directly on the job BOM) mirror the linton fetch;
 * the last two are applied by the callers.
 */
export async function fetchCabinGlassDemand(
  supabase: ReturnType<typeof createCacheClient>,
  cutoffDate?: string,
  /** Ad-hoc scope (the /mrp/shortfall tool): restrict to these Job Order ids
   *  and skip the in-production filter — the owner picked the jobs. */
  adHocJobIds?: string[] | null,
): Promise<CarLintonDemandRow[]> {
  // Paged — cabin_jobs grows unbounded (PostgREST caps a single select at 1000
  // rows; a plain read would silently drop demand once the table outgrows it).
  const cjobs = await fetchAllRanged<{ id: string; job_number: string; dispatched_at: string | null }>(
    (from, to, withCount) =>
      supabase
        .from("cabin_jobs")
        .select("id, job_number, dispatched_at", withCount ? { count: "exact" } : {})
        .range(from, to),
  );
  const notDispatched = cjobs.filter((c) => !c.dispatched_at);
  if (notDispatched.length === 0) return [];

  let q = supabase
    .from("jobs")
    .select("id, job_number, requirement_dispatch_date")
    .eq("requirement_stage", "full_material")
    // In Production is a hard demand rule — an explicit pick doesn't bypass
    // it (owner, 2026-07-16); only the date cutoff is scope-local.
    .eq("status", "in_production");
  if (adHocJobIds) {
    q = q.in("id", adHocJobIds);
  } else if (cutoffDate) {
    q = q.lte("requirement_dispatch_date", cutoffDate);
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
  for (const c of notDispatched) {
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
        .eq("cabin_type", "Cabin Glass")
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
