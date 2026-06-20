"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { WeeklyMatrix, CumulativeToggle, type MatrixRow } from "@/components/mrp/weekly-matrix";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { LayoutGrid } from "lucide-react";
import type { CabinWeeklyPlan } from "@/lib/actions/cabin-program-plan";

export function CabinWeeklyClient({ plan }: { plan: CabinWeeklyPlan }) {
  const sp = useSearchParams();
  const [cumulative, setCumulative] = useState(() => readParam(sp, "cumul", "1") !== "0");
  const [type, setType] = useState(() => readParam(sp, "type", "all"));
  const [finish, setFinish] = useState(() => readParam(sp, "fin", "all"));
  useUrlListSync({ cumul: cumulative ? "1" : "0", type, fin: finish }, { cumul: "1", type: "all", fin: "all" });

  const types = useMemo(() => [...new Set(plan.rows.map((r) => r.type))].sort(), [plan.rows]);
  const finishes = useMemo(() => [...new Set(plan.rows.map((r) => r.finish ?? "(no finish)"))].sort(), [plan.rows]);

  const rows = useMemo<MatrixRow[]>(
    () =>
      plan.rows
        .filter((r) => (type === "all" || r.type === type) && (finish === "all" || (r.finish ?? "(no finish)") === finish))
        .map((r) => ({
          id: r.item_id,
          code: r.code,
          name: r.name,
          category: r.type,
          perWeek: r.perWeek,
          cumulative: r.cumulative,
          sub: r.finish ?? undefined,
        })),
    [plan.rows, type, finish],
  );

  return (
    <div>
      <MrpToolbar view="weekly" date="" section="cabin" />

      <PageHeader
        icon={<LayoutGrid size={18} />}
        title="Cabin MRP — Weekly plan"
        meta="Cabin demand by week, dated from each cabin job's linked elevator job"
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select size="sm" value={type} onChange={(e) => setType(e.target.value)} className="w-[180px]">
            <option value="all">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select size="sm" value={finish} onChange={(e) => setFinish(e.target.value)} className="w-[180px]">
            <option value="all">All finishes</option>
            {finishes.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </div>
        <CumulativeToggle cumulative={cumulative} onChange={setCumulative} />
      </div>

      <WeeklyMatrix
        weeks={plan.weeks}
        rows={rows}
        aggregate="count"
        unit="items"
        cumulative={cumulative}
        emptyLabel="No cabin demand falls in the next 8 weeks."
      />

      {plan.laterCount > 0 && (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          Not planned here: <strong className="text-[var(--foreground)]">{plan.laterCount}</strong> cabin job{plan.laterCount === 1 ? "" : "s"} due after 8 weeks.
        </p>
      )}
      {plan.undatedCount > 0 && (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          <strong className="text-[var(--foreground)]">{plan.undatedCount}</strong> cabin job{plan.undatedCount === 1 ? "" : "s"} have no linked dated Job — their demand is shown in the <strong className="text-[var(--foreground)]">Undated</strong> column. Give the matching Job a Requirement Dispatch Date (or fix the job number) to schedule it.
        </p>
      )}
    </div>
  );
}
