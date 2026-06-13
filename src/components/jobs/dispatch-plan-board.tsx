"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarClock, CalendarOff, AlertTriangle } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Job, JobStage } from "@/lib/supabase/types";
import type { DispatchStatus } from "@/lib/actions/dispatch";

/* ------------------------------------------------------------------ *
 * Dispatch Plan board — a read-only, week-by-week visual of the Active
 * Job Orders. Each job lands in the week of its Req. Dispatch date and
 * carries a planned-phase badge derived purely from its "Required"
 * (requirement_stage) value, the office's source of truth for what the
 * job needs prepared next:
 *
 *   first_phase   → "First Phase"   (blue)
 *   full_material → "Full Dispatch" (green)
 *   new / null    → "Not planned"   (grey)
 *
 * No data is mutated here — it's the same active set the table shows,
 * just grouped onto a calendar. Weeks are Monday-start (the factory's
 * working week). A job whose date is already past, and isn't fully
 * dispatched, sits in a red "Overdue" lane; dateless jobs collect in a
 * muted "No dispatch date" lane so they can be scheduled.
 * ------------------------------------------------------------------ */

type Phase = "first" | "full" | "none";

const PHASE_META: Record<
  Phase,
  { label: string; variant: BadgeVariant; bar: string }
> = {
  first: { label: "First Phase", variant: "blue", bar: "bg-blue-400" },
  full: { label: "Full Dispatch", variant: "green", bar: "bg-emerald-400" },
  none: { label: "Not planned", variant: "neutral", bar: "bg-[var(--border-strong)]" },
};

function phaseOf(stage: JobStage | null | undefined): Phase {
  if (stage === "first_phase") return "first";
  if (stage === "full_material") return "full";
  return "none";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a "YYYY-MM-DD" string as a local calendar date (no timezone shift). */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Midnight on the Monday of the week containing d. */
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

function fmtFull(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

interface PlanJob {
  id: string;
  job_number: string;
  customer_name: string | null;
  spec_string: string | null;
  brand: string | null;
  phase: Phase;
  date: Date | null;
  partial: boolean;
  overdue: boolean;
}

type Section =
  | { kind: "overdue"; jobs: PlanJob[] }
  | { kind: "week"; weekStart: Date; weeksFromNow: number; jobs: PlanJob[] }
  | { kind: "unscheduled"; jobs: PlanJob[] };

interface Props {
  jobs: Job[];
  dispatchStatus: Record<string, DispatchStatus>;
}

export function DispatchPlanBoard({ jobs, dispatchStatus }: Props) {
  const { sections, totals } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const curWeek = startOfWeekMonday(today);

    const overdue: PlanJob[] = [];
    const unscheduled: PlanJob[] = [];
    const byWeek = new Map<string, PlanJob[]>();

    let first = 0;
    let full = 0;

    for (const job of jobs) {
      const date = job.requirement_dispatch_date
        ? parseLocalDate(job.requirement_dispatch_date)
        : null;
      const isOverdue = date != null && date.getTime() < today.getTime();
      const phase = phaseOf(job.requirement_stage);
      if (phase === "first") first++;
      else if (phase === "full") full++;

      const pj: PlanJob = {
        id: job.id,
        job_number: job.job_number,
        customer_name: job.customer_name,
        spec_string: job.spec_string,
        brand: job.brand,
        phase,
        date,
        partial: (dispatchStatus[job.id] ?? "none") === "partial",
        overdue: isOverdue,
      };

      if (!date) {
        unscheduled.push(pj);
      } else if (isOverdue) {
        overdue.push(pj);
      } else {
        const key = startOfWeekMonday(date).getTime().toString();
        const arr = byWeek.get(key) ?? [];
        arr.push(pj);
        byWeek.set(key, arr);
      }
    }

    // Sort helper: by date asc, then phase (first → full → none), then job #.
    const phaseRank: Record<Phase, number> = { first: 0, full: 1, none: 2 };
    const byDateThenPhase = (a: PlanJob, b: PlanJob) => {
      const da = a.date?.getTime() ?? 0;
      const db = b.date?.getTime() ?? 0;
      if (da !== db) return da - db;
      if (phaseRank[a.phase] !== phaseRank[b.phase])
        return phaseRank[a.phase] - phaseRank[b.phase];
      return a.job_number.localeCompare(b.job_number, undefined, { numeric: true });
    };

    overdue.sort(byDateThenPhase);
    unscheduled.sort((a, b) =>
      a.job_number.localeCompare(b.job_number, undefined, { numeric: true }),
    );

    const out: Section[] = [];
    if (overdue.length) out.push({ kind: "overdue", jobs: overdue });

    const weekKeys = [...byWeek.keys()].map(Number).sort((a, b) => a - b);
    for (const k of weekKeys) {
      const weekStart = new Date(k);
      const weeksFromNow = Math.round(
        (weekStart.getTime() - curWeek.getTime()) / (7 * DAY_MS),
      );
      const arr = byWeek.get(k.toString())!;
      arr.sort(byDateThenPhase);
      out.push({ kind: "week", weekStart, weeksFromNow, jobs: arr });
    }

    if (unscheduled.length) out.push({ kind: "unscheduled", jobs: unscheduled });

    return {
      sections: out,
      totals: {
        first,
        full,
        overdue: overdue.length,
        unscheduled: unscheduled.length,
        total: jobs.length,
      },
    };
  }, [jobs, dispatchStatus]);

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

  return (
    <div className="space-y-6">
      {/* Legend + summary */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <LegendDot className="bg-blue-400" label="First Phase" count={totals.first} />
        <LegendDot className="bg-emerald-400" label="Full Dispatch" count={totals.full} />
        {totals.overdue > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[var(--destructive)]">
            <AlertTriangle size={14} />
            <span className="font-medium">{totals.overdue}</span> overdue
          </span>
        )}
        {totals.unscheduled > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
            <CalendarOff size={14} />
            <span className="font-medium">{totals.unscheduled}</span> with no date
          </span>
        )}
      </div>

      {sections.map((section) => (
        <SectionBlock key={sectionKey(section)} section={section} />
      ))}
    </div>
  );
}

