import { getCabinWeekly, getCabinScopeOptions } from "@/lib/actions/cabin-mrp";
import { CabinWeeklyClient } from "@/components/mrp/cabin-weekly-client";

export const metadata = { title: "Cabin MRP — Weekly" };

interface Props {
  searchParams: Promise<{ jobs?: string }>;
}

export default async function CabinWeeklyPage({ searchParams }: Props) {
  const { jobs } = await searchParams;
  // ?jobs=id1,id2 scopes the weekly plan to those cabin jobs; absent = all
  // eligible jobs (excludes Hold / fully dispatched / ready).
  const jobIds = (jobs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [plan, scopeOptions] = await Promise.all([
    getCabinWeekly(jobIds),
    getCabinScopeOptions(),
  ]);
  return <CabinWeeklyClient plan={plan} scopeOptions={scopeOptions} />;
}
