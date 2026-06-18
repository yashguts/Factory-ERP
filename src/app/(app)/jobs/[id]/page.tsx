import { getJobDetail, getJobBomSections } from "@/lib/actions/jobs";
import { getJobDispatchSummary } from "@/lib/actions/dispatch";
import { getStockForItems } from "@/lib/actions/inventory";
import { JobDetailClient } from "@/components/jobs/job-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;

  // Parallel fetch — job detail, BOM sections, and dispatch summary together.
  const [{ job, bomLines, bomHeaderId, gadVersions }, bomSections, dispatch] =
    await Promise.all([
      getJobDetail(id),
      getJobBomSections(id),
      getJobDispatchSummary(id),
    ]);

  // Scoped on-hand stock for THIS job's BOM items (drives the readiness view).
  const stockByItem = await getStockForItems(
    bomLines.map((l) => l.item_id).filter((x): x is string => !!x),
  );

  return (
    <JobDetailClient
      job={job}
      bomLines={bomLines}
      bomHeaderId={bomHeaderId}
      bomSectionLines={bomSections}
      dispatch={dispatch}
      stockByItem={stockByItem}
      gadVersions={gadVersions}
    />
  );
}
