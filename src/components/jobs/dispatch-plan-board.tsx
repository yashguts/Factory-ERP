"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarClock, AlertTriangle } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/supabase/types";
import type { DispatchStatus } from "@/lib/actions/dispatch";
import { gadAlert } from "@/lib/jobs/gad-alert";

/* ------------------------------------------------------------------ *
 * Dispatch Plan — a read-only, week-by-week picture of the Active Job
 * Orders. The top is a left-to-right stacked-bar chart of how many jobs
 * dispatch each week; below it, the jobs in each week as compact rows.
 *
 * Dispatch is two phases plus a terminal state. We read a job's phase from
 * the office's own Sent (`stage`) and Required (`requirement_stage`) values
 * — the source of truth they maintain on the Jobs list — and use recorded
 * dispatches only to know whether items are still due:
 *
 *   Sent = 2nd phase (full)            → 2nd phase already dispatched.
 *                                        If items remain → "Dues pending".
 *   Sent = 1st phase                   → 1st phase dispatched; 2nd phase due.
 *   Sent = New, Required = 2nd (full)  → whole job still to dispatch.
 *   Sent = New, Required = 1st phase   → 1st phase still to dispatch.
 *
 * "Fully dispatched" (everything out, no dues) is the terminal state and is
 * filtered out before this board — those jobs live on the Fully Dispatched
 * tab. Nothing is mutated here. Weeks are Monday-start (the working week);
 * past-due jobs collect in a red "Overdue" lane, dateless ones in "No date".
 * ------------------------------------------------------------------ */

/** Where a job sits in the two-phase dispatch lifecycle (for an active job). */
type PlanState =
  | "first_due" // nothing sent, 1st phase required
  | "full_due" // nothing sent, full job required (no separate 1st phase)
  | "first_sent" // 1st phase dispatched, 2nd phase now due
  | "second_sent" // 2nd phase / full dispatched (dues may remain)
  | "unset"; // nothing sent, nothing required set yet

/**
 * Chart/legend colour bucket a state rolls up into.
 *   first  — 1st phase still to dispatch          (blue)
 *   second — 1st phase sent, 2nd phase to go      (purple)
 *   fully  — whole job dispatched/to dispatch     (green)
 *   dues   — 2nd phase out, items still due        (amber)
 */
type Cat = "first" | "second" | "fully" | "dues" | "other";

const CAT_BAR: Record<Cat, string> = {
  first: "bg-gradient-to-t from-blue-600 to-blue-400",
  second: "bg-gradient-to-t from-purple-600 to-purple-400",
  fully: "bg-gradient-to-t from-emerald-600 to-emerald-400",
  dues: "bg-gradient-to-t from-amber-500 to-amber-400",
  other: "bg-[var(--border-strong)]",
};

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
  state: PlanState;
  /** Recorded dispatches still leave items short (only meaningful when sent). */
  hasDues: boolean;
  /** Readiness at a glance: GAD drawing uploaded, Job BOM filled, Cabin BOM filled. */
  hasDrawing: boolean;
  hasBom: boolean;
  hasCabin: boolean;
  /** GAD changed after the BOM was defined and not yet re-audited. */
  gadDrift: boolean;
}

interface Display {
  badge: string;
  variant: BadgeVariant;
  /** Phase already dispatched, shown as a "(✓ …)" tag by the job number. */
  sent: "1st" | "2nd" | null;
  cat: Cat;
}

/** Map a job's state (+ dues) to its row badge, sent-tag, and chart bucket. */
function displayOf(j: PlanJob): Display {
  switch (j.state) {
    case "first_due":
      return { badge: "1st phase", variant: "blue", sent: null, cat: "first" };
    case "full_due":
      return { badge: "Full dispatch", variant: "green", sent: null, cat: "fully" };
    case "first_sent":
      return { badge: "2nd phase", variant: "purple", sent: "1st", cat: "second" };
    case "second_sent":
      return j.hasDues
        ? { badge: "Dues pending", variant: "amber", sent: "2nd", cat: "dues" }
        : { badge: "2nd phase sent", variant: "green", sent: "2nd", cat: "fully" };
    default:
      return { badge: "—", variant: "neutral", sent: null, cat: "other" };
  }
}

interface Bucket {
  key: string;
  kind: "overdue" | "week" | "unscheduled";
  axisLabel: string;
  title: string;
  subtitle: string;
  isCurrent: boolean;
  first: number;
  second: number;
  fully: number;
  dues: number;
  other: number;
  total: number;
  jobs: PlanJob[];
}

interface Props {
  jobs: Job[];
  dispatchStatus: Record<string, DispatchStatus>;
  readiness?: { bomJobIds: string[]; cabinJobNumbers: string[] };
}

