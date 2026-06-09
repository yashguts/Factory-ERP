import { getMakeProductionPlan } from "@/lib/actions/production-plan";
import { MakePlanClient } from "@/components/mrp/make-plan-client";

interface Props {
  searchParams: Promise<{ date?: string }>;
}

export default async function MakePlanPage({ searchParams }: Props) {
  const { date } = await searchParams;
  const plan = await getMakeProductionPlan(date || undefined);
  return <MakePlanClient plan={plan} />;
}
