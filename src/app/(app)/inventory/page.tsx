import {
  getInventoryFirstPage,
  getInventoryTabCounts,
  getItemTypeCategoryFacets,
  getCategories,
  getUnits,
  getWarehouses,
} from "@/lib/actions/inventory";
import { InventoryClient } from "@/components/inventory/inventory-client";

interface Props {
  searchParams: Promise<{ edit?: string }>;
}

export default async function InventoryPage({ searchParams }: Props) {
  // Only the first page (~50 rows) + small lookup data are sent to the browser.
  // Search / filter / sort / paging are done server-side via getInventoryPage.
  const [params, firstPage, tabCounts, facets, categories, units, warehouses] =
    await Promise.all([
      searchParams,
      getInventoryFirstPage(),
      getInventoryTabCounts(),
      getItemTypeCategoryFacets(),
      getCategories(),
      getUnits(),
      getWarehouses(),
    ]);

  return (
    <InventoryClient
      initialRows={firstPage.rows}
      initialTotal={firstPage.total}
      tabCounts={tabCounts}
      facets={facets}
      categories={categories}
      units={units}
      warehouses={warehouses}
      initialEditItemId={params.edit ?? null}
    />
  );
}
