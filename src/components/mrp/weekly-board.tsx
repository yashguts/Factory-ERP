"use client";

import type { ReactNode } from "react";
import { CalendarX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { WeekMeta } from "@/lib/actions/mrp-weekly";

const fmtQty = (n: number) => (Number.isInteger(n) ? n.toString() : (Math.round(n * 10) / 10).toString());

/* ── Row building blocks (shared by every lane) ────────────────────────────*/

/** The action quantity per row: the qty is the one bold token, the running
 * cumulative folded in quietly beside it (e.g. "×3 / 8" or "+12 / 40"). */
export function QtyCell({ prefix, qty, cum }: { prefix: string; qty: number; cum: number }): ReactNode {
  return (
    <>
      <span className="font-medium text-[var(--foreground)] tabular-nums">
        <span className="font-normal text-[var(--muted-foreground)]">{prefix}</span>
        {fmtQty(qty)}
      </span>
      <span className="ml-1 text-[11px] text-[var(--muted-foreground)] tabular-nums">/ {fmtQty(cum)}</span>
    </>
  );
}

/** A small in-row chip for machine / sheet thickness (thickness rhymes with the
 * filter chips above the board). */
export function MiniChip({ children, tone }: { children: ReactNode; tone?: "thickness" }): ReactNode {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px]",
        tone === "thickness"
          ? "bg-[var(--primary)]/10 font-mono tabular-nums text-[var(--primary)]"
          : "border border-[var(--border)] text-[var(--muted-foreground)]",
      )}
    >
      {children}
    </span>
  );
}

