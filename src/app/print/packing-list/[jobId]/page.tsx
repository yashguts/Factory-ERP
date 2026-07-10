import { getR1List, getCabinPanelsForJob } from "@/lib/actions/packing-list-r1";
import { R1PrintClient } from "@/components/packing-list-r1/r1-print-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packing List R1 — Print" };

/** SCRATCH print tab for a job's Packing List R1 (opened by "PDF Export").
 *  Lives OUTSIDE the (app) shell — no sidebar, print-friendly. Everything the
 *  user changes here (selection, quantities) is temporary: nothing writes back
 *  to the job. Confirming the print saves a snapshot to packing_r1_prints,
 *  which the dispatch modal diffs against for 72 hours. */
export default async function PackingListPrintPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const [list, cabinPanels] = await Promise.all([
    getR1List(jobId),
    getCabinPanelsForJob(jobId),
  ]);
  return <R1PrintClient list={list} cabinPanels={cabinPanels} />;
}
