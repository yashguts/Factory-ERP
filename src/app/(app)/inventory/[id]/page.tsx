import { notFound } from "next/navigation";
import { getItemBom } from "@/lib/actions/item-bom";
import { getOperationsForItem } from "@/lib/actions/operations";
import { ItemDetailClient } from "@/components/inventory/item-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ItemDetailPage({ params }: Props) {
  const { id } = await params;

  const [bom, ops] = await Promise.all([
    getItemBom(id),
    getOperationsForItem(id),
  ]);

  if (!bom) notFound();

  return (
    <ItemDetailClient
      bom={bom}
      producedBy={ops.produces}
      consumedBy={ops.consumes}
    />
  );
}
