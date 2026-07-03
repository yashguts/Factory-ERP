import { getCabinWeekly } from "@/lib/actions/cabin-program-plan";
import { CabinWeeklyClient } from "@/components/mrp/cabin-weekly-client";

export const metadata = { title: "Cabin MRP — Weekly" };

export default async function CabinWeeklyPage() {
  const plan = await getCabinWeekly();
  return <CabinWeeklyClient plan={plan} />;
}
