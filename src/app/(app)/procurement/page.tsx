import { getPurchaseOrders } from "@/lib/actions/procurement";
import { ProcurementClient } from "@/components/procurement/procurement-client";

export const dynamic = "force-dynamic";

export default async function ProcurementPage() {
  const orders = await getPurchaseOrders();
  return <ProcurementClient orders={orders} />;
}
