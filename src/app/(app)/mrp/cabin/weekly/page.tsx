import { getCabinWeekly } from "@/lib/actions/cabin-mrp";
import { getCabinScopeData } from "@/lib/actions/job-sets";
import { CabinWeeklyClient } from "@/components/mrp/cabin-weekly-client";

export const metadata = { title: "Cabin MRP — Weekly" };

interface Props {
  searchParams: Promise<{ jobs?: string; set?: string }>;
}

export default async function CabinWeeklyPage({ searchParams }: Props) {
  const { jobs, set } = await searchParams;
  // ?jobs=id1,id2 scopes the weekly plan to those cabin jobs; ?set=<id> scopes
  // it to the cabin jobs matching a saved job set's job numbers; absent = all
  // eligible jobs (excludes Hold / fully dispatched / ready).
  const { scope, cabinJobIds } = await getCabinScopeData(jobs, set);
  const plan = await getCabinWeekly(cabinJobIds);
  return <CabinWeeklyClient plan={plan} scope={scope} />;
}
