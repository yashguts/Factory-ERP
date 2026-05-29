import { getInventoryChanges } from "@/lib/actions/inventory-changes";
import { DailyChangesClient } from "@/components/inventory/daily-changes-client";

interface Props {
  searchParams: Promise<{ date?: string }>;
}

/** Today's date in IST (the business's timezone), as YYYY-MM-DD. */
function todayInIst(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export default async function InventoryChangesPage({ searchParams }: Props) {
  const params = await searchParams;
  const date = params.date || todayInIst();
  const rows = await getInventoryChanges(date);

  return (
    <DailyChangesClient initialRows={rows} date={date} maxDate={todayInIst()} />
  );
}
