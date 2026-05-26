import { getJobDetail } from "@/lib/actions/jobs";
import { JobDetailClient } from "@/components/jobs/job-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;
  const { job, bomLines, bomHeaderId } = await getJobDetail(id);
  return <JobDetailClient job={job} bomLines={bomLines} bomHeaderId={bomHeaderId} />;
}
