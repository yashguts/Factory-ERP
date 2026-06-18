"use server";

import { getJobsWithGadDrift } from "@/lib/actions/gad-alerts";

/**
 * Count of jobs flagged "GAD changed after the BOM was defined" — for the
 * sidebar badge. Lives in its own "use server" file (only async exports) so it
 * is safe to import from the CLIENT Sidebar: pulling gad-alerts.ts (which also
 * exports a non-async unstable_cache const) into the client-action graph would
 * fail the build. The heavy read stays cached server-side via getJobsWithGadDrift.
 */
export async function getGadDriftCount(): Promise<number> {
  return (await getJobsWithGadDrift()).length;
}
