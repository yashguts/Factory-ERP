"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { cn } from "@/lib/utils";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { WeeklyBoard } from "@/components/mrp/weekly-board";
import { Hammer, ShoppingCart, Wrench, Package, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { WeeklyMrpPlan } from "@/lib/actions/mrp-weekly";

type Tab = "programs" | "make" | "trade" | "buy";

const fmtQty = (n: number) => (Number.isInteger(n) ? n.toString() : (Math.round(n * 10) / 10).toString());
const machineLabel = (m: string) => m.replace(/^cnc_/, "").replace(/_/g, " ");

export function WeeklyMrpClient({ plan }: { plan: WeeklyMrpPlan }) {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(
    () => readParam(sp, "tab", "programs", ["programs", "make", "trade", "buy"]) as Tab,
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

    type Row = { id: string; code: string; name: string; perWeek: number[]; cumulative: number[]; sub?: string };
    const rows: Row[] =
      tab === "buy"
        ? plan.buy.map((r) => ({ id: r.item_id, code: r.code, name: r.name, perWeek: r.perWeek, cumulative: r.cumulative, sub: r.thicknessMm != null ? `${r.thicknessMm}mm` : undefined }))
        : (tab === "make" ? plan.make : plan.trade).map((r) => ({ id: r.item_id, code: r.code, name: r.name, perWeek: r.perWeek, cumulative: r.cumulative, sub: r.uom ?? undefined }));
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
      unit: tab === "buy" ? "sheets" : "units",
      countNoun: tab === "buy" ? "sheet" : "item",
      renderBucket,
      empty: tab === "buy" ? "No raw sheets to cut in this window." : `No ${tab} shortfall in this window.`,
    };
  }, [tab, plan, weeks]);

  const TABS: { key: Tab; label: string; icon: typeof Hammer; count: number }[] = [
    { key: "programs", label: "Programs to run", icon: Hammer, count: plan.programs.length },
    { key: "make", label: "Make", icon: Wrench, count: plan.make.length },
    { key: "trade", label: "Trade", icon: ShoppingCart, count: plan.trade.length },
    { key: "buy", label: "Buy list (sheets)", icon: Package, count: plan.buy.length },
  ];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">MRP — Weekly Plan</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Cumulative material plan, week by week — {plan.totals.globalRuns} program runs · {plan.totals.globalSheets} sheets across the next 8 weeks.
        </p>
      </div>

      <MrpToolbar view="weekly" date="" />

      {/* Totals */}
      <div className="flex flex-wrap gap-3 mb-3">
        <Stat label="Program runs" value={plan.totals.globalRuns} />
        <Stat label="Sheets to cut" value={plan.totals.globalSheets} />
        <Stat label="Make items" value={plan.totals.makeShortfallItems} />
        <Stat label="Trade items" value={plan.totals.tradeShortfallItems} />
        {plan.blocked.length > 0 && <Stat label="Blocked" value={plan.blocked.length} warn />}
      </div>

      {/* No-over-provisioning proof + out-of-scope note */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 text-xs text-[var(--muted-foreground)]">
        <span className="inline-flex items-center gap-1.5 text-emerald-600">
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
      <div className="flex gap-1 mb-4 border-b border-[var(--border)] flex-wrap">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer",
                active ? "border-[var(--primary)] text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              <span className={cn("text-[11px] rounded-full px-1.5 py-0.5", active ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{t.count}</span>
            </button>
          );
        })}
      </div>

      <WeeklyBoard
        weeks={weeks}
        barValues={lane.barValues}
        bucketCounts={lane.bucketCounts}
        unit={lane.unit}
        countNoun={lane.countNoun}
        renderBucket={lane.renderBucket}
        emptyLabel={lane.empty}
      />

      {tab === "programs" && plan.blocked.length > 0 && (
        <div className="mt-6">
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

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={cn("card-surface px-4 py-2.5 min-w-[120px]", warn && "border-[var(--warning-border)]")}>
      <div className={cn("text-xl font-bold tabular-nums", warn && "text-[var(--warning)]")}>{value}</div>
      <div className="text-xs text-[var(--muted-foreground)]">{label}</div>
    </div>
  );
}
