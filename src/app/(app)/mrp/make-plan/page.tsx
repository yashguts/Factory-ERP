import { getMakeProductionPlan } from "@/lib/actions/production-plan";
import { getJobScopeData } from "@/lib/actions/job-sets";
import { MakePlanClient } from "@/components/mrp/make-plan-client";

interface Props {
  searchParams: Promise<{ date?: string; exclude?: string; jobs?: string; set?: string }>;
}

export default async function MakePlanPage({ searchParams }: Props) {
  const { date, exclude, jobs, set } = await searchParams;
  const excludeCodes = (exclude ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // ?jobs= (ad-hoc pick) or ?set= (saved set) optimises the run plan for just
  // those Job Orders.
  const { scope, jobIds } = await getJobScopeData(jobs, set);
  const plan = await getMakeProductionPlan(
    date || undefined,
    excludeCodes,
    jobIds.length ? jobIds : undefined,
  );
  return <MakePlanClient plan={plan} scope={scope} />;
}
