import { getMakeProductionPlan } from "@/lib/actions/production-plan";
import { MakePlanClient } from "@/components/mrp/make-plan-client";

interface Props {
  searchParams: Promise<{ date?: string; exclude?: string }>;
}

export default async function MakePlanPage({ searchParams }: Props) {
  const { date, exclude } = await searchParams;
  const excludeCodes = (exclude ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const plan = await getMakeProductionPlan(date || undefined, excludeCodes);
  return <MakePlanClient plan={plan} />;
}
