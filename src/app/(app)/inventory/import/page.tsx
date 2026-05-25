import { getWarehouses } from "@/lib/actions/inventory";
import { ImportClient } from "@/components/inventory/import-client";

export default async function ImportPage() {
  const warehouses = await getWarehouses();

  return <ImportClient warehouses={warehouses} />;
}
