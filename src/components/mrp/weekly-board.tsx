"use client";

import type { ReactNode } from "react";
import { CalendarX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { WeekMeta } from "@/lib/actions/mrp-weekly";

const CHART_H = 110; // px, tallest bar

const fmtQty = (n: number) => (Number.isInteger(n) ? n.toString() : (Math.round(n * 10) / 10).toString());

export interface WeeklyGroupRow {
  id: string;
  code: string;
  name: string;
  topCategory: string | null;
  perWeek: number[];
  cumulative: number[];
  sub?: string;
}

/**
 * Render one week's item list GROUPED BY TOP-LEVEL CATEGORY (a sub-header per
 * category with its item count + weekly total, items sorted by qty). Shared by the
 * Make and Trade weekly boards so both split the same way. Pass as renderBucket.
 */
export function groupedItemBucket(rows: WeeklyGroupRow[], i: number): ReactNode {
  const present = rows.filter((r) => r.perWeek[i] > 1e-9);
  const byCat = new Map<string, WeeklyGroupRow[]>();
  for (const r of present) {
    const cat = r.topCategory || "Uncategorised";
    const arr = byCat.get(cat);
    if (arr) arr.push(r);
    else byCat.set(cat, [r]);
  }
  const cats = [...byCat.keys()].sort((a, b) => a.localeCompare(b));
  return (
    <div className="space-y-2.5">
      {cats.map((cat) => {
        const items = byCat.get(cat)!.sort((a, b) => b.perWeek[i] - a.perWeek[i]);
        const catTotal = items.reduce((s, r) => s + r.perWeek[i], 0);
        return (
          <div key={cat}>
            <div className="mb-1 flex items-baseline justify-between gap-2 px-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{cat}</span>
              <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{items.length} · +{fmtQty(catTotal)}</span>
            </div>
            <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
              {items.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--muted)]">
                  <span className="shrink-0 font-mono text-xs font-semibold">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted-foreground)]" title={r.name}>{r.name}</span>
                  {r.sub && <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">{r.sub}</span>}
                  <span className="shrink-0 text-sm font-semibold tabular-nums">+{fmtQty(r.perWeek[i])}</span>
                  <span className="w-[68px] shrink-0 text-right text-[11px] tabular-nums text-[var(--muted-foreground)]">cum {fmtQty(r.cumulative[i])}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface WeeklyBoardProps {
  weeks: WeekMeta[];
  /** Per-bucket bar value (units / runs / sheets this week). */
  barValues: number[];
  /** Per-bucket row count — drives the "N" label and hides empty sections. */
  bucketCounts: number[];
  /** Tooltip unit, e.g. "runs". */
  unit: string;
  /** Noun for the per-section count, e.g. "program". */
  countNoun?: string;
  /** Render the list for bucket i. */
  renderBucket: (i: number) => ReactNode;
  emptyLabel?: string;
}

/**
 * Reusable week-by-week board (Overdue lane + 8 weeks), adapted from the Job
 * Orders Dispatch Plan board: a left→right bar chart of the weekly workload over
 * compact per-week sections. Parameterised over the metric so Make / Trade /
 * Programs / Buy all share it.
 */
export function WeeklyBoard({ weeks, barValues, bucketCounts, unit, countNoun = "item", renderBucket, emptyLabel }: WeeklyBoardProps) {
  const max = Math.max(1, ...barValues);
  const hasAny = bucketCounts.some((c) => c > 0);
  const fmt = (n: number) => (Number.isInteger(n) ? n.toString() : (Math.round(n * 10) / 10).toString());
  const scrollTo = (key: string) =>
    document.getElementById(`wk-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-3">
      {/* Chart: workload by week, left → right */}
      <div className="card-surface p-3">
        <div className="flex items-end gap-2 overflow-x-auto pb-1">
          {weeks.map((w, i) => {
            const v = barValues[i];
            // Reserve ~18px at the top of the column for the value label that now
            // sits directly on top of the bar (so short bars don't leave a big gap
            // between a top-floating number and a tiny stub at the bottom).
            const barPx = v > 0 ? Math.max(8, Math.round((v / max) * (CHART_H - 18))) : 0;
            return (
              <button
                key={w.key}
                type="button"
                onClick={() => scrollTo(w.key)}
                title={`${w.title} · ${fmt(v)} ${unit}`}
                className={cn(
                  "group flex w-[72px] shrink-0 flex-col items-center gap-2 rounded-lg px-1.5 pt-1 pb-2 transition-colors cursor-pointer",
                  w.isOverdue ? "hover:bg-[var(--destructive-bg)]" : "hover:bg-[var(--muted)]",
                )}
              >
                <div className="flex w-full flex-col items-center justify-end gap-1" style={{ height: CHART_H }}>
                  <span
                    className={cn(
                      "text-xs font-semibold tabular-nums leading-none",
                      v === 0 ? "text-transparent" : w.isOverdue ? "text-[var(--destructive)]" : "text-[var(--foreground)]",
                    )}
                  >
                    {v === 0 ? "0" : fmt(v)}
                  </span>
                  {v === 0 ? (
                    <div className="h-px w-7 rounded bg-[var(--border)]" />
                  ) : (
                    <div
                      className={cn(
                        "w-8 rounded-t-md shadow-sm ring-1 transition-transform group-hover:-translate-y-0.5",
                        w.isOverdue
                          ? "bg-gradient-to-t from-red-600 to-red-400 ring-red-200"
                          : w.isCurrent
                            ? "bg-gradient-to-t from-blue-600 to-blue-400 ring-black/5"
                            : "bg-gradient-to-t from-slate-500 to-slate-400 ring-black/5",
                      )}
                      style={{ height: barPx }}
                    />
                  )}
                </div>
                <span
                  className={cn(
                    "text-center text-[11px] leading-tight",
                    w.isCurrent
                      ? "font-semibold text-[var(--primary)]"
                      : w.isOverdue
                        ? "font-medium text-[var(--destructive)]"
                        : "text-[var(--muted-foreground)]",
                  )}
                >
                  {w.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-week lists */}
      {!hasAny ? (
        <Card>
          <EmptyState
            icon={<CalendarX size={28} />}
            title={emptyLabel ?? "Nothing to plan in this window."}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {weeks.map((w, i) =>
            bucketCounts[i] > 0 ? (
              <section key={w.key} id={`wk-${w.key}`} className="scroll-mt-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--border)] pb-1.5">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 translate-y-0.5 rounded-full",
                        w.isOverdue ? "bg-[var(--destructive)]" : w.isCurrent ? "bg-[var(--primary)]" : "bg-[var(--border-strong)]",
                      )}
                    />
                    <h3 className={cn("text-sm font-semibold", w.isOverdue && "text-[var(--destructive)]")}>{w.title}</h3>
                    <span className="text-xs text-[var(--muted-foreground)]">{w.subtitle}</span>
                  </div>
                  <span className="text-xs font-medium text-[var(--muted-foreground)]">
                    {bucketCounts[i]} {bucketCounts[i] === 1 ? countNoun : `${countNoun}s`}
                  </span>
                </div>
                {renderBucket(i)}
              </section>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
