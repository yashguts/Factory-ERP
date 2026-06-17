import { getCabinJobs, getCabinFinishRequirement } from "@/lib/actions/cabin-jobs";
import { getCabinWeekly } from "@/lib/actions/cabin-program-plan";
import { CabinJobsClient } from "@/components/cabin/cabin-jobs-client";

export const metadata = { title: "Cabin Jobs" };

export default async function CabinJobsPage() {
  const [jobs, finishReq, weeklyPlan] = await Promise.all([
    getCabinJobs(),
    getCabinFinishRequirement(),
    getCabinWeekly(),
  ]);
  return <CabinJobsClient jobs={jobs} finishReq={finishReq} weeklyPlan={weeklyPlan} />;
}
