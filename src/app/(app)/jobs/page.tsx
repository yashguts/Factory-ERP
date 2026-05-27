import { getJobs } from "@/lib/actions/jobs";
import { getUnmatchedCount } from "@/lib/actions/bom-mapping";
import { JobsClient } from "@/components/jobs/jobs-client";

export default async function JobsPage() {
  const [jobs, unmatchedCount] = await Promise.all([
    getJobs(),
    getUnmatchedCount(),
  ]);
  return <JobsClient initialJobs={jobs} unmatchedCount={unmatchedCount} />;
}
