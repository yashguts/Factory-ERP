import { getInventoryPage } from "@/lib/actions/inventory";
import { DemandBuilderClient } from "@/components/demand/demand-builder-client";

export const metadata = { title: "Demand Rules" };

export default async function DemandPage() {
  const initial = await getInventoryPage({ demand: "none", page: 1, pageSize: 50, sort: "code", dir: "asc" });
  return <DemandBuilderClient initialRows={initial.rows} initialTotal={initial.total} />;
}
