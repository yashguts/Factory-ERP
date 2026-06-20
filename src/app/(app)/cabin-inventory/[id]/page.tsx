import { notFound } from "next/navigation";
import { getCabinTypeMeta, getCabinTypeFirstPage } from "@/lib/actions/cabin";
import { getWarehouses } from "@/lib/actions/inventory";
import { CabinTypeClient } from "@/components/inventory/cabin-type-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CabinTypePage({ params }: Props) {
  const { id } = await params;
  // Light identity + sub-type options, plus the first (default) page of rows —
  // both small. Subsequent pages / filtered queries are fetched client-side.
  // Warehouses drive the inline stock-adjust widget — cabin items are make
  // items whose stock should be hand-editable like regular inventory.
  const [meta, first, warehouses] = await Promise.all([
    getCabinTypeMeta(id),
    getCabinTypeFirstPage(id),
    getWarehouses(),
  ]);
  if (!meta.type) notFound();

  return (
    <CabinTypeClient
      typeId={meta.type.id}
      typeName={meta.type.name}
      subCategories={meta.subCategories}
      initialRows={first.rows}
      initialTotal={first.total}
      initialInStock={first.inStock}
      typeTotal={first.typeTotal}
      warehouses={warehouses}
    />
  );
}
