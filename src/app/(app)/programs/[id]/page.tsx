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

  // getFamilyOptions() is argument-free, so it joins the first wave instead of
  // paying a second serial cross-region hop. Only getFamilyVariants genuinely
  // depends on the loaded operation's family_key.
  const [operation, itemRefs, categories, units, familyOptions] = await Promise.all([
    getOperationDetail(id),
    getItemRefs(),
    getCategories(),
    getUnits(),
    getFamilyOptions(),
  ]);

  if (!operation) notFound();

  // Sibling material/finish variants (same family) for the variant switcher.
  const variants = await getFamilyVariants(operation.family_key);

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
