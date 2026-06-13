"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarClock, AlertTriangle } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Job, JobStage } from "@/lib/supabase/types";
import type { DispatchStatus } from "@/lib/actions/dispatch";

/* ------------------------------------------------------------------ *
 * Dispatch Plan — a read-only, week-by-week picture of the Active Job
 * Orders. The top is a left-to-right stacked-bar chart of how many jobs
 * dispatch each week (split by planned phase); below it, the jobs in each
 * week as compact rows (number · customer · phase).
 *
 * Planned phase is taken purely from a job's "Required" (requirement_stage)
 * value — the office's source of truth for what the job needs prepared:
 *   first_phase   → "First Phase"   (blue)
 *   full_material → "Full Dispatch" (green)
 *   new / null    → "Not planned"   (grey)
 *
 * Nothing is mutated — it's the same active set the table shows, placed on
 * a calendar. Weeks are Monday-start (the factory's working week). Jobs
 * whose date is already past (and not fully dispatched) collect in a red
 * "Overdue" lane; dateless jobs collect in a muted "No date" lane.
 * ------------------------------------------------------------------ */

type Phase = "first" | "full" | "none";

const PHASE_META: Record<
  Phase,
  { label: string; short: string; variant: BadgeVariant; bar: string; dot: string }
> = {
  first: {
    label: "First Phase",
    short: "First",
    variant: "blue",
    bar: "bg-gradient-to-t from-blue-600 to-blue-400",
    dot: "bg-blue-500",
  },
  full: {
    label: "Full Dispatch",
    short: "Full",
    variant: "green",
    bar: "bg-gradient-to-t from-emerald-600 to-emerald-400",
    dot: "bg-emerald-500",
  },
  none: {
    label: "Not planned",
    short: "—",
    variant: "neutral",
    bar: "bg-[var(--border-strong)]",
    dot: "bg-[var(--border-strong)]",
  },
};

