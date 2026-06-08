import { notFound } from "next/navigation";
import { getCabinTypeItems } from "@/lib/actions/cabin";
import { CabinTypeClient } from "@/components/inventory/cabin-type-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CabinTypePage({ params }: Props) {
  const { id } = await params;
  const data = await getCabinTypeItems(id);
  if (!data.type) notFound();

  return (
    <CabinTypeClient
      typeName={data.type.name}
      subCategories={data.subCategories}
      items={data.items}
    />
  );
}
