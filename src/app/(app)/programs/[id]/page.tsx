import { notFound } from "next/navigation";
import {
  getOperationDetail,
  getFamilyVariants,
  getFamilyOptions,
} from "@/lib/actions/operations";
import {
  getItemsWithStock,
  getCategories,
  getUnits,
} from "@/lib/actions/inventory";
import { ProgramDetailClient } from "@/components/programs/program-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProgramDetailPage({ params }: Props) {
  const { id } = await params;

  const [operation, items, categories, units] = await Promise.all([
    getOperationDetail(id),
    getItemsWithStock(),
    getCategories(),
    getUnits(),
  ]);

  if (!operation) notFound();

  // Sibling material/finish variants (same family) for the variant switcher,
  // plus all families for the edit/clone form's family-autocomplete.
  const [variants, familyOptions] = await Promise.all([
    getFamilyVariants(operation.family_key),
    getFamilyOptions(),
  ]);

  const itemRefs = items.map((i) => ({
    item_type: i.item_type,
    category_id: i.category_id,
  }));

  return (
    <ProgramDetailClient
      operation={operation}
      variants={variants}
      familyOptions={familyOptions}
      categories={categories}
      units={units}
      itemRefs={itemRefs}
    />
  );
}