function phaseOf(stage: JobStage | null | undefined): Phase {
  if (stage === "first_phase") return "first";
  if (stage === "full_material") return "full";
  return "none";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_H = 150; // px, tallest bar

function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfWeekMonday(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (r.getDay() + 6) % 7; // Mon=0 … Sun=6
  r.setDate(r.getDate() - dow);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtDayMonth(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

interface PlanJob {
  id: string;
  job_number: string;
  customer_name: string | null;
  phase: Phase;
  /**
   * Full material is required but the first phase has already gone out
   * (stage advanced to first_phase) — i.e. only the second phase is left.
   * Flagged with a small "1st phase sent" tag for quick visual scanning.
   */
  secondPhase: boolean;
}

interface Bucket {
  /** Stable anchor id for scroll-to. */
  key: string;
  kind: "overdue" | "week" | "unscheduled";
  /** Short label for the chart axis ("Overdue", "This wk", "Next wk", "Jun 15"). */
  axisLabel: string;
  /** Full heading for the list section. */
  title: string;
  subtitle: string;
  isCurrent: boolean;
  first: number;
  full: number;
  none: number;
  total: number;
  jobs: PlanJob[];
}

interface Props {
  jobs: Job[];
  dispatchStatus: Record<string, DispatchStatus>;
}

export function DispatchPlanBoard({ jobs }: Props) {
  const { buckets, chartBuckets, maxTotal, totals } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const curWeek = startOfWeekMonday(today);

    const overdue: PlanJob[] = [];
    const unscheduled: PlanJob[] = [];
    const weekMap = new Map<number, PlanJob[]>();

    let firstAll = 0;
    let fullAll = 0;

    for (const job of jobs) {
      const date = job.requirement_dispatch_date
        ? parseLocalDate(job.requirement_dispatch_date)
        : null;
      const phase = phaseOf(job.requirement_stage);
      if (phase === "first") firstAll++;
      else if (phase === "full") fullAll++;

      const pj: PlanJob = {
        id: job.id,
        job_number: job.job_number,
        customer_name: job.customer_name,
        phase,
        secondPhase: phase === "full" && job.stage === "first_phase",
      };

      if (!date) unscheduled.push(pj);
      else if (date.getTime() < today.getTime()) overdue.push(pj);
      else {
        const k = startOfWeekMonday(date).getTime();
        const arr = weekMap.get(k) ?? [];
        arr.push(pj);
        weekMap.set(k, arr);
      }
    }

    const cmpJob = (a: PlanJob, b: PlanJob) =>
      a.job_number.localeCompare(b.job_number, undefined, { numeric: true });
    overdue.sort(cmpJob);
    unscheduled.sort(cmpJob);

    const tally = (arr: PlanJob[]) => ({
      first: arr.filter((j) => j.phase === "first").length,
      full: arr.filter((j) => j.phase === "full").length,
      none: arr.filter((j) => j.phase === "none").length,
      total: arr.length,
    });

    const out: Bucket[] = [];

    if (overdue.length) {
      out.push({
        key: "overdue",
        kind: "overdue",
        axisLabel: "Overdue",
        title: "Overdue",
        subtitle: "Req. Dispatch date already passed",
        isCurrent: false,
        ...tally(overdue),
        jobs: overdue,
      });
    }

    // Continuous week columns from this week through the last populated week,
    // so the chart reads as a true left-to-right timeline (empty weeks included).
    const populated = [...weekMap.keys()];
    const lastWeek = populated.length ? Math.max(...populated) : curWeek.getTime();
    for (let t = curWeek.getTime(); t <= lastWeek; t += 7 * DAY_MS) {
      const weekStart = new Date(t);
      const weeksFromNow = Math.round((t - curWeek.getTime()) / (7 * DAY_MS));
      const arr = (weekMap.get(t) ?? []).slice().sort(cmpJob);
      out.push({
        key: `w${t}`,
        kind: "week",
        axisLabel:
          weeksFromNow === 0 ? "This wk" : weeksFromNow === 1 ? "Next wk" : fmtDayMonth(weekStart),
        title:
          weeksFromNow === 0 ? "This Week" : weeksFromNow === 1 ? "Next Week" : `In ${weeksFromNow} weeks`,
        subtitle: `${fmtDayMonth(weekStart)} – ${fmtDayMonth(addDays(weekStart, 6))}`,
        isCurrent: weeksFromNow === 0,
        ...tally(arr),
        jobs: arr,
      });
    }

    if (unscheduled.length) {
      out.push({
        key: "unscheduled",
        kind: "unscheduled",
        axisLabel: "No date",
        title: "No dispatch date",
        subtitle: "Set a Req. Dispatch date to schedule these",
        isCurrent: false,
        ...tally(unscheduled),
        jobs: unscheduled,
      });
    }

    // The chart shows time-placed buckets only (overdue + weeks), never the
    // dateless lane — there's no axis slot for "no date".
    const chart = out.filter((b) => b.kind !== "unscheduled");
    const max = Math.max(1, ...chart.map((b) => b.total));

    return {
      buckets: out,
      chartBuckets: chart,
      maxTotal: max,
      totals: {
        first: firstAll,
        full: fullAll,
        overdue: overdue.length,
        unscheduled: unscheduled.length,
        total: jobs.length,
      },
    };
  }, [jobs]);

  if (totals.total === 0) {
    return (
      <div className="card-surface p-12 text-center">
        <CalendarClock size={48} className="mx-auto mb-4 text-[var(--muted-foreground)]" />
        <p className="text-[var(--muted-foreground)]">
          No active jobs to plan. Jobs appear here once they have a Req. Dispatch date.
        </p>
      </div>
    );
  }

  const scrollTo = (key: string) => {
    document.getElementById(`plan-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-6">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <LegendDot className="bg-blue-500" label="First Phase" count={totals.first} />
        <LegendDot className="bg-emerald-500" label="Full Dispatch" count={totals.full} />
        {totals.overdue > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[var(--destructive)]">
            <AlertTriangle size={14} />
            <span className="font-medium">{totals.overdue}</span> overdue
          </span>
        )}
      </div>

      {/* ── Chart: workload by week, left → right ── */}
      <div className="card-surface p-5">
        <div className="flex items-end gap-2 overflow-x-auto pb-1">
          {chartBuckets.map((b) => {
            const barPx = b.total > 0 ? Math.max(10, Math.round((b.total / maxTotal) * CHART_H)) : 0;
            const isOverdue = b.kind === "overdue";
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => scrollTo(b.key)}
                title={`${b.title} · ${b.total} ${b.total === 1 ? "job" : "jobs"}`}
                className={cn(
                  "group flex shrink-0 flex-col items-center gap-2 rounded-lg px-1.5 pt-1 pb-2 transition-colors cursor-pointer",
                  "w-[60px]",
                  isOverdue ? "hover:bg-red-50" : "hover:bg-[var(--muted)]",
                )}
              >
                {/* count */}
                <span
                  className={cn(
                    "text-xs font-semibold tabular-nums",
                    b.total === 0 ? "text-transparent" : isOverdue ? "text-[var(--destructive)]" : "text-[var(--foreground)]",
                  )}
                >
                  {b.total || "0"}
                </span>

                {/* bar */}
                <div className="flex w-full items-end justify-center" style={{ height: CHART_H }}>
                  {b.total === 0 ? (
                    <div className="h-px w-7 rounded bg-[var(--border)]" />
                  ) : (
                    <div
                      className="flex w-8 flex-col overflow-hidden rounded-t-md shadow-sm ring-1 ring-black/5 transition-transform group-hover:-translate-y-0.5"
                      style={{ height: barPx }}
                    >
                      {isOverdue ? (
                        <div className="flex-1 bg-gradient-to-t from-red-600 to-red-400" />
                      ) : (
                        <>
                          {b.first > 0 && (
                            <div className={PHASE_META.first.bar} style={{ flexGrow: b.first }} />
                          )}
                          {b.full > 0 && (
                            <div className={PHASE_META.full.bar} style={{ flexGrow: b.full }} />
                          )}
                          {b.none > 0 && (
                            <div className={PHASE_META.none.bar} style={{ flexGrow: b.none }} />
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* axis label */}
                <span
                  className={cn(
                    "text-center text-[11px] leading-tight",
                    b.isCurrent
                      ? "font-semibold text-[var(--primary)]"
                      : isOverdue
                        ? "font-medium text-[var(--destructive)]"
                        : "text-[var(--muted-foreground)]",
                  )}
                >
                  {b.axisLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── List: jobs per week (number · name · phase) ── */}
      <div className="space-y-5">
        {buckets.filter((b) => b.total > 0).map((b) => (
          <section key={b.key} id={`plan-${b.key}`} className="scroll-mt-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--border)] pb-1.5">
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 translate-y-0.5 rounded-full",
                    b.kind === "overdue"
                      ? "bg-red-500"
                      : b.isCurrent
                        ? "bg-[var(--primary)]"
                        : "bg-[var(--border-strong)]",
                  )}
                />
                <h3
                  className={cn(
                    "text-sm font-semibold",
                    b.kind === "overdue" && "text-[var(--destructive)]",
                  )}
                >
                  {b.title}
                </h3>
                <span className="text-xs text-[var(--muted-foreground)]">{b.subtitle}</span>
              </div>
              <span className="text-xs font-medium text-[var(--muted-foreground)]">
                {b.total} {b.total === 1 ? "job" : "jobs"}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
              {b.jobs.map((job) => {
                const meta = PHASE_META[job.phase];
                return (
                  <Link
                    key={job.id}
                    href={`/jobs/${job.id}`}
                    className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--muted)] cursor-pointer"
                  >
                    <span className="shrink-0 whitespace-nowrap font-mono text-sm font-semibold">
                      {job.job_number}
                    </span>
                    {job.secondPhase && (
                      <span
                        title="First phase already dispatched — second phase pending"
                        className="shrink-0 whitespace-nowrap text-[11px] font-medium text-blue-600"
                      >
                        (✓ 1st phase)
                      </span>
                    )}
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]"
                      title={job.customer_name ?? ""}
                    >
                      {job.customer_name || "—"}
                    </span>
                    <Badge variant={meta.variant} className="shrink-0">
                      {meta.short}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function LegendDot({
  className,
  label,
  count,
}: {
  className: string;
  label: string;
  count: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} />
      {label}
      <span className="font-medium text-[var(--foreground)]">{count}</span>
    </span>
  );
}
