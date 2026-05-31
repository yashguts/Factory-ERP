import { notFound } from "next/navigation";
import { getItemBom } from "@/lib/actions/item-bom";
import { getOperationsForItem } from "@/lib/actions/operations";
import {
  getItemsWithStock,
  getCategories,
  getUnits,
} from "@/lib/actions/inventory";
import { ItemDetailClient } from "@/components/inventory/item-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ItemDetailPage({ params }: Props) {
  const { id } = await params;

  const [bom, ops, items, categories, units] = await Promise.all([
    getItemBom(id),
    getOperationsForItem(id),
    getItemsWithStock(),
    getCategories(),
    getUnits(),
  ]);

  if (!bom) notFound();

  // ItemFormModal (the inline "create loose part") only needs type + category
  // to build its filtered category dropdowns.
  const itemRefs = items.map((i) => ({
    item_type: i.item_type,
    category_id: i.category_id,
  }));

  return (
    <ItemDetailClient
      bom={bom}
      producedBy={ops.produces}
      consumedBy={ops.consumes}
      categories={categories}
      units={units}
      itemRefs={itemRefs}
    />
  );
}
