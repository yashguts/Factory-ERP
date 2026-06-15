import { getMrpData, getProductionPlan } from "@/lib/actions/mrp";
import { MrpClient } from "@/components/mrp/mrp-client";

interface Props {
  searchParams: Promise<{ date?: string }>;
}

// Trade MRP — the one "what to buy" page. Trade items (bought parts) come from
// getMrpData; the exploded raw steel / sheets that feed the make programs come
// from getProductionPlan and are folded in as their own category group, so the
// purchasing team sees the complete buy list in one place, by category.
export default async function TradeMrpPage({ searchParams }: Props) {
  const params = await searchParams;
  const cutoffDate = params.date || undefined;
  const [data, plan] = await Promise.all([
    getMrpData(cutoffDate),
    getProductionPlan(cutoffDate),
  ]);

  return (
    <MrpClient
      initialData={data}
      initialCutoffDate={cutoffDate}
      section="trade"
      sheets={plan.rawMaterials}
    />
  );
}
