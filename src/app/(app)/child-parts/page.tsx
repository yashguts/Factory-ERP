import { getChildPartGroups } from "@/lib/actions/child-parts";
import { ChildPartsClient } from "@/components/child-parts/child-parts-client";

// Always render fresh: membership depends on which programs ran (>= cutover) and
// child-part stock, both of which move constantly. Static caching made a newly-run
// sub-assembly (e.g. Auto Door Post after its 30-Jun run) not appear until a deploy.
export const dynamic = "force-dynamic";

/** Factory runs on IST — "today" in Asia/Kolkata regardless of server TZ. */
function istTodayISO(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function ChildPartsPage() {
  const groups = await getChildPartGroups();
  return <ChildPartsClient groups={groups} today={istTodayISO()} />;
}
