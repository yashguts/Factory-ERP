import { getCabinRequirements, getCabinScopeOptions } from "@/lib/actions/cabin-mrp";
import { CabinRequirementsClient } from "@/components/mrp/cabin-requirements-client";

export const metadata = { title: "Cabin MRP — Requirements" };

interface Props {
  searchParams: Promise<{ jobs?: string }>;
}

export default async function CabinRequirementsPage({ searchParams }: Props) {
  const { jobs } = await searchParams;
  // ?jobs=id1,id2 scopes the whole plan to those cabin jobs; absent = all
  // eligible jobs (excludes Hold / fully dispatched / ready).
  const jobIds = (jobs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [rows, scopeOptions] = await Promise.all([
    getCabinRequirements(jobIds),
    getCabinScopeOptions(),
  ]);
  return <CabinRequirementsClient rows={rows} scopeOptions={scopeOptions} />;
}
