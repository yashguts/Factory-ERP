import { getWeeklyMrpPlan } from "@/lib/actions/mrp-weekly";
import { getJobScopeData } from "@/lib/actions/job-sets";
import { WeeklyMrpClient } from "@/components/mrp/weekly-mrp-client";

interface Props {
  searchParams: Promise<{ exclude?: string; jobs?: string; set?: string }>;
}

export default async function WeeklyMrpPage({ searchParams }: Props) {
  const { exclude, jobs, set } = await searchParams;
  const excludeCodes = (exclude ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // ?jobs= (ad-hoc pick) or ?set= (saved set) scopes the weekly demand.
  const { scope, jobIds } = await getJobScopeData(jobs, set);
  const plan = await getWeeklyMrpPlan(excludeCodes, jobIds.length ? jobIds : undefined);
  return <WeeklyMrpClient plan={plan} scope={scope} />;
}
