import { getJobsWithGadDrift } from "@/lib/actions/gad-alerts";
import { GadAlertsClient } from "@/components/jobs/gad-alerts-client";

export const metadata = { title: "GAD Change Alerts" };

export default async function GadAlertsPage() {
  const rows = await getJobsWithGadDrift();
  return <GadAlertsClient rows={rows} />;
}
