"use client";

import type { ReactNode } from "react";
import { CalendarX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { WeekMeta } from "@/lib/actions/mrp-weekly";

const fmtQty = (n: number) => (Number.isInteger(n) ? n.toString() : (Math.round(n * 10) / 10).toString());

/* ── Shared category table ─────────────────────────────────────────────────
 * One clean, full-width table per category (header row + column headers). Used
 * for the Make/Trade item lanes and the Programs lane so every weekly board reads
 * the same way. */

export interface WeeklyCol {
  label: string;
  align?: "right";
  width?: string;
  className?: string;
}

export function CategoryTable({
  title,
  meta,
  cols,
  rows,
}: {
  title: string;
  meta: string;
  cols: WeeklyCol[];
  rows: { id: string; cells: ReactNode[] }[];
}): ReactNode {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
      <div className="flex items-center justify-between gap-2 bg-[var(--muted)]/40 px-3.5 py-2">
        <span className="truncate text-[13px] font-medium text-[var(--foreground)]">{title}</span>
        <span className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">{meta}</span>
      </div>
      <table className="w-full table-fixed text-[13px]">
        <colgroup>
          {cols.map((c, i) => (
            <col key={i} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th
                key={i}
                className={cn(
                  "px-3.5 pb-1 pt-1.5 text-[11px] font-normal text-[var(--muted-foreground)]",
                  c.align === "right" ? "text-right" : "text-left",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]/40">
              {r.cells.map((cell, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "px-3.5 py-2 align-middle",
                    cols[ci].align === "right" ? "text-right tabular-nums" : "",
                    cols[ci].className,
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Make / Trade item lane ────────────────────────────────────────────────*/

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
 * Render one week's item list as clean per-category tables (Code · Item · Need ·
 * Cumulative). Shared by the Make and Trade weekly boards. Pass as renderBucket.
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
    <div className="space-y-3">
      {cats.map((cat) => {
        const items = byCat.get(cat)!.sort((a, b) => b.perWeek[i] - a.perWeek[i]);
        const catTotal = items.reduce((s, r) => s + r.perWeek[i], 0);
        return (
          <CategoryTable
            key={cat}
            title={cat}
            meta={`${items.length} item${items.length === 1 ? "" : "s"} · +${fmtQty(catTotal)} this week`}
            cols={[
              { label: "Code", width: "20%", className: "font-mono text-xs" },
              { label: "Item" },
              { label: "Need", align: "right", width: "15%" },
              { label: "Cumulative", align: "right", width: "17%" },
            ]}
            rows={items.map((r) => ({
              id: r.id,
              cells: [
                r.code,
                <span key="n" className="block truncate" title={r.name}>
                  {r.name}
                  {r.sub ? <span className="ml-1.5 text-[11px] text-[var(--muted-foreground)]">{r.sub}</span> : null}
                </span>,
                <span key="q" className="font-semibold text-[var(--foreground)]">+{fmtQty(r.perWeek[i])}</span>,
                <span key="c" className="text-[var(--muted-foreground)]">{fmtQty(r.cumulative[i])}</span>,
              ],
            }))}
          />
        );
      })}
    </div>
  );
}

/* ── The board (week strip + stacked per-week sections) ────────────────────*/

export interface WeeklyBoardProps {
  weeks: WeekMeta[];
  /** Per-bucket headline value (units / runs / sheets this week). */
  barValues: number[];
  /** Per-bucket row count — drives the "N" label and hides empty sections. */
  bucketCounts: number[];
  /** Unit noun for the strip cards, e.g. "runs". */
  unit: string;
  /** Noun for the per-section count, e.g. "program". */
  countNoun?: string;
  /** Render the list for bucket i. */
  renderBucket: (i: number) => ReactNode;
  emptyLabel?: string;
}

/**
 * Week-by-week board: a clean strip of week cards up top (click to jump to that
 * week), then every week's plan stacked below (cumulative). Parameterised over
 * the metric so Make / Trade / Programs / sheets all share it.
 */
export function WeeklyBoard({ weeks, barValues, bucketCounts, unit, countNoun = "item", renderBucket, emptyLabel }: WeeklyBoardProps) {
  const hasAny = bucketCounts.some((c) => c > 0);
  const fmt = (n: number) => (Number.isInteger(n) ? n.toString() : (Math.round(n * 10) / 10).toString());
  const scrollTo = (key: string) =>
    document.getElementById(`wk-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-4">
      {/* Week strip — at-a-glance workload + jump nav */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {weeks.map((w, i) => {
          const v = barValues[i];
          const empty = bucketCounts[i] === 0;
          return (
            <button
              key={w.key}
              type="button"
              onClick={() => !empty && scrollTo(w.key)}
              disabled={empty}
              title={`${w.title} · ${fmt(v)} ${unit}`}
              className={cn(
                "flex w-[104px] shrink-0 flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                empty
                  ? "border-[var(--border)] opacity-50"
                  : "cursor-pointer hover:border-[var(--border-strong)] hover:bg-[var(--muted)]",
                w.isOverdue
                  ? "border-[var(--destructive)]/40 bg-[var(--destructive-bg)]/40"
                  : w.isCurrent
                    ? "border-[var(--primary)]/40 bg-[var(--primary)]/5"
                    : "border-[var(--border)]",
              )}
            >
              <span
                className={cn(
                  "truncate text-[11px]",
                  w.isOverdue ? "font-medium text-[var(--destructive)]" : w.isCurrent ? "font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]",
                )}
              >
                {w.isOverdue ? "Overdue" : w.isCurrent ? "This week" : w.label}
              </span>
              <span
                className={cn(
                  "text-xl font-semibold leading-tight tabular-nums",
                  empty ? "text-[var(--muted-foreground)]" : w.isOverdue ? "text-[var(--destructive)]" : "text-[var(--foreground)]",
                )}
              >
                {fmt(v)}
              </span>
              <span className="truncate text-[10px] text-[var(--muted-foreground)]">
                {unit}{!w.isOverdue && !w.isCurrent ? "" : ` · ${w.label}`}
              </span>
            </button>
          );
        })}
      </div>

      {/* Per-week sections, stacked (cumulative) */}
      {!hasAny ? (
        <Card>
          <EmptyState icon={<CalendarX size={28} />} title={emptyLabel ?? "Nothing to plan in this window."} />
        </Card>
      ) : (
        <div className="space-y-5">
          {weeks.map((w, i) =>
            bucketCounts[i] > 0 ? (
              <section key={w.key} id={`wk-${w.key}`} className="scroll-mt-4">
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--border)] pb-2">
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
