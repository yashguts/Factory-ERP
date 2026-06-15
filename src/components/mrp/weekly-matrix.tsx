"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, CalendarX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { WeekMeta } from "@/lib/actions/mrp-weekly";

const fmtQty = (n: number) => (Number.isInteger(n) ? n.toString() : (Math.round(n * 10) / 10).toString());

export interface MatrixRow {
  id: string;
  code: string;
  name: string;
  /** Grouping bucket — a top-level category or a synthetic group (e.g. sheets). */
  category: string;
  perWeek: number[];
  cumulative: number[];
  /** Small inline note next to the name in the drill-down (uom / machine / thickness). */
  sub?: ReactNode;
}

type Tone = "overdue" | "soon" | "later";
function toneOf(w: WeekMeta): Tone {
  if (w.isOverdue) return "overdue";
  if (w.index <= 1) return "soon"; // this week + next week
  return "later";
}

/**
 * Category × week matrix with inline drill-down. The overview shows one cell per
 * (category, week); click a category to expand its items week by week. A
 * cumulative / per-week toggle (controlled by the parent) flips every cell.
 *
 * Cell aggregate:
 *  - "count": number of distinct rows present (items — summing quantities across
 *    different bought/made parts is meaningless, the locked weekly rule).
 *  - "sum": summed value (runs / sheets — comparable units).
 * Drill-down rows always show the row's own quantity.
 */
