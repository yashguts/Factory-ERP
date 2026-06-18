import { getInventoryHealth } from "@/lib/actions/inventory-health";
import { InventoryHealthClient } from "@/components/inventory/inventory-health-client";

export const metadata = { title: "Inventory Health" };

export default async function InventoryHealthPage() {
  const data = await getInventoryHealth();
  return <InventoryHealthClient data={data} />;
}
