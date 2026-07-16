import { getMakeProductionPlan } from "@/lib/actions/production-plan";
import { getJobScopeOptions } from "@/lib/actions/mrp";
import { MakePlanClient } from "@/components/mrp/make-plan-client";

interface Props {
  searchParams: Promise<{ date?: string; exclude?: string; jobs?: string }>;
}

export default async function MakePlanPage({ searchParams }: Props) {
  const { date, exclude, jobs } = await searchParams;
  const excludeCodes = (exclude ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // ?jobs=id1,id2 optimises the run plan for just those Job Orders.
  const jobIds = (jobs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [plan, scopeOptions] = await Promise.all([
    getMakeProductionPlan(date || undefined, excludeCodes, jobIds.length ? jobIds : undefined),
    getJobScopeOptions(),
  ]);
  return <MakePlanClient plan={plan} scopeOptions={scopeOptions} />;
}
