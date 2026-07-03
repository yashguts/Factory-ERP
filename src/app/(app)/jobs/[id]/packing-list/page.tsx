import { createClient } from "@/lib/supabase/server";
import { getPartList } from "@/lib/actions/partlist";
import { getJobDoorType } from "@/lib/actions/partlist-generate";
import { PartListClient } from "@/components/jobs/partlist-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PartListPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  // slim header read — this page only renders three job fields; getJobDetail's
  // full BOM join + GAD versions were fetched and discarded here
  const [jobRes, initial, doorType] = await Promise.all([
    supabase
      .from("jobs")
      .select("job_number, customer_name, drive_type")
      .eq("id", id)
      .single(),
    getPartList(id),
    getJobDoorType(id),
  ]);
  if (jobRes.error) throw jobRes.error;
  const job = jobRes.data;

  return (
    <PartListClient
      jobId={id}
      jobNumber={job.job_number}
      customerName={job.customer_name}
      driveType={job.drive_type}
      doorType={doorType}
      initial={initial}
    />
  );
}
