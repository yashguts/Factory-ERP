import { getJobs } from "@/lib/actions/jobs";
import { getUnmatchedCount } from "@/lib/actions/bom-mapping";
import { getJobsDispatchStatus } from "@/lib/actions/dispatch";
import { JobsClient } from "@/components/jobs/jobs-client";

export default async function JobsPage() {
  const [jobs, unmatchedCount] = await Promise.all([
    getJobs(),
    getUnmatchedCount(),
  ]);
  const dispatchStatus = await getJobsDispatchStatus(jobs.map((j) => j.id));
  return (
    <JobsClient
      initialJobs={jobs}
      unmatchedCount={unmatchedCount}
      dispatchStatus={dispatchStatus}
    />
  );
}
