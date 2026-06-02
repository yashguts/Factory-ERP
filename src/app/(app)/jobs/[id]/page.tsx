import { getJobDetail, getJobBomSections } from "@/lib/actions/jobs";
import { getJobDispatchSummary } from "@/lib/actions/dispatch";
import { JobDetailClient } from "@/components/jobs/job-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;

  // Parallel fetch — job detail, BOM sections, and dispatch summary together.
  const [{ job, bomLines, bomHeaderId }, bomSections, dispatch] =
    await Promise.all([
      getJobDetail(id),
      getJobBomSections(id),
      getJobDispatchSummary(id),
    ]);

  return (
    <JobDetailClient
      job={job}
      bomLines={bomLines}
      bomHeaderId={bomHeaderId}
      bomSectionLines={bomSections}
      dispatch={dispatch}
    />
  );
}
