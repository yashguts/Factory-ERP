import { getMrpData, getAdHocShortfall } from "@/lib/actions/mrp";
import { getJobScopeData } from "@/lib/actions/job-sets";
import { MrpClient } from "@/components/mrp/mrp-client";

interface Props {
  searchParams: Promise<{ date?: string; jobs?: string; set?: string }>;
}

export default async function MrpPage({ searchParams }: Props) {
  const params = await searchParams;
  const cutoffDate = params.date || undefined;
  // ?jobs=id1,id2 (ad-hoc pick) or ?set=<id> (saved set, e.g. "Urgent") scopes
  // the whole plan to those Job Orders — the date cutoff doesn't apply to an
  // explicit scope. Absent = all in-production jobs.
  const { scope, jobIds } = await getJobScopeData(params.jobs, params.set);
  const data = jobIds.length ? await getAdHocShortfall(jobIds) : await getMrpData(cutoffDate);

  return (
    <MrpClient
      initialData={data}
      initialCutoffDate={cutoffDate}
      section="make"
      scope={scope}
    />
  );
}
