import { getCabinJobs } from "@/lib/actions/cabin-jobs";
import { CabinJobsClient } from "@/components/cabin/cabin-jobs-client";

export const metadata = { title: "Cabin Jobs" };

export default async function CabinJobsPage() {
  const jobs = await getCabinJobs();
  return <CabinJobsClient jobs={jobs} />;
}
