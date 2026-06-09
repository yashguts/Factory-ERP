"use server";

import { unstable_cache } from "next/cache";
import { createCacheClient } from "@/lib/supabase/cache-client";

/**
 * Morning-briefing data for the dashboard. Everything here is a CHEAP
 * count/limit query — the heavy MRP shortfall card streams separately
 * (see MrpShortfallCards) so the page shell paints instantly.
 */

export interface DueJob {
  id: string;
  job_number: string;
  customer_name: string | null;
  requirement_dispatch_date: string | null;
  stage: string | null;
  status: string;
  overdue: boolean;
}

export interface DashboardCounts {
  /** Jobs with a requirement dispatch date within the next 7 days or overdue. */
  dueJobs: DueJob[];
  dueCount: number;
  overdueCount: number;
  /** Programs catalog. */
  programsPendingAudit: number;
  /** Data hygiene. */
  unmatchedBomLines: number;
  outputsNeedingItem: number;
  /** Activity today (item edits + stock moves). */
  changesToday: number;
  stockMovesToday: number;
}

const _getDashboardCountsUncached = async (
  todayISO: string,
): Promise<DashboardCounts> => {
  const supabase = createCacheClient();
  const horizon = new Date(todayISO);
  horizon.setDate(horizon.getDate() + 7);
  const horizonISO = horizon.toISOString().slice(0, 10);
  const dayStart = `${todayISO}T00:00:00`;

  const [
    dueJobsRes,
    pendingAuditRes,
    unmatchedRes,
    needsItemRes,
    changesRes,
    movesRes,
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, job_number, customer_name, requirement_dispatch_date, stage, status",
      )
      .in("status", ["new", "in_production"])
      .not("requirement_dispatch_date", "is", null)
      .lte("requirement_dispatch_date", horizonISO)
      .order("requirement_dispatch_date", { ascending: true })
      .limit(100),
    supabase
      .from("operations")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .is("audited_at", null),
    supabase
      .from("job_bom_lines")
      .select("id", { count: "exact", head: true })
      .is("item_id", null),
    supabase
      .from("operation_outputs")
      .select("id", { count: "exact", head: true })
      .is("item_id", null)
      .eq("role", "component"),
    supabase
      .from("item_change_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayStart),
    supabase
      .from("inventory_transactions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayStart),
  ]);

  const rawDue = (dueJobsRes.data ?? []) as Array<{
    id: string;
    job_number: string;
    customer_name: string | null;
    requirement_dispatch_date: string | null;
    stage: string | null;
    status: string;
  }>;
  const dueJobs: DueJob[] = rawDue.map((j) => ({
    ...j,
    overdue:
      !!j.requirement_dispatch_date && j.requirement_dispatch_date < todayISO,
  }));

  return {
    dueJobs: dueJobs.slice(0, 7),
    dueCount: dueJobs.length,
    overdueCount: dueJobs.filter((j) => j.overdue).length,
    programsPendingAudit: pendingAuditRes.count ?? 0,
    unmatchedBomLines: unmatchedRes.count ?? 0,
    outputsNeedingItem: needsItemRes.count ?? 0,
    changesToday: changesRes.count ?? 0,
    stockMovesToday: movesRes.count ?? 0,
  };
};

export const getDashboardCounts = unstable_cache(
  _getDashboardCountsUncached,
  ["dashboard-counts"],
  {
    revalidate: 300,
    tags: ["jobs", "operations", "bom-lines", "items", "inventory-stock"],
  },
);
