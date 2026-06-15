"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { WeeklyMatrix, CumulativeToggle, type MatrixRow } from "@/components/mrp/weekly-matrix";
import { MiniChip } from "@/components/mrp/weekly-board";
import { WeeklyCapacity } from "@/components/mrp/weekly-capacity";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Hammer, Wrench, Gauge, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeeklyMrpPlan } from "@/lib/actions/mrp-weekly";

type Tab = "programs" | "make" | "capacity";

const machineLabel = (m: string) => m.replace(/^cnc_/, "").replace(/_/g, " ");
const ALL = "all";

export function WeeklyMrpClient({ plan }: { plan: WeeklyMrpPlan }) {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(
    () => readParam(sp, "tab", "programs", ["programs", "make", "capacity"]) as Tab,
  );
  const [thickFilter, setThickFilter] = useState<string>(() => readParam(sp, "thick", "all"));
  const [cumulative, setCumulative] = useState(() => readParam(sp, "cumul", "1") !== "0");
  const [cat, setCat] = useState(() => readParam(sp, "cat", "all"));
  useUrlListSync(
    { tab, thick: thickFilter, cumul: cumulative ? "1" : "0", cat },
    { tab: "programs", thick: "all", cumul: "1", cat: "all" },
  );

  const weeks = plan.weeks;

  const thicknesses = useMemo(
    () => [...new Set(plan.programs.flatMap((p) => p.inputs.map((i) => i.thicknessMm)).filter((t): t is number => t != null))].sort((a, b) => a - b),
    [plan.programs],
  );

  // ── Programs lane ──────────────────────────────────────────────────────────
  const programsFiltered = useMemo(
    () =>
      thickFilter === "all"
        ? plan.programs
        : plan.programs.filter((r) => r.inputs.some((inp) => String(inp.thicknessMm) === thickFilter)),
    [plan.programs, thickFilter],
  );
  const programRows = useMemo<MatrixRow[]>(
    () =>
      programsFiltered.map((r) => {
        const sheet = r.inputs[0];
        return {
          id: r.program_id,
          code: r.code,
          name: r.name,
          category: r.category,
          perWeek: r.runsPerWeek,
          cumulative: r.cumulativeRuns,
          sub: (
            <span className="inline-flex items-center gap-1">
              <MiniChip>{machineLabel(r.machine)}</MiniChip>
              {sheet?.thicknessMm != null && <MiniChip tone="thickness">{sheet.thicknessMm}mm</MiniChip>}
            </span>
          ),
        };
      }),
    [programsFiltered],
  );
  // Sheets to cut over the horizon, per thickness (filter-aware).
  const sheetTally = useMemo(() => {
    const byThick = new Map<number, number>();
    for (const p of programsFiltered)
      for (const inp of p.inputs)
        if (inp.thicknessMm != null)
          byThick.set(inp.thicknessMm, (byThick.get(inp.thicknessMm) ?? 0) + p.totalRuns * inp.perRun);
    return [...byThick.entries()].sort((a, b) => a[0] - b[0]);
  }, [programsFiltered]);

  // ── Make-items lane ────────────────────────────────────────────────────────
  const makeRows = useMemo<MatrixRow[]>(
    () =>
      plan.make.map((r) => ({
        id: r.item_id,
        code: r.code,
        name: r.name,
        category: r.topCategory || "Uncategorised",
        perWeek: r.perWeek,
        cumulative: r.cumulative,
        sub: r.uom ?? undefined,
      })),
    [plan.make],
  );

  const activeRows = tab === "programs" ? programRows : makeRows;
  const categories = useMemo(() => {
    const set = new Set(activeRows.map((r) => r.category));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [activeRows]);
  // Reset a stale category focus when switching tabs to a lane that lacks it.
  const effectiveCat = cat !== ALL && categories.includes(cat) ? cat : ALL;
  const shownRows = effectiveCat === ALL ? activeRows : activeRows.filter((r) => r.category === effectiveCat);

  const machineCount = useMemo(
    () => new Set(plan.programs.filter((p) => p.totalRuns > 0).map((p) => p.machine)).size,
    [plan.programs],
  );

  const TABS: { key: Tab; label: string; icon: typeof Hammer; count: number }[] = [
    { key: "programs", label: "Programs to run", icon: Hammer, count: plan.programs.length },
    { key: "make", label: "Make items", icon: Wrench, count: plan.make.length },
    { key: "capacity", label: "Machine load", icon: Gauge, count: machineCount },
  ];

  return (
    <div>
      <MrpToolbar view="weekly" date="" section="make" />

      <PageHeader
        title="Make MRP — Weekly plan"
        meta={
          <span
            className="inline-flex items-center gap-1.5"
            title={`Optimised once across all 8 weeks, then scheduled by deadline — ${plan.totals.allocatedRuns} runs allocated = ${plan.totals.globalRuns} in the optimum (no over-provisioning).`}
          >
            Next 8 weeks
            <Info size={13} className="text-[var(--muted-foreground)]" aria-hidden />
          </span>
        }
      />

      <StatStrip className="mb-3">
        <StatTile label="Program runs" value={plan.totals.globalRuns} />
        <StatTile label="Sheets to cut" value={plan.totals.globalSheets} />
        <StatTile label="Make items" value={plan.totals.makeShortfallItems} />
      </StatStrip>

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
        <>
          {/* Controls: category focus, thickness filter (programs), cumulative toggle */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select size="sm" value={effectiveCat} onChange={(e) => setCat(e.target.value)} className="w-[200px]">
                <option value={ALL}>All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
              {tab === "programs" && thicknesses.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
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
                      {t === "all" ? "All mm" : `${t}mm`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <CumulativeToggle cumulative={cumulative} onChange={setCumulative} />
          </div>

          {tab === "programs" && sheetTally.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[var(--muted-foreground)]">Sheets to cut</span>
              {sheetTally.map(([mm, n]) => (
                <span key={mm} className="rounded-md border border-[var(--border)] px-2 py-0.5 font-medium tabular-nums">
                  {mm}mm × {Math.round(n)}
                </span>
              ))}
            </div>
          )}

          <WeeklyMatrix
            weeks={weeks}
            rows={shownRows}
            aggregate={tab === "programs" ? "sum" : "count"}
            unit={tab === "programs" ? "runs" : "items"}
            cumulative={cumulative}
            emptyLabel={tab === "programs" ? "No programs to run in this window." : "No make shortfall in this window."}
          />

          {(plan.laterCount > 0 || plan.undatedCount > 0) && (
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">
              Not planned here:{" "}
              {plan.laterCount > 0 && <><strong className="text-[var(--foreground)]">{plan.laterCount}</strong> due after 8 weeks</>}
              {plan.laterCount > 0 && plan.undatedCount > 0 && " · "}
              {plan.undatedCount > 0 && <><strong className="text-[var(--foreground)]">{plan.undatedCount}</strong> with no Req. Dispatch date</>}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
