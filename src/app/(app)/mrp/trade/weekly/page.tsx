import { getWeeklyMrpPlan } from "@/lib/actions/mrp-weekly";
import { getJobScopeOptions } from "@/lib/actions/mrp";
import { TradeWeeklyClient } from "@/components/mrp/trade-weekly-client";

interface Props {
  searchParams: Promise<{ exclude?: string; jobs?: string }>;
}

// Trade weekly planner. Shares the cached getWeeklyMrpPlan with the Make weekly
// view (same args → same cache entry), so it adds no extra computation — it just
// renders the plan's `trade` lane.
export default async function TradeWeeklyPage({ searchParams }: Props) {
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
  return <TradeWeeklyClient plan={plan} scopeOptions={scopeOptions} />;
}
