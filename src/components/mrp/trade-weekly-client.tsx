"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { WeeklyBoard, groupedItemBucket, CategoryTable, QtyCell, type WeeklyGroupRow } from "@/components/mrp/weekly-board";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { Tabs } from "@/components/ui/tabs";
import { ShoppingCart, Package, CheckCircle2 } from "lucide-react";
import type { WeeklyMrpPlan } from "@/lib/actions/mrp-weekly";

const fmtQty = (n: number) =>
  Number.isInteger(n) ? n.toString() : (Math.round(n * 10) / 10).toString();

type Tab = "items" | "sheets";

/**
 * Trade MRP — Weekly Plan. The bought-in counterpart to the Make weekly board:
 * what to buy week by week (cumulative by each week's deadline) so procurement
 * can stage purchase orders. Two tabs:
 *  - Trade items: bought-in parts that go short (the plan's `trade` lane).
 *  - Buy list (sheets): raw steel sheets/plates the programs need (the `buy`
 *    lane). Buying sheets is a trade activity, so it lives here rather than on
 *    the Make weekly board.
 * Reuses the same cached getWeeklyMrpPlan as the Make weekly view (same args →
 * same cache entry), so showing it costs nothing extra.
 */
export function TradeWeeklyClient({ plan }: { plan: WeeklyMrpPlan }) {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(
    () => readParam(sp, "tab", "items", ["items", "sheets"]) as Tab,
  );
  useUrlListSync({ tab }, { tab: "items" });

  const weeks = plan.weeks;

  const lane = useMemo(() => {
    if (tab === "sheets") {
      const rows = plan.buy;
      const barValues = weeks.map((_, i) => rows.reduce((s, r) => s + r.perWeek[i], 0));
      const bucketCounts = weeks.map((_, i) => rows.filter((r) => r.perWeek[i] > 1e-9).length);
      const renderBucket = (i: number): ReactNode => {
        const present = rows.filter((r) => r.perWeek[i] > 1e-9);
        const byThick = new Map<string, typeof present>();
        for (const r of present) {
          const k = r.thicknessMm != null ? `${r.thicknessMm}mm` : "Other";
          const arr = byThick.get(k);
          if (arr) arr.push(r);
          else byThick.set(k, [r]);
        }
        const keys = [...byThick.keys()].sort((a, b) => (parseFloat(a) || 1e9) - (parseFloat(b) || 1e9));
        return (
          <div className="space-y-2.5">
            {keys.map((k, ki) => {
              const items = byThick.get(k)!.sort((a, b) => b.perWeek[i] - a.perWeek[i]);
              const tot = items.reduce((s, r) => s + r.perWeek[i], 0);
              return (
                <CategoryTable
                  key={k}
                  title={k === "Other" ? "Other sheets" : `${k} sheets`}
                  showHead={ki === 0}
                  meta={
                    <>
                      <span className="font-medium text-[var(--foreground)]">+{fmtQty(tot)}</span> · {items.length}
                    </>
                  }
                  cols={[
                    { label: "Code", width: "92px", className: "font-mono text-[11px] text-[var(--muted-foreground)]" },
                    { label: "Sheet / plate" },
                    { label: "Buy", align: "right", width: "26%" },
                  ]}
                  rows={items.map((r) => ({
                    id: r.item_id,
                    cells: [
                      r.code,
                      <span key="n" className="block truncate" title={r.name}>{r.name}</span>,
                      <QtyCell key="q" prefix="+" qty={r.perWeek[i]} cum={r.cumulative[i]} />,
                    ],
                  }))}
                />
              );
            })}
          </div>
        );
      };
      return { barValues, bucketCounts, unit: "sheets", countNoun: "type", renderBucket, empty: "No raw sheets to buy in this window." };
    }

    const rows: WeeklyGroupRow[] = plan.trade.map((r) => ({ id: r.item_id, code: r.code, name: r.name, topCategory: r.topCategory, perWeek: r.perWeek, cumulative: r.cumulative, sub: r.uom ?? undefined }));
    // Headline = number of distinct items to buy (summing quantities across
    // different bought parts is meaningless); per-row qty stays in each table.
    const bucketCounts = weeks.map((_, i) => rows.filter((r) => r.perWeek[i] > 1e-9).length);
    return { barValues: bucketCounts, bucketCounts, unit: "items", countNoun: "item", renderBucket: (i: number) => groupedItemBucket(rows, i), empty: "No trade shortfall in this window." };
  }, [tab, plan, weeks]);

  const sheetTotal = useMemo(() => plan.buy.reduce((s, r) => s + r.total, 0), [plan.buy]);

  const TABS = [
    { value: "items" as const, icon: ShoppingCart, label: "Trade items", count: plan.trade.length },
    { value: "sheets" as const, icon: Package, label: "Buy list (sheets)", count: plan.buy.length },
  ];

  return (
    <div>
      <MrpToolbar view="weekly" date="" section="trade" />

      <PageHeader
        title="Trade MRP — Weekly Plan"
        meta={`${plan.trade.length} trade items · ${fmtQty(sheetTotal)} sheets · next 8 weeks`}
        subtitle="What to buy, week by week (cumulative by each week's deadline)."
      />

      <StatStrip className="mb-3">
        <StatTile label="Trade items short" value={plan.trade.length} />
        <StatTile label="Sheets to buy" value={fmtQty(sheetTotal)} />
      </StatStrip>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-[var(--muted-foreground)]">
        <span className="inline-flex items-center gap-1.5 text-[var(--success)]">
          <CheckCircle2 size={14} />
          Cumulative — each week shows what has accrued by that week&apos;s deadline.
        </span>
        {(plan.laterCount > 0 || plan.undatedCount > 0) && (
          <span>
            Not planned here: {plan.laterCount > 0 && <strong className="text-[var(--foreground)]">{plan.laterCount}</strong>}{plan.laterCount > 0 && " due after 8 weeks"}
            {plan.laterCount > 0 && plan.undatedCount > 0 && " · "}
            {plan.undatedCount > 0 && <strong className="text-[var(--foreground)]">{plan.undatedCount}</strong>}{plan.undatedCount > 0 && " with no Req. Dispatch date"}.
          </span>
        )}
      </div>

      <Tabs
        variant="underline"
        className="mb-4"
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        tabs={TABS.map((t) => {
          const Icon = t.icon;
          return {
            value: t.value,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Icon className="h-4 w-4" />
                {t.label}
              </span>
            ),
            count: t.count,
          };
        })}
      />

      <WeeklyBoard
        weeks={weeks}
        barValues={lane.barValues}
        bucketCounts={lane.bucketCounts}
        unit={lane.unit}
        countNoun={lane.countNoun}
        renderBucket={lane.renderBucket}
        emptyLabel={lane.empty}
      />
    </div>
  );
}
