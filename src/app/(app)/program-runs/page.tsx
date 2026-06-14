import { getRunsForDate } from "@/lib/actions/operation-runs";
import { getWeeklyMrpPlan } from "@/lib/actions/mrp-weekly";
import { DailyRunsClient, type PlannedProgram } from "@/components/programs/daily-runs-client";

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

  // Pull the day's log AND the once-optimised weekly plan together. The plan is
  // read-only here (the locked optimiser is untouched) — we just surface this
  // week's planned runs as a checklist against what's actually been logged.
  const [rows, plan] = await Promise.all([getRunsForDate(day), getWeeklyMrpPlan()]);

  const curIdx = plan.weeks.findIndex((w) => w.isCurrent);
  const planned: PlannedProgram[] =
    curIdx >= 0
      ? plan.programs
          .filter((p) => p.runsPerWeek[curIdx] > 0)
          .map((p) => ({
            program_id: p.program_id,
            code: p.code,
            name: p.name,
            machine: p.machine,
            planned: p.runsPerWeek[curIdx],
          }))
          .sort((a, b) => b.planned - a.planned)
      : [];
  const weekLabel = curIdx >= 0 ? plan.weeks[curIdx].title : "";

  return (
    <DailyRunsClient
      date={day}
      maxDate={today}
      initialRows={rows}
      planned={planned}
      weekLabel={weekLabel}
    />
  );
}
