import { getWeeklyMrpPlan } from "@/lib/actions/mrp-weekly";
import { WeeklyMrpClient } from "@/components/mrp/weekly-mrp-client";

interface Props {
  searchParams: Promise<{ exclude?: string }>;
}

export default async function WeeklyMrpPage({ searchParams }: Props) {
  const { exclude } = await searchParams;
  const excludeCodes = (exclude ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const plan = await getWeeklyMrpPlan(excludeCodes);
  return <WeeklyMrpClient plan={plan} />;
}
