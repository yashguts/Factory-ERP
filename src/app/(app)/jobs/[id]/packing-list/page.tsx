import { getJobDetail } from "@/lib/actions/jobs";
import { ensurePackingList, getPackingList } from "@/lib/actions/packing-list";
import { PackingListClient } from "@/components/jobs/packing-list-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PackingListPage({ params }: Props) {
  const { id } = await params;

  // Make sure the list exists + is seeded from the BOM (idempotent: a cheap
  // no-op once it has been created — covers jobs made after the bulk seed).
  await ensurePackingList(id);

  const [{ job }, data] = await Promise.all([
    getJobDetail(id),
    getPackingList(id),
  ]);

  return (
    <PackingListClient
      jobId={id}
      jobNumber={job.job_number}
      customerName={job.customer_name}
      data={data}
    />
  );
}
