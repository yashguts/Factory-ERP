import { getOpenStatusAlerts, getChangeHistory } from "@/lib/actions/job-status";
import { StatusAlertsClient } from "@/components/jobs/status-alerts-client";

export const metadata = { title: "Job Status Alerts" };

export default async function StatusAlertsPage() {
  const [rows, history] = await Promise.all([getOpenStatusAlerts(), getChangeHistory()]);
  return <StatusAlertsClient rows={rows} history={history} />;
}
