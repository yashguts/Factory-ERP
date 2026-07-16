import { getMrpData, getAdHocShortfall, getJobScopeOptions } from "@/lib/actions/mrp";
import { MrpClient } from "@/components/mrp/mrp-client";

interface Props {
  searchParams: Promise<{ date?: string; jobs?: string }>;
}

export default async function MrpPage({ searchParams }: Props) {
  const params = await searchParams;
  const cutoffDate = params.date || undefined;
  // ?jobs=id1,id2 scopes the whole plan to those Job Orders (the date cutoff
  // doesn't apply to an explicit pick); absent = all in-production jobs.
  const jobIds = (params.jobs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [data, scopeOptions] = await Promise.all([
    jobIds.length ? getAdHocShortfall(jobIds) : getMrpData(cutoffDate),
    getJobScopeOptions(),
  ]);

  return (
    <MrpClient
      initialData={data}
      initialCutoffDate={cutoffDate}
      section="make"
      scopeOptions={scopeOptions}
    />
  );
}
