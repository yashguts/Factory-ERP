import { getMrpData } from "@/lib/actions/mrp";
import { MrpClient } from "@/components/mrp/mrp-client";

interface Props {
  searchParams: Promise<{ date?: string }>;
}

export default async function MrpPage({ searchParams }: Props) {
  const params = await searchParams;
  const cutoffDate = params.date || undefined;
  const data = await getMrpData(cutoffDate);

  return (
    <MrpClient
      initialData={data}
      initialCutoffDate={cutoffDate}
    />
  );
}
