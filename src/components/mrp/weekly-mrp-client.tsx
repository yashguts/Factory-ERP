"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { WeeklyBoard } from "@/components/mrp/weekly-board";
import { WeeklyCapacity } from "@/components/mrp/weekly-capacity";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { Tabs } from "@/components/ui/tabs";
import { Hammer, Wrench, Gauge, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { WeeklyMrpPlan } from "@/lib/actions/mrp-weekly";

// Trade has its own sidebar section (/mrp/trade/weekly), so the Make weekly
// board no longer carries a Trade or a Buy-list (sheets) tab — buying sheets is
// a trade activity and lives under Trade weekly.
type Tab = "programs" | "make" | "capacity";

const fmtQty = (n: number) => (Number.isInteger(n) ? n.toString() : (Math.round(n * 10) / 10).toString());
const machineLabel = (m: string) => m.replace(/^cnc_/, "").replace(/_/g, " ");

export function WeeklyMrpClient({ plan }: { plan: WeeklyMrpPlan }) {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(
    () => readParam(sp, "tab", "programs", ["programs", "make", "capacity"]) as Tab,
  );
  useUrlListSync({ tab }, { tab: "programs" });

  const weeks = plan.weeks;

  const lane = useMemo(() => {
    if (tab === "programs") {
      const rows = plan.programs;
      const barValues = weeks.map((_, i) => rows.reduce((s, r) => s + r.runsPerWeek[i], 0));
      const bucketCounts = weeks.map((_, i) => rows.filter((r) => r.runsPerWeek[i] > 0).length);
      const renderBucket = (i: number): ReactNode => (
        <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
          {rows
            .filter((r) => r.runsPerWeek[i] > 0)
            .sort((a, b) => b.runsPerWeek[i] - a.runsPerWeek[i])
            .map((r) => {
              const sheet = r.inputs[0];
              return (
                <div key={r.program_id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--muted)]">
                  <span className="font-mono text-xs font-semibold shrink-0">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted-foreground)]" title={r.name}>{r.name}</span>
                  {sheet?.thicknessMm != null && (
                    <span className="text-[11px] text-[var(--muted-foreground)] shrink-0 hidden sm:inline">{sheet.thicknessMm}mm</span>
                  )}
                  <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)] shrink-0 hidden md:inline w-16 text-right">{machineLabel(r.machine)}</span>
                  <span className="text-sm font-semibold tabular-nums shrink-0">×{r.runsPerWeek[i]}</span>
                  <span className="text-[11px] text-[var(--muted-foreground)] tabular-nums shrink-0 w-[58px] text-right">cum {r.cumulativeRuns[i]}</span>
                </div>
              );
            })}
        </div>
      );
      return { barValues, bucketCounts, unit: "runs", countNoun: "program", renderBucket, empty: "No programs to run in this window." };
    }

    // Only the Make items board reaches here (programs handled above; capacity
    // renders WeeklyCapacity, not a board).
    type Row = { id: string; code: string; name: string; perWeek: number[]; cumulative: number[]; sub?: string };
    const rows: Row[] = plan.make.map((r) => ({ id: r.item_id, code: r.code, name: r.name, perWeek: r.perWeek, cumulative: r.cumulative, sub: r.uom ?? undefined }));
    const barValues = weeks.map((_, i) => rows.reduce((s, r) => s + r.perWeek[i], 0));
    const bucketCounts = weeks.map((_, i) => rows.filter((r) => r.perWeek[i] > 1e-9).length);
    const renderBucket = (i: number): ReactNode => (
      <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
        {rows
          .filter((r) => r.perWeek[i] > 1e-9)
          .sort((a, b) => b.perWeek[i] - a.perWeek[i])
          .map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--muted)]">
              <span className="font-mono text-xs font-semibold shrink-0">{r.code}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted-foreground)]" title={r.name}>{r.name}</span>
              {r.sub && <span className="text-[11px] text-[var(--muted-foreground)] shrink-0">{r.sub}</span>}
              <span className="text-sm font-semibold tabular-nums shrink-0">+{fmtQty(r.perWeek[i])}</span>
              <span className="text-[11px] text-[var(--muted-foreground)] tabular-nums shrink-0 w-[68px] text-right">cum {fmtQty(r.cumulative[i])}</span>
            </div>
          ))}
      </div>
    );
    return {
      barValues, bucketCounts,
      unit: "units",
      countNoun: "item",
      renderBucket,
      empty: "No make shortfall in this window.",
    };
  }, [tab, plan, weeks]);

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
        {plan.blocked.length > 0 && (
          <StatTile label="Blocked" value={plan.blocked.length} tone="warn" />
        )}
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

      {tab === "programs" && plan.blocked.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-[var(--warning)]">
            <AlertTriangle size={14} /> Can&apos;t make — no audited program ({plan.blocked.length})
          </h3>
          <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
            {plan.blocked.map((b) => (
              <div key={b.code} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <span className="font-mono text-xs font-semibold shrink-0">{b.code}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--muted-foreground)]" title={b.name}>{b.name}</span>
                <span className="tabular-nums shrink-0 text-[var(--muted-foreground)]">need {b.need}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
