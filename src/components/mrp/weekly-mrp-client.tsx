"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { WeeklyBoard, groupedItemBucket, CategoryTable, type WeeklyGroupRow } from "@/components/mrp/weekly-board";
import { WeeklyCapacity } from "@/components/mrp/weekly-capacity";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { Tabs } from "@/components/ui/tabs";
import { Hammer, Wrench, Gauge, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeeklyMrpPlan } from "@/lib/actions/mrp-weekly";

// Trade has its own sidebar section (/mrp/trade/weekly), so the Make weekly
// board no longer carries a Trade or a Buy-list (sheets) tab — buying sheets is
// a trade activity and lives under Trade weekly.
type Tab = "programs" | "make" | "capacity";

const machineLabel = (m: string) => m.replace(/^cnc_/, "").replace(/_/g, " ");

export function WeeklyMrpClient({ plan }: { plan: WeeklyMrpPlan }) {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(
    () => readParam(sp, "tab", "programs", ["programs", "make", "capacity"]) as Tab,
  );
  // Sheet-thickness filter (Programs tab): "all" or a thickness like "3" (mm).
  const [thickFilter, setThickFilter] = useState<string>(() => readParam(sp, "thick", "all"));
  useUrlListSync({ tab, thick: thickFilter }, { tab: "programs", thick: "all" });

  const weeks = plan.weeks;

  // Distinct sheet thicknesses across all programs' inputs, ascending.
  const thicknesses = useMemo(
    () => [...new Set(plan.programs.flatMap((p) => p.inputs.map((i) => i.thicknessMm)).filter((t): t is number => t != null))].sort((a, b) => a - b),
    [plan.programs],
  );

  const lane = useMemo(() => {
    if (tab === "programs") {
      const rows = thickFilter === "all"
        ? plan.programs
        : plan.programs.filter((r) => r.inputs.some((inp) => String(inp.thicknessMm) === thickFilter));
      const barValues = weeks.map((_, i) => rows.reduce((s, r) => s + r.runsPerWeek[i], 0));
      const bucketCounts = weeks.map((_, i) => rows.filter((r) => r.runsPerWeek[i] > 0).length);
      const renderBucket = (i: number): ReactNode => {
        const present = rows.filter((r) => r.runsPerWeek[i] > 0);
        const byCat = new Map<string, typeof present>();
        for (const r of present) {
          const arr = byCat.get(r.category);
          if (arr) arr.push(r);
          else byCat.set(r.category, [r]);
        }
        const cats = [...byCat.keys()].sort((a, b) => a.localeCompare(b));
        return (
          <div className="space-y-3">
            {cats.map((cat) => {
              const items = byCat.get(cat)!.sort((a, b) => b.runsPerWeek[i] - a.runsPerWeek[i]);
              const catRuns = items.reduce((s, r) => s + r.runsPerWeek[i], 0);
              return (
                <CategoryTable
                  key={cat}
                  title={cat}
                  meta={`${items.length} program${items.length === 1 ? "" : "s"} · ×${catRuns} runs`}
                  cols={[
                    { label: "Code", width: "19%", className: "font-mono text-xs" },
                    { label: "Program" },
                    { label: "Machine", width: "13%" },
                    { label: "Sheet", width: "9%" },
                    { label: "Runs", align: "right", width: "10%" },
                    { label: "Cumulative", align: "right", width: "14%" },
                  ]}
                  rows={items.map((r) => {
                    const sheet = r.inputs[0];
                    return {
                      id: r.program_id,
                      cells: [
                        r.code,
                        <span key="n" className="block truncate" title={r.name}>{r.name}</span>,
                        <span key="m" className="text-[var(--muted-foreground)]">{machineLabel(r.machine)}</span>,
                        sheet?.thicknessMm != null ? `${sheet.thicknessMm}mm` : "—",
                        <span key="r" className="font-semibold text-[var(--foreground)]">×{r.runsPerWeek[i]}</span>,
                        <span key="c" className="text-[var(--muted-foreground)]">{r.cumulativeRuns[i]}</span>,
                      ],
                    };
                  })}
                />
              );
            })}
          </div>
        );
      };
      return { barValues, bucketCounts, unit: "runs", countNoun: "program", renderBucket, empty: "No programs to run in this window." };
    }

    // Only the Make items board reaches here (programs handled above; capacity
    // renders WeeklyCapacity, not a board). Grouped by top-level category.
    const rows: WeeklyGroupRow[] = plan.make.map((r) => ({ id: r.item_id, code: r.code, name: r.name, topCategory: r.topCategory, perWeek: r.perWeek, cumulative: r.cumulative, sub: r.uom ?? undefined }));
    const barValues = weeks.map((_, i) => rows.reduce((s, r) => s + r.perWeek[i], 0));
    const bucketCounts = weeks.map((_, i) => rows.filter((r) => r.perWeek[i] > 1e-9).length);
    return {
      barValues, bucketCounts,
      unit: "units",
      countNoun: "item",
      renderBucket: (i: number) => groupedItemBucket(rows, i),
      empty: "No make shortfall in this window.",
    };
  }, [tab, plan, weeks, thickFilter]);

  const machineCount = useMemo(
    () => new Set(plan.programs.filter((p) => p.totalRuns > 0).map((p) => p.machine)).size,
    [plan.programs],
  );

  const TABS: { key: Tab; label: string; icon: typeof Hammer; count: number }[] = [
    { key: "programs", label: "Programs to run", icon: Hammer, count: plan.programs.length },
    { key: "make", label: "Make", icon: Wrench, count: plan.make.length },
    { key: "capacity", label: "Machine load", icon: Gauge, count: machineCount },
  ];

  return (
    <div>
      <MrpToolbar view="weekly" date="" section="make" />

      <PageHeader
        title="Make MRP — Weekly Plan"
        meta={`${plan.totals.globalRuns} program runs · ${plan.totals.globalSheets} sheets · next 8 weeks`}
        subtitle="Cumulative production plan, week by week."
      />

      {/* Totals */}
      <StatStrip className="mb-3">
        <StatTile label="Program runs" value={plan.totals.globalRuns} />
        <StatTile label="Sheets to cut" value={plan.totals.globalSheets} />
        <StatTile label="Make items" value={plan.totals.makeShortfallItems} />
      </StatStrip>

      {/* No-over-provisioning proof + out-of-scope note */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-[var(--muted-foreground)]">
        <span className="inline-flex items-center gap-1.5 text-[var(--success)]">
          <CheckCircle2 size={14} />
          Optimised once across all 8 weeks, then scheduled by deadline — {plan.totals.allocatedRuns} runs allocated = {plan.totals.globalRuns} in the optimum (no over-provisioning).
        </span>
        {(plan.laterCount > 0 || plan.undatedCount > 0) && (
          <span>
            Not planned here: {plan.laterCount > 0 && <strong className="text-[var(--foreground)]">{plan.laterCount}</strong>}{plan.laterCount > 0 && " due after 8 weeks"}
            {plan.laterCount > 0 && plan.undatedCount > 0 && " · "}
            {plan.undatedCount > 0 && <strong className="text-[var(--foreground)]">{plan.undatedCount}</strong>}{plan.undatedCount > 0 && " with no Req. Dispatch date"}.
          </span>
        )}
      </div>

      {/* Sub-tabs */}
      <Tabs
        variant="underline"
        className="mb-4 flex-wrap"
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        tabs={TABS.map((t) => {
          const Icon = t.icon;
          return {
            value: t.key,
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

      {/* Sheet-thickness filter — scopes the Programs board to one thickness */}
      {tab === "programs" && thicknesses.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-[var(--muted-foreground)]">Sheet thickness</span>
          {["all", ...thicknesses.map(String)].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setThickFilter(t)}
              className={cn(
                "cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors",
                thickFilter === t
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 font-medium text-[var(--foreground)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
              )}
            >
              {t === "all" ? "All" : `${t}mm`}
            </button>
          ))}
        </div>
      )}

      {tab === "capacity" ? (
        <WeeklyCapacity plan={plan} />
      ) : (
        <WeeklyBoard
          weeks={weeks}
          barValues={lane.barValues}
          bucketCounts={lane.bucketCounts}
          unit={lane.unit}
          countNoun={lane.countNoun}
          renderBucket={lane.renderBucket}
          emptyLabel={lane.empty}
        />
      )}
    </div>
  );
}
