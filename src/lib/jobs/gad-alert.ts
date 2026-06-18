import type { Job } from "@/lib/supabase/types";

/**
 * The GAD-vs-BOM drift alert — the single source of truth for every surface
 * (Jobs list, Job detail, Weekly Dispatch Plan, the global report, the sidebar
 * count). Pure function of the `jobs` row, so list screens that already
 * `select *` need ZERO extra queries.
 *
 * The danger this guards against: Sales re-uploads / changes the GAD AFTER the
 * Factory already defined the BOM from the previous drawing — silently
 * invalidating the BOM, the cut programs, the procurement, and the dispatch.
 *
 *   Alert ON  ⇔  a GAD is present
 *             AND the BOM is defined (bom_defined_at is set)
 *             AND gad_revision_no > acknowledged revision
 *
 * where the acknowledged revision is the one a reviewer last accepted via
 * "Mark Audited", falling back to the baseline captured when the BOM was first
 * defined (so a never-audited job is silent until the GAD actually moves).
 */

/** Fields the predicate needs — a Job, or any row carrying these columns. */
export type GadAlertInput = Pick<
  Job,
  | "gad_drawing_url"
  | "gad_revision_no"
  | "bom_defined_at"
  | "bom_gad_baseline_rev"
  | "bom_audited_gad_rev"
>;

/** The GAD revision the reviewer has accepted (audited, else the BOM baseline). */
export function acknowledgedRev(job: GadAlertInput): number | null {
  return job.bom_audited_gad_rev ?? job.bom_gad_baseline_rev ?? null;
}

/** TRUE => raise the per-job "GAD changed after the BOM was defined" alert. */
export function gadAlert(job: GadAlertInput): boolean {
  // A removed/absent GAD never nags — re-uploading bumps the revision and re-raises.
  if (job.gad_drawing_url == null) return false;
  // No BOM defined yet => nothing to invalidate.
  if (job.bom_defined_at == null) return false;
  const ack = acknowledgedRev(job);
  if (ack == null) return false; // defensive: BOM defined but no baseline captured
  // The live GAD is newer than the revision the reviewer last accepted.
  return job.gad_revision_no > ack;
}
