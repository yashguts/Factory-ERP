import { Ralph400Client } from "@/components/ralph400/ralph400-client";
import { getFactoryStructureJobs } from "@/lib/actions/jobs";

export const metadata = { title: "RALPH 400 BOM" };

/**
 * RALPH 400 shaft BOM calculator — the RALPH400_BOM sub-program, ported in
 * from its standalone repo. Pure client-side arithmetic over Sheet2 of
 * "RALPH 400 BOM.xlsx"; the only server data is the Job-No dropdown, which
 * lists jobs with Structure = Factory-made (the jobs this BOM applies to).
 */
export default async function Ralph400Page() {
  const jobs = await getFactoryStructureJobs();
  return <Ralph400Client jobs={jobs} />;
}
