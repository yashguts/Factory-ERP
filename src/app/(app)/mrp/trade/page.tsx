import { getMrpData } from "@/lib/actions/mrp";
import { MrpClient } from "@/components/mrp/mrp-client";

interface Props {
  searchParams: Promise<{ date?: string }>;
}

// Trade MRP — the bought-in side of the requirements table, locked to trade
// items (its own sidebar section). Shares getMrpData with the Make side, so the
// on-order / to-buy PO netting and derived trade-part demand are identical.
export default async function TradeMrpPage({ searchParams }: Props) {
  const params = await searchParams;
  const cutoffDate = params.date || undefined;
  const data = await getMrpData(cutoffDate);

  return (
    <MrpClient
      initialData={data}
      initialCutoffDate={cutoffDate}
      section="trade"
    />
  );
}
