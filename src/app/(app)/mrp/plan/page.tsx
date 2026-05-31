import { getProductionPlan } from "@/lib/actions/mrp";
import { ProductionPlanClient } from "@/components/mrp/production-plan-client";

interface Props {
  searchParams: Promise<{ date?: string }>;
}

export default async function ProductionPlanPage({ searchParams }: Props) {
  const { date } = await searchParams;
  const plan = await getProductionPlan(date || undefined);
  return <ProductionPlanClient plan={plan} />;
}
