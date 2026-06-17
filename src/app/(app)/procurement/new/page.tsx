import { PoNewClient } from "@/components/procurement/po-new-client";
import { getUnits } from "@/lib/actions/inventory";

export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  const units = await getUnits();
  return <PoNewClient units={units} />;
}
