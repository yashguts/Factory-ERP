import { getJobDetail, getJobBomSections, getJobBomItemLines } from "@/lib/actions/jobs";
import { JobForm } from "@/components/jobs/job-form";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditJobPage({ params }: Props) {
  const { id } = await params;
  const [{ job }, bomSections, itemLines] = await Promise.all([
    getJobDetail(id),
    getJobBomSections(id),
    getJobBomItemLines(id),
  ]);

  return (
    <JobForm
      mode="edit"
      job={job}
      existingBom={bomSections}
      existingItemLines={itemLines}
    />
  );
}
