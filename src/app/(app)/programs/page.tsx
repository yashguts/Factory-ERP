import { getOperations } from "@/lib/actions/operations";
import {
  getItemsWithStock,
  getCategories,
  getUnits,
} from "@/lib/actions/inventory";
import { ProgramsClient } from "@/components/programs/programs-client";

export default async function ProgramsPage() {
  const [operations, items, categories, units] = await Promise.all([
    getOperations(),
    getItemsWithStock(),
    getCategories(),
    getUnits(),
  ]);

  // ItemFormModal (inline "create new item") only needs type + category to
  // build its filtered category dropdowns.
  const itemRefs = items.map((i) => ({
    item_type: i.item_type,
    category_id: i.category_id,
  }));

  return (
    <ProgramsClient
      initialOperations={operations}
      categories={categories}
      units={units}
      itemRefs={itemRefs}
    />
  );
}