function sectionKey(s: Section): string {
  if (s.kind === "week") return `week-${s.weekStart.getTime()}`;
  return s.kind;
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

function SectionBlock({ section }: { section: Section }) {
  let title: string;
  let subtitle: string;
  let accent: string; // left rail + header tint
  let titleClass = "";

  if (section.kind === "overdue") {
    title = "Overdue";
    subtitle = "Req. Dispatch date already passed";
    accent = "border-l-red-400";
    titleClass = "text-[var(--destructive)]";
  } else if (section.kind === "unscheduled") {
    title = "No dispatch date";
    subtitle = "Set a Req. Dispatch date to schedule these";
    accent = "border-l-[var(--border-strong)]";
    titleClass = "text-[var(--muted-foreground)]";
  } else {
    const { weeksFromNow, weekStart } = section;
    title =
      weeksFromNow === 0
        ? "This Week"
        : weeksFromNow === 1
          ? "Next Week"
          : `In ${weeksFromNow} weeks`;
    subtitle = `${fmtDayMonth(weekStart)} – ${fmtDayMonth(addDays(weekStart, 6))}`;
    accent = weeksFromNow === 0 ? "border-l-[var(--primary)]" : "border-l-[var(--border-strong)]";
  }

  // Per-section phase tally.
  const first = section.jobs.filter((j) => j.phase === "first").length;
  const full = section.jobs.filter((j) => j.phase === "full").length;

  return (
    <section className={cn("card-surface border-l-4 overflow-hidden", accent)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 border-b border-[var(--border)] bg-[var(--muted)]">
        <div className="flex items-baseline gap-2">
          <h2 className={cn("text-sm font-semibold", titleClass)}>{title}</h2>
          <span className="text-xs text-[var(--muted-foreground)]">{subtitle}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
          {first > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-400" />
              {first} First
            </span>
          )}
          {full > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {full} Full
            </span>
          )}
          <span className="font-medium text-[var(--foreground)]">
            {section.jobs.length} {section.jobs.length === 1 ? "job" : "jobs"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {section.jobs.map((job) => (
          <JobCard key={job.id} job={job} showWeekday={section.kind !== "unscheduled"} />
        ))}
      </div>
    </section>
  );
}

function JobCard({ job, showWeekday }: { job: PlanJob; showWeekday: boolean }) {
  const meta = PHASE_META[job.phase];
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="group flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--muted)] cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-sm font-semibold">{job.job_number}</span>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      <div className="text-sm font-medium leading-tight truncate" title={job.customer_name ?? ""}>
        {job.customer_name || "—"}
      </div>

      {(job.spec_string || job.brand) && (
        <div className="text-xs text-[var(--muted-foreground)] truncate">
          {job.spec_string && <span className="font-mono">{job.spec_string}</span>}
          {job.spec_string && job.brand && <span className="mx-1">·</span>}
          {job.brand}
        </div>
      )}

      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-xs",
            job.overdue ? "font-medium text-[var(--destructive)]" : "text-[var(--muted-foreground)]",
          )}
        >
          {job.date ? (showWeekday ? fmtFull(job.date) : fmtDayMonth(job.date)) : "No date"}
          {job.overdue && " · overdue"}
        </span>
        {job.partial && (
          <span className="text-[10px] font-medium uppercase tracking-wide rounded-full px-1.5 py-0.5 border text-amber-700 bg-amber-50 border-amber-200">
            Partial
          </span>
        )}
      </div>
    </Link>
  );
}
