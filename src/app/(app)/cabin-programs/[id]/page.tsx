import { notFound } from "next/navigation";
import { getCabinProgramDetail } from "@/lib/actions/cabin-programs";
import { CabinProgramDetailClient } from "@/components/cabin/cabin-program-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CabinProgramDetailPage({ params }: Props) {
  const { id } = await params;
  const program = await getCabinProgramDetail(id);
  if (!program) notFound();
  return <CabinProgramDetailClient program={program} />;
}
