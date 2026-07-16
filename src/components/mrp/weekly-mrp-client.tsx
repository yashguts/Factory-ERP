"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { JobScopePicker } from "@/components/mrp/job-scope-picker";
import type { JobScopeOption } from "@/lib/actions/mrp";
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

/** Canonical finish from a program's material_label (MS, SS, SS Golden, …).
 *  Collapses the messy real-world variants ("MS 2100"→MS, "SS ROSE GOLD"→SS Rose
 *  Gold, "Lilen"→Linen, "Honeycom"/"Honey Com"→Honeycomb) so the filter groups
 *  equivalents together. */
function normalizeFinish(label: string | null | undefined): string | null {
  if (!label) return null;
  let s = label.trim().replace(/\s+/g, " ").replace(/\s+\d{3,4}$/, ""); // drop trailing dims
  if (!s) return null;
  const up = s.toUpperCase();
  if (up === "MS" || up === "SS" || up === "GI") return up;
  s = s.replace(/\w\S*/g, (w) => {
    const u = w.toUpperCase();
    return u === "SS" || u === "TI" || u === "GI" ? u : u.charAt(0) + w.slice(1).toLowerCase();
  });
  return s.replace(/\bLilen\b/i, "Linen").replace(/\bHoney ?Com\b/i, "Honeycomb").replace(/\bHoneycom\b/i, "Honeycomb");
}

/** Best-effort finish from an item name (made items carry it in the name, not a
 *  column): SS grade (304/430/…), designer finish, else MS / GI / SS. */
const DESIGNER_FINISHES: [RegExp, string][] = [
  [/rose\s*gold\s*mirror/i, "SS Rose Gold Mirror"],
  [/rose\s*gold\s*li[ln]en/i, "SS Rose Gold Linen"],
  [/rose\s*gold/i, "SS Rose Gold"],
  [/silver\s*mirror/i, "SS Silver Mirror"],
  [/black\s*mirror/i, "SS Black Mirror"],
  [/black\s*hairline/i, "SS Black Hairline"],
  [/champagne/i, "SS Champagne"],
  [/moonrock/i, "SS Moonrock"],
  [/honey\s*com[b]?/i, "SS Honeycomb"],
  [/golden|\bgold\b/i, "SS Golden"],
  [/copper/i, "SS Copper"],
  [/bronze/i, "SS Bronze"],
];
function deriveFinishFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const grade = /\bSS\s*-?\s*(304|316|430|441|202)\b/i.exec(name);
  if (grade) return `SS ${grade[1]}`;
  for (const [re, label] of DESIGNER_FINISHES) if (re.test(name)) return label;
  if (/\bMS\b/.test(name)) return "MS";
  if (/\bGI\b/.test(name)) return "GI";
  if (/\bSS\b/i.test(name)) return "SS";
  return null;
}

export function WeeklyMrpClient({ plan, scopeOptions }: { plan: WeeklyMrpPlan; scopeOptions?: JobScopeOption[] }) {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(
    () => readParam(sp, "tab", "programs", ["programs", "make", "capacity"]) as Tab,
  );
  const [thickFilter, setThickFilter] = useState<string>(() => readParam(sp, "thick", "all"));
  const [cumulative, setCumulative] = useState(() => readParam(sp, "cumul", "1") !== "0");
  const [cat, setCat] = useState(() => readParam(sp, "cat", "all"));
  const [finish, setFinish] = useState(() => readParam(sp, "fin", "all"));
  useUrlListSync(
    { tab, thick: thickFilter, cumul: cumulative ? "1" : "0", cat, fin: finish },
    { tab: "programs", thick: "all", cumul: "1", cat: "all", fin: "all" },
  );

  const weeks = plan.weeks;

  const thicknesses = useMemo(
    () => [...new Set(plan.programs.flatMap((p) => p.inputs.map((i) => i.thicknessMm)).filter((t): t is number => t != null))].sort((a, b) => a - b),
    [plan.programs],
  );

  // Finish options for the active lane: programs use material_label; make items
  // derive it from the name. Sorted, with the plain grades first.
  const finishOptions = useMemo(() => {
    const set = new Set<string>();
    if (tab === "programs") for (const p of plan.programs) { const f = normalizeFinish(p.materialLabel); if (f) set.add(f); }
    else if (tab === "make") for (const m of plan.make) { const f = deriveFinishFromName(m.name); if (f) set.add(f); }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [plan.programs, plan.make, tab]);
  // Reset a finish focus that doesn't exist in the lane we switched to.
  const effectiveFinish = finish !== ALL && finishOptions.includes(finish) ? finish : ALL;

  // ── Programs lane ──────────────────────────────────────────────────────────
  const programsFiltered = useMemo(
    () =>
      plan.programs.filter((r) => {
        if (thickFilter !== "all" && !r.inputs.some((inp) => String(inp.thicknessMm) === thickFilter)) return false;
        if (effectiveFinish !== ALL && normalizeFinish(r.materialLabel) !== effectiveFinish) return false;
        return true;
      }),
    [plan.programs, thickFilter, effectiveFinish],
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
      plan.make
        .filter((r) => effectiveFinish === ALL || deriveFinishFromName(r.name) === effectiveFinish)
        .map((r) => ({
          id: r.item_id,
          code: r.code,
          name: r.name,
          category: r.topCategory || "Uncategorised",
          perWeek: r.perWeek,
          cumulative: r.cumulative,
          sub: r.uom ?? undefined,
        })),
    [plan.make, effectiveFinish],
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
      {scopeOptions && <JobScopePicker options={scopeOptions} />}

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
              {finishOptions.length > 0 && (
                <Select size="sm" value={effectiveFinish} onChange={(e) => setFinish(e.target.value)} className="w-[180px]">
                  <option value={ALL}>All finishes</option>
                  {finishOptions.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </Select>
              )}
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
