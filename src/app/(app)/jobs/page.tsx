import { getJobs } from "@/lib/actions/jobs";
import { JobsClient } from "@/components/jobs/jobs-client";

export default async function JobsPage() {
  const jobs = await getJobs();
  return <JobsClient initialJobs={jobs} />;
}
