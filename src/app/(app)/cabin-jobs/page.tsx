import { getCabinJobs, getCabinFinishRequirement } from "@/lib/actions/cabin-jobs";
import { CabinJobsClient } from "@/components/cabin/cabin-jobs-client";

export const metadata = { title: "Cabin Jobs" };

export default async function CabinJobsPage() {
  const [jobs, finishReq] = await Promise.all([
    getCabinJobs(),
    getCabinFinishRequirement(),
  ]);
  return <CabinJobsClient jobs={jobs} finishReq={finishReq} />;
}
