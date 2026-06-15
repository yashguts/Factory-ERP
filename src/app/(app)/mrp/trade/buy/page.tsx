import { getProductionPlan } from "@/lib/actions/mrp";
import { ProductionPlanClient } from "@/components/mrp/production-plan-client";

interface Props {
  searchParams: Promise<{ date?: string }>;
}

// Buy list — steel sheets/plates + bought parts to procure (job demand exploded
// through programs & parts lists). All purchased, so it lives under Trade MRP.
export default async function TradeBuyPage({ searchParams }: Props) {
  const { date } = await searchParams;
  const plan = await getProductionPlan(date || undefined);
  return <ProductionPlanClient plan={plan} section="trade" />;
}
