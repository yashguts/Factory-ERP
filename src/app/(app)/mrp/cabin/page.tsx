import { getCabinMrp } from "@/lib/actions/cabin-program-plan";
import { CabinMrpClient } from "@/components/mrp/cabin-mrp-client";

interface Props {
  searchParams: Promise<{ exclude?: string }>;
}

export default async function CabinMrpPage({ searchParams }: Props) {
  const { exclude } = await searchParams;
  const excludeKeys = (exclude ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const plan = await getCabinMrp(excludeKeys);
  return <CabinMrpClient plan={plan} />;
}
