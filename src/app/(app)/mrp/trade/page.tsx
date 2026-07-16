import { getMrpData, getAdHocShortfall, getProductionPlan } from "@/lib/actions/mrp";
import { getJobScopeData } from "@/lib/actions/job-sets";
import { MrpClient } from "@/components/mrp/mrp-client";

interface Props {
  searchParams: Promise<{ date?: string; jobs?: string; set?: string }>;
}

// Trade MRP — the one "what to buy" page. Trade items (bought parts) come from
// getMrpData; the exploded raw steel / sheets that feed the make programs come
// from getProductionPlan and are folded in as their own category group, so the
// purchasing team sees the complete buy list in one place, by category.
export default async function TradeMrpPage({ searchParams }: Props) {
  const params = await searchParams;
  const cutoffDate = params.date || undefined;
  // ?jobs= (ad-hoc pick) or ?set= (saved set) scopes both the trade items AND
  // the exploded sheets (the date cutoff doesn't apply to an explicit scope).
  const { scope, jobIds } = await getJobScopeData(params.jobs, params.set);
  const [data, plan] = await Promise.all([
    jobIds.length ? getAdHocShortfall(jobIds) : getMrpData(cutoffDate),
    getProductionPlan(cutoffDate, jobIds.length ? jobIds : undefined),
  ]);

  return (
    <MrpClient
      initialData={data}
      initialCutoffDate={cutoffDate}
      section="trade"
      sheets={plan.rawMaterials}
      scope={scope}
    />
  );
}
