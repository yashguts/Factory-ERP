import { notFound } from "next/navigation";
import {
  getOperationDetail,
  getFamilyVariants,
  getFamilyOptions,
} from "@/lib/actions/operations";
import {
  getItemRefs,
  getCategories,
  getUnits,
} from "@/lib/actions/inventory";
import { ProgramDetailClient } from "@/components/programs/program-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProgramDetailPage({ params }: Props) {
  const { id } = await params;

  // Two concurrent chains: getFamilyVariants genuinely depends on the loaded
  // operation's family_key, so it chains after getOperationDetail — but that
  // whole chain runs alongside the argument-free reference reads, so the
  // variants hop hides under the first wave instead of costing an extra serial
  // cross-region round-trip.
  const [{ operation, variants }, [itemRefs, categories, units, familyOptions]] =
    await Promise.all([
      (async () => {
        const operation = await getOperationDetail(id);
        // Sibling material/finish variants (same family) for the variant switcher.
        const variants = operation
          ? await getFamilyVariants(operation.family_key)
          : [];
        return { operation, variants };
      })(),
      Promise.all([getItemRefs(), getCategories(), getUnits(), getFamilyOptions()]),
    ]);

  if (!operation) notFound();

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
