import { getJobs, getJobReadinessFlags } from "@/lib/actions/jobs";
import { getUnmatchedCount } from "@/lib/actions/bom-mapping";
import { getJobsDispatchStatus } from "@/lib/actions/dispatch";
import { JobsClient } from "@/components/jobs/jobs-client";

export default async function JobsPage() {
  // Dispatch status needs the job ids, so it chains off the jobs read — but
  // the chain runs concurrently with the other independent fetches instead of
  // starting only after all of them have resolved.
  const jobsPromise = getJobs();
  const [jobs, unmatchedCount, readiness, dispatchStatus] = await Promise.all([
    jobsPromise,
    getUnmatchedCount(),
    getJobReadinessFlags(),
    jobsPromise.then((js) => getJobsDispatchStatus(js.map((j) => j.id))),
  ]);
  return (
    <JobsClient
      initialJobs={jobs}
      unmatchedCount={unmatchedCount}
      dispatchStatus={dispatchStatus}
      readiness={readiness}
    />
  );
}
