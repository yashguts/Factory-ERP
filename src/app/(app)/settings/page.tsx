import { getOverstockItems, getDemandRulesDoc } from "@/lib/actions/settings";
import { SettingsClient } from "@/components/settings/settings-client";

export const metadata = { title: "Settings" };

// Settings — first cut: an overstock report (stock far above current requirement)
// and a plain-English doc of every rule the ERP uses to generate demand. Both
// reuse cached MRP / stock reads, so the page is cheap.
export default async function SettingsPage() {
  const [overstock, rules] = await Promise.all([
    getOverstockItems(),
    getDemandRulesDoc(),
  ]);
  return <SettingsClient overstock={overstock} rules={rules} />;
}
