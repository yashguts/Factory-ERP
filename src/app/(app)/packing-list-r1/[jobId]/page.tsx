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

export default async function PackingListR1JobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  // getR1List seeds the list on first open — must complete before demand reads it.
  const list = await getR1List(jobId);
  const [categories, demand, counts, cabinPanels, unmapped] = await Promise.all([
    getAllCategories(),
    getR1Demand(jobId),
    getCategoryItemCounts(),
    getCabinPanelsForJob(jobId),
    getCuratedUnmappedBomItems(jobId),
  ]);
  return (
    <R1BuilderClient
      list={list}
      categories={categories}
      demand={demand}
      counts={counts}
      cabinPanels={cabinPanels}
      unmapped={unmapped}
    />
  );
}
