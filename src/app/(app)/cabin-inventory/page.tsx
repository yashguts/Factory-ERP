import { Container } from "lucide-react";

export const metadata = { title: "Cabin Inventory" };

export default function CabinInventoryPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Container className="h-6 w-6" /> Cabin Inventory
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          The cabin panels and cabin-specific parts that go into an elevator car.
        </p>
      </div>

      <div className="card-surface p-10 text-center">
        <Container className="h-9 w-9 mx-auto text-[var(--muted-foreground)] opacity-50" />
        <p className="text-sm font-medium mt-3">No cabin items yet</p>
        <p className="text-sm text-[var(--muted-foreground)] mt-1 max-w-xl mx-auto">
          This section will hold the cabin panel catalog — organised by the
          dimensions we mapped from your sheet: panel type &amp; size
          (STD&nbsp;/&nbsp;BIG&nbsp;/&nbsp;2400&nbsp;/&nbsp;Goods), material
          (MS&nbsp;/&nbsp;SS), surface finish, and thickness. Import the cabin
          panels to populate it.
        </p>
      </div>
    </div>
  );
}