export function WeeklyMatrix({
  weeks,
  rows,
  aggregate,
  unit,
  cumulative,
  pinLast,
  emptyLabel,
}: {
  weeks: WeekMeta[];
  rows: MatrixRow[];
  aggregate: "count" | "sum";
  unit: string;
  cumulative: boolean;
  /** Category name to pin to the bottom (e.g. "Raw steel / sheets"). */
  pinLast?: string;
  emptyLabel?: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const groups = useMemo(() => {
    const byCat = new Map<string, MatrixRow[]>();
    for (const r of rows) {
      const arr = byCat.get(r.category);
      if (arr) arr.push(r);
      else byCat.set(r.category, [r]);
    }
    const list = Array.from(byCat.entries()).map(([name, catRows]) => {
      // Per-week aggregate for the category (count of present rows, or summed value).
      const cells = weeks.map((_, i) => {
        let count = 0;
        let sum = 0;
        for (const r of catRows) {
          const v = (cumulative ? r.cumulative : r.perWeek)[i] ?? 0;
          if (v > 1e-9) {
            count++;
            sum += v;
          }
        }
        return aggregate === "count" ? count : sum;
      });
      const peak = Math.max(0, ...cells);
      return { name, rows: catRows, cells, peak, count: catRows.length };
    });
    // Order by urgency (rows present soonest / largest peak); pin a group last.
    list.sort((a, b) => {
      if (pinLast) {
        if (a.name === pinLast) return 1;
        if (b.name === pinLast) return -1;
      }
      return b.peak - a.peak || a.name.localeCompare(b.name);
    });
    return list;
  }, [rows, weeks, aggregate, cumulative, pinLast]);

  const colTotals = useMemo(
    () => weeks.map((_, i) => groups.reduce((s, g) => s + g.cells[i], 0)),
    [groups, weeks],
  );

  const hasAny = groups.some((g) => g.cells.some((c) => c > 0));
  if (!hasAny) {
    return (
      <Card>
        <EmptyState icon={<CalendarX size={28} />} title={emptyLabel ?? "Nothing to plan in this window."} />
      </Card>
    );
  }

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              Category
            </th>
            {weeks.map((w, i) => {
              const tone = toneOf(w);
              return (
                <th
                  key={w.key}
                  title={`${w.title} — ${w.subtitle}`}
                  className={cn(
                    "min-w-[62px] px-2 py-2 text-center align-bottom",
                    tone === "overdue" && "bg-[var(--destructive-bg)]/40",
                    w.isCurrent && "bg-[var(--primary)]/5",
                  )}
                >
                  <div
                    className={cn(
                      "text-[11px] font-medium leading-tight",
                      tone === "overdue" ? "text-[var(--destructive)]" : w.isCurrent ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]",
                    )}
                  >
                    {w.isOverdue ? "Overdue" : w.label}
                  </div>
                  <div className="mt-0.5 text-[10px] tabular-nums text-[var(--muted-foreground)]">
                    {colTotals[i] > 0 ? fmtQty(colTotals[i]) : "—"}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isOpen = expanded.has(g.name);
            return (
              <MatrixGroup
                key={g.name}
                group={g}
                weeks={weeks}
                cumulative={cumulative}
                isOpen={isOpen}
                unit={unit}
                onToggle={() => toggle(g.name)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MatrixGroup({
  group,
  weeks,
  cumulative,
  isOpen,
  unit,
  onToggle,
}: {
  group: { name: string; rows: MatrixRow[]; cells: number[]; count: number };
  weeks: WeekMeta[];
  cumulative: boolean;
  isOpen: boolean;
  unit: string;
  onToggle: () => void;
}) {
  const sortedRows = useMemo(
    () => [...group.rows].sort((a, b) => (cumulative ? b.cumulative : b.perWeek).reduce((s, x) => s + x, 0) - (cumulative ? a.cumulative : a.perWeek).reduce((s, x) => s + x, 0)),
    [group.rows, cumulative],
  );

  return (
    <>
      <tr
        className="cursor-pointer border-b border-[var(--border)] bg-[var(--muted)]/30 hover:bg-[var(--muted)]/60"
        onClick={onToggle}
      >
        <td className="sticky left-0 z-10 bg-[var(--muted)]/30 px-3 py-2 font-medium">
          <span className="inline-flex items-center gap-1.5">
            {isOpen ? (
              <ChevronDown size={14} className="shrink-0 text-[var(--muted-foreground)]" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-[var(--muted-foreground)]" />
            )}
            <span className="truncate">{group.name}</span>
            <span className="text-[11px] font-normal text-[var(--muted-foreground)]">· {group.count}</span>
          </span>
        </td>
        {weeks.map((w, i) => {
          const v = group.cells[i];
          const tone = toneOf(w);
          return (
            <td
              key={w.key}
              className={cn(
                "px-2 py-2 text-center tabular-nums",
                tone === "overdue" && "bg-[var(--destructive-bg)]/30",
                w.isCurrent && "bg-[var(--primary)]/5",
              )}
            >
              {v > 0 ? (
                <span
                  className={cn(
                    "font-medium",
                    tone === "overdue" ? "text-[var(--destructive)]" : tone === "soon" ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
                  )}
                >
                  {fmtQty(v)}
                </span>
              ) : (
                <span className="text-[var(--border-strong)]">·</span>
              )}
            </td>
          );
        })}
      </tr>

      {isOpen &&
        sortedRows.map((r) => (
          <tr key={r.id} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--muted)]/40">
            <td className="sticky left-0 z-10 bg-[var(--card)] py-1.5 pl-8 pr-3">
              <span className="block truncate" title={`${r.code} — ${r.name}`}>
                <span className="mr-1.5 font-mono text-[11px] text-[var(--muted-foreground)]">{r.code}</span>
                {r.name}
                {r.sub ? <span className="ml-1.5 text-[11px] text-[var(--muted-foreground)]">{r.sub}</span> : null}
              </span>
            </td>
            {weeks.map((w, i) => {
              const v = (cumulative ? r.cumulative : r.perWeek)[i] ?? 0;
              const tone = toneOf(w);
              return (
                <td
                  key={w.key}
                  title={v > 0 ? `${fmtQty(v)} ${unit} — ${w.title}` : undefined}
                  className={cn(
                    "px-2 py-1.5 text-center tabular-nums",
                    tone === "overdue" && "bg-[var(--destructive-bg)]/20",
                    w.isCurrent && "bg-[var(--primary)]/[0.03]",
                  )}
                >
                  {v > 1e-9 ? (
                    <span className={cn(tone === "overdue" ? "text-[var(--destructive)]" : "text-[var(--foreground)]")}>
                      {fmtQty(v)}
                    </span>
                  ) : (
                    <span className="text-[var(--border-strong)]">·</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
    </>
  );
}

/** Shared cumulative / per-week segmented toggle for the weekly views. */
export function CumulativeToggle({
  cumulative,
  onChange,
}: {
  cumulative: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-[var(--border)] text-xs">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn(
          "cursor-pointer px-3 py-1.5 transition-colors",
          cumulative ? "bg-[var(--primary)]/10 font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
        )}
        title="Totals you must have ready by each week's deadline"
      >
        Cumulative
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn(
          "cursor-pointer border-l border-[var(--border)] px-3 py-1.5 transition-colors",
          !cumulative ? "bg-[var(--primary)]/10 font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
        )}
        title="What is newly needed in each week"
      >
        Per week
      </button>
    </div>
  );
}
