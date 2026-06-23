import { getJobDetail } from "@/lib/actions/jobs";
import { getPartList } from "@/lib/actions/partlist";
import { PartListClient } from "@/components/jobs/partlist-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PartListPage({ params }: Props) {
  const { id } = await params;
  const [{ job }, initial] = await Promise.all([getJobDetail(id), getPartList(id)]);

  return (
    <PartListClient
      jobId={id}
      jobNumber={job.job_number}
      customerName={job.customer_name}
      driveType={job.drive_type}
      initial={initial}
    />
  );
}
