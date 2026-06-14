import { getProcurementData } from "@/lib/actions/procurement";
import { ProcurementClient } from "@/components/procurement/procurement-client";

export const dynamic = "force-dynamic";

export default async function ProcurementPage() {
  const data = await getProcurementData();
  return <ProcurementClient data={data} />;
}
