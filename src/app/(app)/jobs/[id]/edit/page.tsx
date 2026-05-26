import { getJobDetail, getJobBomSections } from "@/lib/actions/jobs";
import { JobForm } from "@/components/jobs/job-form";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditJobPage({ params }: Props) {
  const { id } = await params;
  const { job } = await getJobDetail(id);
  const bomSections = await getJobBomSections(id);

  return <JobForm mode="edit" job={job} existingBom={bomSections} />;
}
