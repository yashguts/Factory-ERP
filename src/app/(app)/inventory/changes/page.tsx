import { getInventoryChanges } from "@/lib/actions/inventory-changes";
import { DailyChangesClient } from "@/components/inventory/daily-changes-client";

interface Props {
  searchParams: Promise<{ date?: string; from?: string; to?: string }>;
}

/** Today's date in IST (the business's timezone), as YYYY-MM-DD. */
function todayInIst(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Whole days between two YYYY-MM-DD strings (UTC noon avoids any DST drift). */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000,
  );
}

function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export default async function InventoryChangesPage({ searchParams }: Props) {
  const params = await searchParams;
  const today = todayInIst();
  // Resolve a date range. Legacy single-day links (?date=) still work: they
  // collapse to from === to. Guard swapped inputs and clamp absurd spans.
  let from = params.from || params.date || today;
  let to = params.to || params.date || today;
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) > 366) from = addDays(to, -366);

  const rows = await getInventoryChanges(from, to);

  return (
    <DailyChangesClient initialRows={rows} from={from} to={to} maxDate={today} />
  );
}
