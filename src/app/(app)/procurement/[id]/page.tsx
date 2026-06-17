import { notFound } from "next/navigation";
import { getPurchaseOrder, getPoReceipts, getPoChangeLog } from "@/lib/actions/procurement";
import { getUnits } from "@/lib/actions/inventory";
import { PoDetailClient } from "@/components/procurement/po-detail-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PurchaseOrderPage({ params }: Props) {
  const { id } = await params;
  const [data, receipts, changeLog, units] = await Promise.all([
    getPurchaseOrder(id),
    getPoReceipts(id),
    getPoChangeLog(id),
    getUnits(),
  ]);
  if (!data) notFound();
  return (
    <PoDetailClient
      po={data.po}
      lines={data.lines}
      receipts={receipts}
      changeLog={changeLog}
      units={units}
    />
  );
}
