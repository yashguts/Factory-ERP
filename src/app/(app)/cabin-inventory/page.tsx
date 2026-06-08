import { Container } from "lucide-react";
import { CABIN_TYPES } from "@/lib/cabin/cabin-types";
import { getCabinTypeSummary } from "@/lib/actions/cabin";

export const metadata = { title: "Cabin Inventory" };

export default async function CabinInventoryPage() {
  const summary = await getCabinTypeSummary();
  const countByName = new Map(summary.map((s) => [s.name, s.itemCount]));
  const totalItems = summary.reduce((a, s) => a + s.itemCount, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Container className="h-6 w-6" /> Cabin Inventory
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Cabin panels &amp; parts, organised by type. {CABIN_TYPES.length} types
          {totalItems > 0 ? ` · ${totalItems} items` : ""}.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CABIN_TYPES.map((name) => {
          const count = countByName.get(name) ?? 0;
          return (
            <div
              key={name}
              className="card-surface p-4 flex items-center justify-between"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{name}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {count} item{count === 1 ? "" : "s"}
                </div>
              </div>
              <Container className="h-5 w-5 text-[var(--muted-foreground)] opacity-40 shrink-0" />
            </div>
          );
        })}
      </div>

      {totalItems === 0 && (
        <p className="text-xs text-[var(--muted-foreground)] mt-4">
          These types are ready — they&rsquo;ll fill up once cabin panels are added
          or imported.
        </p>
      )}
    </div>
  );
}
