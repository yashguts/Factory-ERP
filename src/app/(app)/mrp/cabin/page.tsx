import { getCabinRequirements } from "@/lib/actions/cabin-mrp";
import { CabinRequirementsClient } from "@/components/mrp/cabin-requirements-client";

export const metadata = { title: "Cabin MRP — Requirements" };

export default async function CabinRequirementsPage() {
  const rows = await getCabinRequirements();
  return <CabinRequirementsClient rows={rows} />;
}
