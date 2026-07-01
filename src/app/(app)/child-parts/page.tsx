import { getChildPartGroups } from "@/lib/actions/child-parts";
import { ChildPartsClient } from "@/components/child-parts/child-parts-client";

/** Factory runs on IST — "today" in Asia/Kolkata regardless of server TZ. */
function istTodayISO(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function ChildPartsPage() {
  const groups = await getChildPartGroups();
  return <ChildPartsClient groups={groups} today={istTodayISO()} />;
}
