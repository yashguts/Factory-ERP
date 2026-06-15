"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { WeeklyMatrix, CumulativeToggle, type MatrixRow } from "@/components/mrp/weekly-matrix";
import { MiniChip } from "@/components/mrp/weekly-board";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import type { WeeklyMrpPlan } from "@/lib/actions/mrp-weekly";

const SHEET_GROUP = "Raw steel / sheets";

/**
 * Trade MRP — Weekly plan. One view: what to buy, week by week. Trade items AND
 * the raw steel sheets the programs need are shown together as a category × week
 * matrix (cells = how many distinct things to buy by that week; expand a category
 * to see each item's quantity week by week). Cumulative (have-bought-by) or
 * per-week. Reuses the same cached getWeeklyMrpPlan as the Make weekly view.
 */
export function TradeWeeklyClient({ plan }: { plan: WeeklyMrpPlan }) {
  const sp = useSearchParams();
  const [cumulative, setCumulative] = useState(() => readParam(sp, "cumul", "1") !== "0");
  const [cat, setCat] = useState(() => readParam(sp, "cat", "all"));
  useUrlListSync({ cumul: cumulative ? "1" : "0", cat }, { cumul: "1", cat: "all" });

  const rows = useMemo<MatrixRow[]>(() => {
    const out: MatrixRow[] = [];
    for (const r of plan.trade) {
      out.push({
        id: r.item_id,
        code: r.code,
        name: r.name,
        category: r.topCategory || "Uncategorised",
        perWeek: r.perWeek,
        cumulative: r.cumulative,
        sub: r.uom ?? undefined,
      });
    }
    for (const r of plan.buy) {
      out.push({
        id: `sheet-${r.item_id}`,
        code: r.code,
        name: r.name,
        category: SHEET_GROUP,
        perWeek: r.perWeek,
        cumulative: r.cumulative,
        sub: r.thicknessMm != null ? <MiniChip tone="thickness">{r.thicknessMm}mm</MiniChip> : undefined,
      });
    }
    return out;
  }, [plan]);

  const categories = useMemo(() => {
    const set = new Set(rows.map((r) => r.category));
    const list = [...set].filter((c) => c !== SHEET_GROUP).sort((a, b) => a.localeCompare(b));
    if (set.has(SHEET_GROUP)) list.push(SHEET_GROUP);
    return list;
  }, [rows]);

  const shown = cat === "all" ? rows : rows.filter((r) => r.category === cat);

  return (
    <div>
      <MrpToolbar view="weekly" date="" section="trade" />

      <PageHeader
        title="Trade MRP — Weekly plan"
        meta={`Next 8 weeks · ${plan.trade.length} items + ${plan.buy.length} sheets to buy`}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Select size="sm" value={cat} onChange={(e) => setCat(e.target.value)} className="w-[200px]">
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <CumulativeToggle cumulative={cumulative} onChange={setCumulative} />
      </div>

      <WeeklyMatrix
        weeks={plan.weeks}
        rows={shown}
        aggregate="count"
        unit="to buy"
        cumulative={cumulative}
        pinLast={SHEET_GROUP}
        emptyLabel="Nothing to buy in this window."
      />

      {(plan.laterCount > 0 || plan.undatedCount > 0) && (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          Not planned here:{" "}
          {plan.laterCount > 0 && <><strong className="text-[var(--foreground)]">{plan.laterCount}</strong> due after 8 weeks</>}
          {plan.laterCount > 0 && plan.undatedCount > 0 && " · "}
          {plan.undatedCount > 0 && <><strong className="text-[var(--foreground)]">{plan.undatedCount}</strong> with no Req. Dispatch date</>}.
        </p>
      )}
    </div>
  );
}
