import { getItemsWithStock, getCategories, getUnits, getWarehouses } from "@/lib/actions/inventory";
import { InventoryClient } from "@/components/inventory/inventory-client";

interface Props {
  searchParams: Promise<{ edit?: string }>;
}

export default async function InventoryPage({ searchParams }: Props) {
  const [params, items, categories, units, warehouses] = await Promise.all([
    searchParams,
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
      initialEditItemId={params.edit ?? null}
    />
  );
}
