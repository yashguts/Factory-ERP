import { notFound } from "next/navigation";
import { getCabinJob } from "@/lib/actions/cabin-jobs";
import { CabinJobForm } from "@/components/cabin/cabin-job-form";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CabinJobEditPage({ params }: Props) {
  const { id } = await params;
  const job = await getCabinJob(id);
  if (!job) notFound();
  return <CabinJobForm job={job} />;
}
