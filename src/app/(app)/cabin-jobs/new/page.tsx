import { CabinJobForm } from "@/components/cabin/cabin-job-form";
import { getCabinJob } from "@/lib/actions/cabin-jobs";

export const metadata = { title: "New Cabin Job" };

export default async function NewCabinJobPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  // ?from=<id> clones an existing cabin job's items into a fresh (blank-numbered) job.
  const cloneFrom = from ? await getCabinJob(from) : null;
  return <CabinJobForm cloneFrom={cloneFrom} />;
}
