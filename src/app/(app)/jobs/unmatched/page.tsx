import { getUnmatchedBomSummary } from "@/lib/actions/bom-mapping";
import { UnmatchedClient } from "@/components/jobs/unmatched-client";

export default async function UnmatchedBomPage() {
  const patterns = await getUnmatchedBomSummary();
  return <UnmatchedClient initialPatterns={patterns} />;
}
