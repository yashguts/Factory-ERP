import { getWeeklyMrpPlan } from "@/lib/actions/mrp-weekly";
import { TradeWeeklyClient } from "@/components/mrp/trade-weekly-client";

interface Props {
  searchParams: Promise<{ exclude?: string }>;
}

// Trade weekly planner. Shares the cached getWeeklyMrpPlan with the Make weekly
// view (same args → same cache entry), so it adds no extra computation — it just
// renders the plan's `trade` lane.
export default async function TradeWeeklyPage({ searchParams }: Props) {
  const { exclude } = await searchParams;
  const excludeCodes = (exclude ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const plan = await getWeeklyMrpPlan(excludeCodes);
  return <TradeWeeklyClient plan={plan} />;
}
