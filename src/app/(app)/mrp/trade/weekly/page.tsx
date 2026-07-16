import { getWeeklyMrpPlan } from "@/lib/actions/mrp-weekly";
import { getJobScopeData } from "@/lib/actions/job-sets";
import { TradeWeeklyClient } from "@/components/mrp/trade-weekly-client";

interface Props {
  searchParams: Promise<{ exclude?: string; jobs?: string; set?: string }>;
}

// Trade weekly planner. Shares the cached getWeeklyMrpPlan with the Make weekly
// view (same args → same cache entry), so it adds no extra computation — it just
// renders the plan's `trade` lane.
export default async function TradeWeeklyPage({ searchParams }: Props) {
  const { exclude, jobs, set } = await searchParams;
  const excludeCodes = (exclude ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // ?jobs= (ad-hoc pick) or ?set= (saved set) scopes the weekly demand.
  const { scope, jobIds } = await getJobScopeData(jobs, set);
  const plan = await getWeeklyMrpPlan(excludeCodes, jobIds.length ? jobIds : undefined);
  return <TradeWeeklyClient plan={plan} scope={scope} />;
}