export function DispatchPlanBoard({
  jobs,
  dispatchStatus,
  readiness = { bomJobIds: [], cabinJobNumbers: [] },
}: Props) {
  const { buckets, chartBuckets, maxTotal, totals } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const curWeek = startOfWeekMonday(today);

    // Readiness lookups — Job BOM keyed by job id, Cabin BOM by normalised number.
    const bomSet = new Set(readiness.bomJobIds);
    const cabinSet = new Set(readiness.cabinJobNumbers);

    const overdue: PlanJob[] = [];
    const unscheduled: PlanJob[] = [];
    const weekMap = new Map<number, PlanJob[]>();

    for (const job of jobs) {
      const ds = dispatchStatus[job.id] ?? "none";
      // Phase comes from the office's Sent/Required values; dues come from
      // recorded dispatches (partial = items still short).
      let state: PlanState;
      if (job.stage === "full_material") state = "second_sent";
      else if (job.stage === "first_phase") state = "first_sent";
      else if (job.requirement_stage === "full_material") state = "full_due";
      else if (job.requirement_stage === "first_phase") state = "first_due";
      else state = "unset";

      const pj: PlanJob = {
        id: job.id,
        job_number: job.job_number,
        customer_name: job.customer_name,
        state,
        hasDues: ds === "partial",
        hasDrawing: !!job.gad_drawing_url,
        hasBom: bomSet.has(job.id),
        hasCabin: cabinSet.has(job.job_number.trim().toLowerCase()),
        gadDrift: gadAlert(job),
      };

      const date = job.requirement_dispatch_date
        ? parseLocalDate(job.requirement_dispatch_date)
        : null;
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

    const tally = (arr: PlanJob[]) => {
      let first = 0, second = 0, fully = 0, dues = 0, other = 0;
      for (const j of arr) {
        const c = displayOf(j).cat;
        if (c === "first") first++;
        else if (c === "second") second++;
        else if (c === "fully") fully++;
        else if (c === "dues") dues++;
        else other++;
      }
      return { first, second, fully, dues, other, total: arr.length };
    };

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

    // The chart shows time-placed buckets only (overdue + weeks).
    const chart = out.filter((b) => b.kind !== "unscheduled");
    const max = Math.max(1, ...chart.map((b) => b.total));

    // Headline counts = sum across every bucket (all jobs are in exactly one).
    const sum = (k: "first" | "second" | "fully" | "dues") =>
      out.reduce((a, b) => a + b[k], 0);

    return {
      buckets: out,
      chartBuckets: chart,
      maxTotal: max,
      totals: {
        first: sum("first"),
        second: sum("second"),
        fully: sum("fully"),
        dues: sum("dues"),
        overdue: overdue.length,
        total: jobs.length,
      },
    };
  }, [jobs, dispatchStatus, readiness]);

  if (totals.total === 0) {
    return (
      <Card>
        <EmptyState
          icon={<CalendarClock size={28} />}
          title="No active jobs to plan"
          description="Jobs appear here once they have a Req. Dispatch date."
        />
      </Card>
    );
  }

  const scrollTo = (key: string) => {
    document.getElementById(`plan-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-4">
      {/* Legend — a count for each dispatch type */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <LegendDot className="bg-blue-500" label="1st phase" count={totals.first} />
        <LegendDot className="bg-purple-500" label="2nd phase" count={totals.second} />
        <LegendDot className="bg-emerald-500" label="Full dispatch" count={totals.fully} />
        <LegendDot className="bg-amber-500" label="Dues pending" count={totals.dues} />
        {totals.overdue > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[var(--destructive)]">
            <AlertTriangle size={14} />
            <span className="font-medium">{totals.overdue}</span> overdue
          </span>
        )}

        {/* Readiness chip key (solid green = present on a row, grey outline = missing) */}
        <span className="ml-auto inline-flex items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1.5">
            <ReadyChip letter="D" on /> Drawing
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ReadyChip letter="B" on /> Job BOM
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ReadyChip letter="C" on /> Cabin BOM
          </span>
          <span className="inline-flex items-center gap-1.5">
            <GadChip /> GAD changed
          </span>
        </span>
      </div>

      {/* ── Chart: workload by week, left → right ── */}
      <div className="card-surface p-3">
        <div className="flex items-end gap-2 overflow-x-auto pb-1">
          {chartBuckets.map((b) => {
            const barPx = b.total > 0 ? Math.max(10, Math.round((b.total / maxTotal) * CHART_H)) : 0;
            const isOverdue = b.kind === "overdue";
            const segs: { cat: Cat; n: number }[] = [
              { cat: "first", n: b.first },
              { cat: "second", n: b.second },
              { cat: "fully", n: b.fully },
              { cat: "dues", n: b.dues },
              { cat: "other", n: b.other },
            ];
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => scrollTo(b.key)}
                title={`${b.title} · ${b.total} ${b.total === 1 ? "job" : "jobs"}`}
                className={cn(
                  "group flex w-[74px] shrink-0 flex-col items-center gap-2 rounded-lg px-1.5 pt-1 pb-2 transition-colors cursor-pointer",
                  isOverdue ? "hover:bg-[var(--destructive-bg)]" : "hover:bg-[var(--muted)]",
                )}
              >
                <span
                  className={cn(
                    "text-xs font-semibold tabular-nums",
                    b.total === 0
                      ? "text-transparent"
                      : isOverdue
                        ? "text-[var(--destructive)]"
                        : "text-[var(--foreground)]",
                  )}
                >
                  {b.total || "0"}
                </span>

                <div className="flex w-full items-end justify-center" style={{ height: CHART_H }}>
                  {b.total === 0 ? (
                    <div className="h-px w-7 rounded bg-[var(--border)]" />
                  ) : (
                    <div
                      className={cn(
                        "flex w-8 flex-col overflow-hidden rounded-t-md shadow-sm ring-1 transition-transform group-hover:-translate-y-0.5",
                        isOverdue ? "ring-[var(--destructive-border)]" : "ring-black/5",
                      )}
                      style={{ height: barPx }}
                    >
                      {segs
                        .filter((s) => s.n > 0)
                        .map((s) => (
                          <div key={s.cat} className={CAT_BAR[s.cat]} style={{ flexGrow: s.n }} />
                        ))}
                    </div>
                  )}
                </div>

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

                {/* Per-type counts for this week (order/colours match the legend) */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-medium leading-none tabular-nums">
                  {([
                    ["bg-blue-500", b.first],
                    ["bg-purple-500", b.second],
                    ["bg-emerald-500", b.fully],
                    ["bg-amber-500", b.dues],
                  ] as const).map(([dot, n], i) => (
                    <span
                      key={i}
                      className={cn("inline-flex items-center gap-1", n === 0 && "opacity-25")}
                    >
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
                      {n}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── List: jobs per week (number · sent-tag · name · status) ── */}
      <div className="space-y-4">
        {buckets.filter((b) => b.total > 0).map((b) => (
          <section key={b.key} id={`plan-${b.key}`} className="scroll-mt-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--border)] pb-1.5">
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 translate-y-0.5 rounded-full",
                    b.kind === "overdue"
                      ? "bg-[var(--destructive)]"
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
                const d = displayOf(job);
                return (
                  <Link
                    key={job.id}
                    href={`/jobs/${job.id}`}
                    className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--muted)] cursor-pointer"
                  >
                    <span className="shrink-0 whitespace-nowrap font-mono text-sm font-semibold">
                      {job.job_number}
                    </span>
                    {d.sent && (
                      <span
                        title={`${d.sent === "1st" ? "First" : "Second"} phase already dispatched`}
                        className={cn(
                          "shrink-0 whitespace-nowrap text-[11px] font-medium",
                          d.sent === "1st" ? "text-blue-600" : "text-purple-600",
                        )}
                      >
                        (✓ {d.sent} phase)
                      </span>
                    )}
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]"
                      title={job.customer_name ?? ""}
                    >
                      {job.customer_name || "—"}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {job.gadDrift && <GadChip />}
                      <ReadyChip
                        letter="D"
                        on={job.hasDrawing}
                        onLabel="Drawing attached"
                        offLabel="No drawing"
                      />
                      <ReadyChip
                        letter="B"
                        on={job.hasBom}
                        onLabel="Job BOM filled"
                        offLabel="Job BOM empty"
                      />
                      <ReadyChip
                        letter="C"
                        on={job.hasCabin}
                        onLabel="Cabin BOM filled"
                        offLabel="No cabin BOM"
                      />
                    </span>
                    {/* Fixed-width slot so the D/B/C chips line up across rows
                        regardless of the (variable-width) phase badge. */}
                    <span className="flex w-[116px] shrink-0 justify-end">
                      <Badge variant={d.variant} className="shrink-0">
                        {d.badge}
                      </Badge>
                    </span>
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

/**
 * One readiness slot as a lettered chip (D = Drawing, B = Job BOM, C = Cabin BOM).
 * Solid green when present, hollow grey outline when missing — so each slot is
 * instantly identifiable and gaps read at a glance.
 */
function ReadyChip({
  letter,
  on,
  onLabel,
  offLabel,
}: {
  letter: string;
  on: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <span
      title={on ? onLabel : offLabel}
      aria-label={on ? onLabel : offLabel}
      className={cn(
        "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded px-0.5 text-[10px] font-bold leading-none",
        on
          ? "bg-emerald-600 text-white"
          : "border border-[var(--border-strong)] text-[var(--muted-foreground)] opacity-60",
      )}
    >
      {letter}
    </span>
  );
}

/**
 * Exception flag: the GAD was changed AFTER the BOM was defined and hasn't been
 * re-audited. Red so it jumps out of the green/grey readiness row — whoever is
 * about to dispatch this job needs to stop and re-check the drawing first.
 */
function GadChip() {
  return (
    <span
      title="GAD changed after the BOM was defined — review the drawing against the BOM, then Mark Audited"
      aria-label="GAD changed after BOM was defined"
      className="inline-flex h-[18px] shrink-0 items-center gap-0.5 rounded bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
    >
      <AlertTriangle size={10} />
      GAD
    </span>
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
