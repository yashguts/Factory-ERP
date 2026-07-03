import {
  getR1List,
  getR1Demand,
  getCategoryItemCounts,
  getCabinPanelsForJob,
} from "@/lib/actions/packing-list-r1";
import { getCuratedUnmappedBomItems } from "@/lib/actions/packing-list-r1-unmapped";
import { getAllCategories } from "@/lib/actions/categories";
import { R1BuilderClient } from "@/components/packing-list-r1/r1-builder-client";

export const dynamic = "force-dynamic";

/** The job's item list (Packing List R1), living NATIVELY inside Job Orders —
 *  same builder as /packing-list-r1/[jobId], but the URL, sidebar highlight and
 *  back-link stay in the job's context. This is the surface the job page's
 *  "Packing List R1" button opens. */
export default async function JobItemsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // getR1List seeds the list on first open — must complete before demand reads it.
  const list = await getR1List(id);
  const [categories, demand, counts, cabinPanels, unmapped] = await Promise.all([
    getAllCategories(),
    getR1Demand(id),
    getCategoryItemCounts(),
    getCabinPanelsForJob(id),
    getCuratedUnmappedBomItems(id),
  ]);
  return (
    <R1BuilderClient
      list={list}
      categories={categories}
      demand={demand}
      counts={counts}
      cabinPanels={cabinPanels}
      unmapped={unmapped}
      context="jobs"
    />
  );
}
