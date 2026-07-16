import { getWeeklyMrpPlan } from "@/lib/actions/mrp-weekly";
import { getJobScopeOptions } from "@/lib/actions/mrp";
import { WeeklyMrpClient } from "@/components/mrp/weekly-mrp-client";

interface Props {
  searchParams: Promise<{ exclude?: string; jobs?: string }>;
}

export default async function WeeklyMrpPage({ searchParams }: Props) {
  const { exclude, jobs } = await searchParams;
  const excludeCodes = (exclude ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // ?jobs=id1,id2 scopes the weekly demand to just those Job Orders.
  const jobIds = (jobs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [plan, scopeOptions] = await Promise.all([
    getWeeklyMrpPlan(excludeCodes, jobIds.length ? jobIds : undefined),
    getJobScopeOptions(),
  ]);
  return <WeeklyMrpClient plan={plan} scopeOptions={scopeOptions} />;
}
