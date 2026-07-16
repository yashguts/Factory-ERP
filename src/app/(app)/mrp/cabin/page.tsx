import { getCabinRequirements } from "@/lib/actions/cabin-mrp";
import { getCabinScopeData } from "@/lib/actions/job-sets";
import { CabinRequirementsClient } from "@/components/mrp/cabin-requirements-client";

export const metadata = { title: "Cabin MRP — Requirements" };

interface Props {
  searchParams: Promise<{ jobs?: string; set?: string }>;
}

export default async function CabinRequirementsPage({ searchParams }: Props) {
  const { jobs, set } = await searchParams;
  // ?jobs=id1,id2 scopes the whole plan to those cabin jobs; ?set=<id> scopes
  // it to the cabin jobs matching a saved job set's job numbers; absent = all
  // eligible jobs (excludes Hold / fully dispatched / ready).
  const { scope, cabinJobIds } = await getCabinScopeData(jobs, set);
  const rows = await getCabinRequirements(cabinJobIds);
  return <CabinRequirementsClient rows={rows} scope={scope} />;
}
