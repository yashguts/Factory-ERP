import { getCabinMrp, getCabinScopeOptions } from "@/lib/actions/cabin-mrp";
import { CabinMrpClient } from "@/components/mrp/cabin-mrp-client";

interface Props {
  searchParams: Promise<{ exclude?: string; jobs?: string }>;
}

export default async function CabinProgramsToRunPage({ searchParams }: Props) {
  const { exclude, jobs } = await searchParams;
  const excludeKeys = (exclude ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // ?jobs=id1,id2 scopes the optimiser to those cabin jobs; absent = all
  // eligible jobs (excludes Hold / fully dispatched / ready).
  const jobIds = (jobs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [plan, scopeOptions] = await Promise.all([
    getCabinMrp(excludeKeys, jobIds),
    getCabinScopeOptions(),
  ]);
  return <CabinMrpClient plan={plan} scopeOptions={scopeOptions} />;
}