/* ── Shared category table ─────────────────────────────────────────────────*/

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
  showHead = false,
}: {
  title: string;
  meta: ReactNode;
  cols: WeeklyCol[];
  rows: { id: string; cells: ReactNode[] }[];
  showHead?: boolean;
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
        {showHead && (
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th
                  key={i}
                  className={cn(
                    "px-3.5 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]",
                    c.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/60">
              {r.cells.map((cell, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "px-3.5 py-1.5 align-middle",
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
 * One week's items as clean per-category tables. The per-row Need (this item's
 * own qty + cumulative) is shown, but category/section AGGREGATES are item COUNTS
 * — summing quantities across different kinds of bought/made parts is meaningless,
 * so "how many distinct items" is the useful number. Column headers print once.
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
      {cats.map((cat, ci) => {
        const items = byCat.get(cat)!.sort((a, b) => b.perWeek[i] - a.perWeek[i]);
        return (
          <CategoryTable
            key={cat}
            title={cat}
            showHead={ci === 0}
            meta={
              <>
                <span className="font-medium text-[var(--foreground)]">{items.length}</span> item{items.length === 1 ? "" : "s"}
              </>
            }
            cols={[
              { label: "Code", width: "92px", className: "font-mono text-[11px] text-[var(--muted-foreground)]" },
              { label: "Item" },
              { label: "Need", align: "right", width: "26%" },
            ]}
            rows={items.map((r) => ({
              id: r.id,
              cells: [
                r.code,
                <span key="n" className="block truncate" title={r.name}>
                  {r.name}
                  {r.sub ? <span className="ml-1.5 text-[11px] text-[var(--muted-foreground)]">{r.sub}</span> : null}
                </span>,
                <QtyCell key="q" prefix="+" qty={r.perWeek[i]} cum={r.cumulative[i]} />,
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
  /** Per-bucket headline magnitude shown on the strip + week banner. For item
   * lanes pass the item COUNT (== bucketCounts); for programs/sheets the total. */
  barValues: number[];
  /** Per-bucket distinct-row count. */
  bucketCounts: number[];
  /** Unit for the headline magnitude, e.g. "runs" / "sheets" / "items". */
  unit: string;
  /** Noun for the row count, e.g. "program". */
  countNoun?: string;
  renderBucket: (i: number) => ReactNode;
  emptyLabel?: string;
}

/**
 * Week-by-week board: an urgency-weighted week strip up top (proportional fill
 * bars, click to jump), then every week's plan stacked below (cumulative), each
 * under an urgency-banded banner. Parameterised over the metric.
 */
export function WeeklyBoard({ weeks, barValues, bucketCounts, unit, countNoun = "item", renderBucket, emptyLabel }: WeeklyBoardProps) {
  const hasAny = bucketCounts.some((c) => c > 0);
  const max = Math.max(1, ...barValues);
  const fmt = (n: number) => (Number.isInteger(n) ? n.toString() : (Math.round(n * 10) / 10).toString());
  const scrollTo = (key: string) =>
    document.getElementById(`wk-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-4">
      {/* Week strip — workload heat overview + jump nav */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {weeks.map((w, i) => {
          const v = barValues[i];
          if (bucketCounts[i] === 0) {
            return (
              <div
                key={w.key}
                title={`${w.title} · nothing due`}
                className="flex w-[46px] shrink-0 flex-col items-center justify-center rounded-lg border border-[var(--border)] py-2 opacity-50"
              >
                <span className="text-[10px] text-[var(--muted-foreground)]">—</span>
              </div>
            );
          }
          const fillPct = Math.max(8, Math.round((v / max) * 100));
          return (
            <button
              key={w.key}
              type="button"
              onClick={() => scrollTo(w.key)}
              title={`${w.title} · ${fmt(v)} ${unit}`}
              className={cn(
                "flex w-[104px] shrink-0 cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors hover:border-[var(--border-strong)]",
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
                  "font-medium leading-tight tabular-nums",
                  w.isOverdue || w.isCurrent ? "text-2xl" : "text-xl",
                  w.isOverdue ? "text-[var(--destructive)]" : "text-[var(--foreground)]",
                )}
              >
                {fmt(v)}
              </span>
              <span className="truncate text-[10px] text-[var(--muted-foreground)]">{unit}</span>
              <span
                className={cn(
                  "mt-1 block h-[3px] rounded-full",
                  w.isOverdue ? "bg-[var(--destructive)]" : w.isCurrent ? "bg-[var(--primary)]" : "bg-[var(--border-strong)]",
                )}
                style={{ width: `${fillPct}%` }}
              />
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
                <div
                  className={cn(
                    "mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-3 py-2",
                    w.isOverdue ? "bg-[var(--destructive-bg)]/60" : w.isCurrent ? "bg-[var(--primary)]/10" : "bg-[var(--muted)]/50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        w.isOverdue ? "bg-[var(--destructive)]" : w.isCurrent ? "bg-[var(--primary)]" : "bg-[var(--border-strong)]",
                      )}
                    />
                    <h3
                      className={cn(
                        "font-medium",
                        w.isOverdue || w.isCurrent ? "text-base text-[var(--foreground)]" : "text-sm text-[var(--muted-foreground)]",
                        w.isOverdue && "text-[var(--destructive)]",
                      )}
                    >
                      {w.title}
                    </h3>
                    {w.isOverdue && (
                      <span className="rounded-md bg-[var(--destructive)] px-2 py-0.5 text-[11px] font-medium text-[var(--card)]">PAST DUE</span>
                    )}
                    <span className="text-xs text-[var(--muted-foreground)]">{w.subtitle}</span>
                  </div>
                  <span className="text-sm tabular-nums">
                    <span className={cn("font-medium", w.isOverdue ? "text-[var(--destructive)]" : "text-[var(--foreground)]")}>
                      {fmt(barValues[i])} {unit}
                    </span>
                    {barValues[i] !== bucketCounts[i] && (
                      <span className="text-[var(--muted-foreground)]">
                        {" · "}
                        {bucketCounts[i]} {bucketCounts[i] === 1 ? countNoun : `${countNoun}s`}
                      </span>
                    )}
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
