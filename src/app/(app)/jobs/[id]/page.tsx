import { getJobDetail } from "@/lib/actions/jobs";
import { getJobDispatchSummary } from "@/lib/actions/dispatch";
import { JobDetailClient } from "@/components/jobs/job-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;

  // Parallel fetch — job detail (BOM lines + scoped stock folded in) and
  // dispatch summary together.
  const [{ job, bomLines, bomHeaderId, gadVersions, stockByItem }, dispatch] =
    await Promise.all([getJobDetail(id), getJobDispatchSummary(id)]);

  // Section view rows derive from the same BOM lines (same header, same
  // sort_order) — no extra query needed.
  const bomSections = bomLines
    .filter((l) => l.category != null)
    .map((l) => ({
      category: l.category,
      variant: l.variant,
      value_text: l.value_text,
      required_quantity: l.required_quantity,
    }));

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
