import { getOperations } from "@/lib/actions/operations";
import {
  getItemRefs,
  getCategories,
  getUnits,
} from "@/lib/actions/inventory";
import { ProgramsClient } from "@/components/programs/programs-client";

export default async function ProgramsPage() {
  const [operations, itemRefs, categories, units] = await Promise.all([
    getOperations(),
    getItemRefs(),
    getCategories(),
    getUnits(),
  ]);

  return (
    <ProgramsClient
      initialOperations={operations}
      categories={categories}
      units={units}
      itemRefs={itemRefs}
    />
  );
}
