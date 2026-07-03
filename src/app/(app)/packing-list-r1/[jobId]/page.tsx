import { redirect } from "next/navigation";

// Retired 2026-07-04 — the job's Packing List R1 lives natively inside Job
// Orders. Old links/bookmarks land on the same list at its new home.
export default async function PackingListR1JobRetired({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  redirect(`/jobs/${jobId}/items`);
}
