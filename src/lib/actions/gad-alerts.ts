"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import { unstable_cache } from "next/cache";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import type { Job } from "@/lib/supabase/types";
import { gadAlert, acknowledgedRev } from "@/lib/jobs/gad-alert";

/* ------------------------------------------------------------------ *
 * GAD Change Alerts — the global view of every job whose GAD drawing was
 * changed AFTER its BOM was defined and hasn't been re-audited.
 *
 * This is the single list the item-keyed teams (Program-to-Run, Procurement)
 * check before cutting/ordering — the per-job alert can't sit on their
 * item/PO rows, so they come here (and watch the sidebar count).
 *
 * Pure read; the alert is computed from the denormalised columns already on
 * each jobs row via the shared gadAlert() predicate. No mutations.
 * ------------------------------------------------------------------ */

export interface GadDriftRow {
  id: string;
  job_number: string;
  customer_name: string | null;
  /** Current (live) GAD revision. */
  current_rev: number;
  /** Revision the BOM was last reconciled against (audited, else baseline). */
  baseline_rev: number | null;
  requirement_dispatch_date: string | null;
  gad_uploaded_at: string | null;
  gad_uploaded_by: string | null;
}

const _getJobsWithGadDriftUncached = async (): Promise<GadDriftRow[]> => {
  const supabase = createCacheClient();
  const jobs = await fetchAllRanged<Job>((from, to, withCount) =>
    supabase
      .from("jobs")
      .select("*", withCount ? { count: "exact" } : {})
      .order("requirement_dispatch_date", { ascending: true, nullsFirst: false })
      .range(from, to),
  );
  return jobs.filter(gadAlert).map((j) => ({
    id: j.id,
    job_number: j.job_number,
    customer_name: j.customer_name,
    current_rev: j.gad_revision_no,
    baseline_rev: acknowledgedRev(j),
    requirement_dispatch_date: j.requirement_dispatch_date,
    gad_uploaded_at: j.gad_drawing_uploaded_at,
    gad_uploaded_by: j.gad_uploaded_by,
  }));
};

/** Every job currently flagged "GAD changed after the BOM was defined". */
export const getJobsWithGadDrift = unstable_cache(
  _getJobsWithGadDriftUncached,
  ["gad-drift-jobs"],
  { revalidate: 120, tags: ["jobs", "gad-alerts"] },
);

// The count-only helper for the sidebar badge lives in ./gad-alert-count
// (its own "use server" file with only-async exports) so the CLIENT Sidebar can
// import it without dragging this file's unstable_cache const into the client.
