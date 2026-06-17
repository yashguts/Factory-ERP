import { getCabinPrograms } from "@/lib/actions/cabin-programs";
import { CabinProgramsClient } from "@/components/cabin/cabin-programs-client";

export const metadata = { title: "Cabin Programs" };

export default async function CabinProgramsPage() {
  const programs = await getCabinPrograms();
  return <CabinProgramsClient programs={programs} />;
}
