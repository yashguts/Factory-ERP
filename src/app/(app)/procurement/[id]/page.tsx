import { notFound } from "next/navigation";
import { getPurchaseOrder, getPoReceipts } from "@/lib/actions/procurement";
import { PoDetailClient } from "@/components/procurement/po-detail-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PurchaseOrderPage({ params }: Props) {
  const { id } = await params;
  const [data, receipts] = await Promise.all([getPurchaseOrder(id), getPoReceipts(id)]);
  if (!data) notFound();
  return <PoDetailClient po={data.po} lines={data.lines} receipts={receipts} />;
}
