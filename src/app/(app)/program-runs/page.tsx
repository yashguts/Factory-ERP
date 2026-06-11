import { getRunsForDate } from "@/lib/actions/operation-runs";
import { DailyRunsClient } from "@/components/programs/daily-runs-client";

interface Props {
  searchParams: Promise<{ date?: string }>;
}

/** Factory runs on IST — "today" in Asia/Kolkata regardless of server TZ. */
function istTodayISO(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function ProgramRunsPage({ searchParams }: Props) {
  const { date } = await searchParams;
  const today = istTodayISO();
  const day = date || today;
  const rows = await getRunsForDate(day);
  return <DailyRunsClient date={day} maxDate={today} initialRows={rows} />;
}
