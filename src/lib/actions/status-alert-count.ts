"use server";

import { getOpenStatusAlerts } from "@/lib/actions/job-status";

/**
 * Count of OPEN (unacknowledged) job status alerts — for the sidebar badge.
 * Lives in its own "use server" file (only async exports) so the CLIENT Sidebar
 * can import it without dragging job-status.ts's unstable_cache const into the
 * client-action graph. The heavy read stays cached via getOpenStatusAlerts.
 */
export async function getStatusAlertCount(): Promise<number> {
  return (await getOpenStatusAlerts()).length;
}
