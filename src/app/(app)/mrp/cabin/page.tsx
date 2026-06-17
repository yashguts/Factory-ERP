import { getCabinMrp } from "@/lib/actions/cabin-program-plan";
import { CabinMrpClient } from "@/components/mrp/cabin-mrp-client";

export const metadata = { title: "Cabin MRP" };

export default async function CabinMrpPage() {
  const plan = await getCabinMrp();
  return <CabinMrpClient plan={plan} />;
}
