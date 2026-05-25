import { getItemsWithStock, getCategories, getUnits, getWarehouses } from "@/lib/actions/inventory";
import { InventoryClient } from "@/components/inventory/inventory-client";

export default async function InventoryPage() {
  const [items, categories, units, warehouses] = await Promise.all([
    getItemsWithStock(),
    getCategories(),
    getUnits(),
    getWarehouses(),
  ]);

  return (
    <InventoryClient
      initialItems={items}
      categories={categories}
      units={units}
      warehouses={warehouses}
    />
  );
}
