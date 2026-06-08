import Link from "next/link";
import { Container, ArrowRight } from "lucide-react";
import { CABIN_INVENTORY_TYPES } from "@/lib/cabin/cabin-types";
import { getCabinTypeSummary } from "@/lib/actions/cabin";

export const metadata = { title: "Cabin Inventory" };

export default async function CabinInventoryPage() {
  const summary = await getCabinTypeSummary();
  const byName = new Map(summary.map((s) => [s.name, s]));
  const totalItems = summary.reduce((a, s) => a + s.itemCount, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Container className="h-6 w-6" /> Cabin Inventory
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Cabin panels &amp; parts, organised by type. {CABIN_INVENTORY_TYPES.length} types
          {totalItems > 0 ? ` · ${totalItems} items` : ""}.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CABIN_INVENTORY_TYPES.map((name) => {
          const s = byName.get(name);
          const count = s?.itemCount ?? 0;
          const inner = (
            <>
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{name}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {count} item{count === 1 ? "" : "s"}
                </div>
              </div>
              {s?.id ? (
                <ArrowRight className="h-4 w-4 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 group-hover:text-[var(--primary)] transition-opacity shrink-0" />
              ) : (
                <Container className="h-5 w-5 text-[var(--muted-foreground)] opacity-40 shrink-0" />
              )}
            </>
          );
          return s?.id ? (
            <Link
              key={name}
              href={`/cabin-inventory/${s.id}`}
              className="card-surface p-4 flex items-center justify-between hover:bg-[var(--muted)]/50 transition-colors cursor-pointer group"
            >
              {inner}
            </Link>
          ) : (
            <div
              key={name}
              className="card-surface p-4 flex items-center justify-between opacity-70"
            >
              {inner}
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
