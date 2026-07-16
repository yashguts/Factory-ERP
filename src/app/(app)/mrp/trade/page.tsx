import { getMrpData, getAdHocShortfall, getProductionPlan, getJobScopeOptions } from "@/lib/actions/mrp";
import { MrpClient } from "@/components/mrp/mrp-client";

interface Props {
  searchParams: Promise<{ date?: string; jobs?: string }>;
}

// Trade MRP — the one "what to buy" page. Trade items (bought parts) come from
// getMrpData; the exploded raw steel / sheets that feed the make programs come
// from getProductionPlan and are folded in as their own category group, so the
// purchasing team sees the complete buy list in one place, by category.
export default async function TradeMrpPage({ searchParams }: Props) {
  const params = await searchParams;
  const cutoffDate = params.date || undefined;
  // ?jobs=id1,id2 scopes both the trade items AND the exploded sheets to those
  // Job Orders (the date cutoff doesn't apply to an explicit pick).
  const jobIds = (params.jobs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [data, plan, scopeOptions] = await Promise.all([
    jobIds.length ? getAdHocShortfall(jobIds) : getMrpData(cutoffDate),
    getProductionPlan(cutoffDate, jobIds.length ? jobIds : undefined),
    getJobScopeOptions(),
  ]);

  return (
    <MrpClient
      initialData={data}
      initialCutoffDate={cutoffDate}
      section="trade"
      sheets={plan.rawMaterials}
      scopeOptions={scopeOptions}
    />
  );
}
