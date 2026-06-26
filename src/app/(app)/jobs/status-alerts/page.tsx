import { getOpenStatusAlerts } from "@/lib/actions/job-status";
import { StatusAlertsClient } from "@/components/jobs/status-alerts-client";

export const metadata = { title: "Job Status Alerts" };

export default async function StatusAlertsPage() {
  const rows = await getOpenStatusAlerts();
  return <StatusAlertsClient rows={rows} />;
}
