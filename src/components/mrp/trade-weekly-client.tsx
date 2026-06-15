"use client";

import { useMemo, type ReactNode } from "react";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { WeeklyBoard } from "@/components/mrp/weekly-board";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { CheckCircle2 } from "lucide-react";
import type { WeeklyMrpPlan } from "@/lib/actions/mrp-weekly";

const fmtQty = (n: number) =>
  Number.isInteger(n) ? n.toString() : (Math.round(n * 10) / 10).toString();

/**
 * Trade MRP — Weekly Plan. The bought-in counterpart to the Make weekly board:
 * which trade items go short, week by week (cumulative by each week's deadline),
 * so procurement can stage purchase orders. Reuses the same cached
 * getWeeklyMrpPlan as the Make weekly view (same cache key), so showing it costs
 * nothing extra — we just surface the `trade` lane on its own.
 */
export function TradeWeeklyClient({ plan }: { plan: WeeklyMrpPlan }) {
  const weeks = plan.weeks;
  const rows = plan.trade;

  const barValues = useMemo(
    () => weeks.map((_, i) => rows.reduce((s, r) => s + r.perWeek[i], 0)),
    [weeks, rows],
  );
  const bucketCounts = useMemo(
    () => weeks.map((_, i) => rows.filter((r) => r.perWeek[i] > 1e-9).length),
    [weeks, rows],
  );
  const totalUnits = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows]);

  const renderBucket = (i: number): ReactNode => (
    <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
      {rows
        .filter((r) => r.perWeek[i] > 1e-9)
        .sort((a, b) => b.perWeek[i] - a.perWeek[i])
        .map((r) => (
          <div key={r.item_id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--muted)]">
            <span className="font-mono text-xs font-semibold shrink-0">{r.code}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted-foreground)]" title={r.name}>{r.name}</span>
            {r.uom && <span className="text-[11px] text-[var(--muted-foreground)] shrink-0">{r.uom}</span>}
            <span className="text-sm font-semibold tabular-nums shrink-0">+{fmtQty(r.perWeek[i])}</span>
            <span className="text-[11px] text-[var(--muted-foreground)] tabular-nums shrink-0 w-[68px] text-right">cum {fmtQty(r.cumulative[i])}</span>
          </div>
        ))}
    </div>
  );

  return (
    <div>
      <MrpToolbar view="weekly" date="" section="trade" />

      <PageHeader
        title="Trade MRP — Weekly Plan"
        meta={`${rows.length} trade items · ${fmtQty(totalUnits)} units to procure · next 8 weeks`}
        subtitle="When each bought-in item goes short, week by week (cumulative)."
      />

      <StatStrip className="mb-3">
        <StatTile label="Trade items short" value={rows.length} />
        <StatTile label="Total units to procure" value={fmtQty(totalUnits)} tone="danger" />
      </StatStrip>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-[var(--muted-foreground)]">
        <span className="inline-flex items-center gap-1.5 text-[var(--success)]">
          <CheckCircle2 size={14} />
          Cumulative — each week shows the shortfall accrued by that week&apos;s deadline.
        </span>
        {(plan.laterCount > 0 || plan.undatedCount > 0) && (
          <span>
            Not planned here: {plan.laterCount > 0 && <strong className="text-[var(--foreground)]">{plan.laterCount}</strong>}{plan.laterCount > 0 && " due after 8 weeks"}
            {plan.laterCount > 0 && plan.undatedCount > 0 && " · "}
            {plan.undatedCount > 0 && <strong className="text-[var(--foreground)]">{plan.undatedCount}</strong>}{plan.undatedCount > 0 && " with no Req. Dispatch date"}.
          </span>
        )}
      </div>

      <WeeklyBoard
        weeks={weeks}
        barValues={barValues}
        bucketCounts={bucketCounts}
        unit="units"
        countNoun="item"
        renderBucket={renderBucket}
        emptyLabel="No trade shortfall in this window."
      />
    </div>
  );
}
