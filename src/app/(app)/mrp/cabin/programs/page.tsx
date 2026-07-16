import { getCabinMrp } from "@/lib/actions/cabin-mrp";
import { getCabinScopeData } from "@/lib/actions/job-sets";
import { CabinMrpClient } from "@/components/mrp/cabin-mrp-client";

interface Props {
  searchParams: Promise<{ exclude?: string; jobs?: string; set?: string }>;
}

export default async function CabinProgramsToRunPage({ searchParams }: Props) {
  const { exclude, jobs, set } = await searchParams;
  const excludeKeys = (exclude ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // ?jobs=id1,id2 scopes the optimiser to those cabin jobs; ?set=<id> scopes
  // it to the cabin jobs matching a saved job set's job numbers; absent = all
  // eligible jobs (excludes Hold / fully dispatched / ready).
  const { scope, cabinJobIds } = await getCabinScopeData(jobs, set);
  const plan = await getCabinMrp(excludeKeys, cabinJobIds);
  return <CabinMrpClient plan={plan} scope={scope} />;
}
