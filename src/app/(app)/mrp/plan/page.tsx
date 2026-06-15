import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<{ date?: string }>;
}

// The Buy list moved to Trade MRP (/mrp/trade/buy) — buying steel/parts is a
// trade activity. Keep this path working for old links/bookmarks.
export default async function ProductionPlanRedirect({ searchParams }: Props) {
  const { date } = await searchParams;
  redirect(`/mrp/trade/buy${date ? `?date=${encodeURIComponent(date)}` : ""}`);
}
