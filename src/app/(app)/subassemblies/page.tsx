import { getSubassemblies } from "@/lib/actions/item-bom";
import { SubassembliesClient } from "@/components/inventory/subassemblies-client";

export const metadata = { title: "Sub-assemblies" };

export default async function SubassembliesPage() {
  const rows = await getSubassemblies();
  return <SubassembliesClient rows={rows} />;
}
