import { getJobDetail, getJobBomSections } from "@/lib/actions/jobs";
import { JobDetailClient } from "@/components/jobs/job-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;

  // Parallel fetch — don't wait for job detail before fetching BOM sections
  const [{ job, bomLines, bomHeaderId }, bomSections] = await Promise.all([
    getJobDetail(id),
    getJobBomSections(id),
  ]);

  return (
    <JobDetailClient
      job={job}
      bomLines={bomLines}
      bomHeaderId={bomHeaderId}
      bomSectionLines={bomSections}
    />
  );
}
