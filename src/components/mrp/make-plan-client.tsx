"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hammer, AlertTriangle, Ban, ChevronRight, Layers, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { PlanFilters, planMatches, EMPTY_PLAN_FILTER, type PlanFilterValue } from "@/components/mrp/plan-filters";
import { formatDuration } from "@/lib/utils";
import type { MakeProductionPlan, PlanProgram } from "@/lib/actions/production-plan";

const MACHINE: Record<string, string> = {
  cnc_punch: "Punch",
  cnc_laser: "Laser",
  cnc_cutting: "Cutting",
  assembly_fit: "Assembly",
};

export function MakePlanClient({ plan }: { plan: MakeProductionPlan }) {
  const t = plan.totals;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<PlanFilterValue>(EMPTY_PLAN_FILTER);
  // "Search by sheet": narrow the plan to programs that consume a chosen raw sheet.
  const [sheetFilter, setSheetFilter] = useState<string>("all");

  // "Don't run this": exclusions live in the URL (?exclude=...) so the SERVER
  // recomputes the whole plan without those programs — other programs pick up
  // the parts they covered, or the item moves to "blocked".
  const excluded = plan.excluded ?? [];
  const goWithExclusions = (excl: string[]) => {
    const params = new URLSearchParams();
    if (plan.cutoffDate) params.set("date", plan.cutoffDate);
    if (excl.length) params.set("exclude", excl.join(","));
    const qs = params.toString();
    startTransition(() => router.push(`/mrp/make-plan${qs ? `?${qs}` : ""}`));
  };
  const excludeProgram = (code: string) => goWithExclusions([...excluded, code]);
  const restoreProgram = (code: string) => goWithExclusions(excluded.filter((c) => c !== code));
  // Filter options come from both the produced part AND every finished item it feeds, so a
  // program that only cuts a shared sub-part stays findable under that part's assembly.
  const filterRows = [
    ...plan.plan.flatMap((p) =>
      p.covers.flatMap((c) => [
        { type: c.type, category: c.category, subCategory: c.subCategory },
        ...c.feeds.map((f) => ({ type: f.type, category: f.category, subCategory: f.subCategory })),
      ]),
    ),
    ...plan.blocked.map((b) => ({ type: b.type, category: b.category, subCategory: b.subCategory })),
  ];
  // A program shows if any of its outputs match, OR any finished item those outputs feed matches.
  const coverMatches = (c: MakeProductionPlan["plan"][number]["covers"][number]) =>
    planMatches(c, filter) || c.feeds.some((f) => planMatches(f, filter));
  // Distinct raw sheets used anywhere in the plan, for the "Search by sheet"
  // dropdown — sorted by thickness then code (same order as the summary).
  const sheetOptions = (() => {
    const m = new Map<string, { code: string; name: string; thicknessMm: number | null }>();
    for (const p of plan.plan)
      for (const i of p.inputs ?? [])
        if (!m.has(i.code)) m.set(i.code, { code: i.code, name: i.name, thicknessMm: i.thicknessMm });
    return [...m.values()].sort(
      (a, b) => (a.thicknessMm ?? 99) - (b.thicknessMm ?? 99) || a.code.localeCompare(b.code),
    );
  })();
  const sheetMatches = (p: PlanProgram) =>
    sheetFilter === "all" || (p.inputs ?? []).some((i) => i.code === sheetFilter);

  const shownPrograms = plan.plan.filter((p) => p.covers.some(coverMatches) && sheetMatches(p));
  // The sheet filter is program-scoped (it has no meaning for blocked items),
  // so blocked rows only follow the type/category/sub filter.
  const shownBlocked = plan.blocked.filter((b) => planMatches(b, filter));

  // Group programs by the category of their main produced part (covers are
  // qty-sorted, so [0] is the dominant one). Sections A→Z; within a section
  // the server's most-runs-first order is kept.
  const sections: { category: string; programs: PlanProgram[] }[] = [];
  {
    const byCat = new Map<string, PlanProgram[]>();
    for (const p of shownPrograms) {
      const cat = p.covers[0]?.category ?? "(none)";
      const arr = byCat.get(cat) ?? [];
      arr.push(p);
      byCat.set(cat, arr);
    }
    for (const [category, programs] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0])))
      sections.push({ category, programs });
  }

  // "Which thickness sheet is to be cut how much" — totals across the SHOWN
  // programs (so the summary follows the filters). Aggregated per sheet item.
  const sheetTotals: { code: string; name: string; thicknessMm: number | null; total: number }[] = [];
  {
    const agg = new Map<string, { name: string; thicknessMm: number | null; total: number }>();
    for (const p of shownPrograms)
      for (const i of p.inputs ?? []) {
        const cur = agg.get(i.code) ?? { name: i.name, thicknessMm: i.thicknessMm, total: 0 };
        cur.total += i.total;
        agg.set(i.code, cur);
      }
    for (const [code, v] of agg) sheetTotals.push({ code, ...v });
    sheetTotals.sort((a, b) => (a.thicknessMm ?? 99) - (b.thicknessMm ?? 99) || b.total - a.total);
  }

  return (
    <div>
      <MrpToolbar view="programs" date={plan.cutoffDate ?? ""} />
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Hammer className="h-6 w-6 text-[var(--muted-foreground)]" />
          Programs to Run
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Fewest audited-program runs to clear the Make shortfall — assemblies
          exploded to their cut parts, chosen to make the least excess (&quot;other
          parts&quot;)
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-3 mb-6">
        <Card label="Shortfall items" value={t.shortfallItems} />
        <Card label="Makeable now" value={t.makeable} tone="ok" />
        <Card label="Blocked" value={t.blocked} tone={t.blocked ? "warn" : undefined} />
        <Card label="Programs to run" value={t.programs} />
        <Card label="Total runs" value={t.runs} />
        <Card
          label="Machine time"
          value={formatDuration(t.machineSeconds ?? 0)}
          sub={
            (t.programsMissingTime ?? 0) > 0
              ? `${t.programsMissingTime} program${t.programsMissingTime === 1 ? "" : "s"} missing time`
              : "runs x time/run"
          }
          tone={(t.programsMissingTime ?? 0) > 0 ? "warn" : "ok"}
        />
        <Card
          label="Sheets to cut"
          value={t.sheets ?? 0}
          sub={
            (t.sheetsSimple ?? 0) > (t.sheets ?? 0)
              ? `saves ${(t.sheetsSimple - t.sheets).toLocaleString()} vs simple pick`
              : undefined
          }
          tone={(t.sheetsSimple ?? 0) > (t.sheets ?? 0) ? "ok" : undefined}
        />
        <Card
          label="Steel scrap"
          value={
            (t.materialKg ?? 0) > 0
              ? `${(((t.scrapKg ?? 0) / t.materialKg) * 100).toFixed(1)}%`
              : "—"
          }
          sub={
            (t.materialKg ?? 0) > 0
              ? `${Math.round(t.scrapKg ?? 0).toLocaleString()} kg of ${Math.round(t.materialKg ?? 0).toLocaleString()} kg loaded${
                  (t.programsMissingScrap ?? 0) > 0 ? ` · ${t.programsMissingScrap} w/o data` : ""
                }`
              : "no scrap data on these programs"
          }
          tone={(t.materialKg ?? 0) > 0 && (t.scrapKg ?? 0) / t.materialKg > 0.12 ? "warn" : undefined}
        />
        <Card label="Other parts" value={t.otherParts} sub={`${t.partsMade} made / ${t.partsNeeded} needed`} tone={t.otherParts ? "warn" : undefined} />
      </div>

      <PlanFilters rows={filterRows} value={filter} onChange={setFilter} />

      {/* Search by sheet — narrows the plan to programs that cut a chosen raw sheet. */}
      {sheetOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 -mt-1">
          <span className="text-xs text-[var(--muted-foreground)] inline-flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" /> Search by sheet
          </span>
          <Select
            value={sheetFilter}
            onChange={(e) => setSheetFilter(e.target.value)}
            className="w-auto min-w-[280px]"
          >
            <option value="all">All sheets ({sheetOptions.length})</option>
            {sheetOptions.map((s) => (
              <option key={s.code} value={s.code}>
                {s.thicknessMm != null ? `${s.thicknessMm} mm · ` : ""}{s.code} · {s.name}
              </option>
            ))}
          </Select>
          {sheetFilter !== "all" && (
            <>
              <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
                {shownPrograms.length} program{shownPrograms.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => setSheetFilter("all")}
                className="text-xs text-[var(--primary)] hover:underline cursor-pointer"
              >
                Clear sheet
              </button>
            </>
          )}
        </div>
      )}

      {/* Excluded programs — restore individually or all at once */}
      {excluded.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4 px-4 py-2.5 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] text-xs">
          <Ban className="h-4 w-4 shrink-0 text-[var(--warning)]" />
          <span className="font-medium">
            Plan recalculated without {excluded.length} program{excluded.length === 1 ? "" : "s"}:
          </span>
          {excluded.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => restoreProgram(code)}
              title="Bring this program back into the plan"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--border)] bg-[var(--card)] font-mono cursor-pointer hover:bg-[var(--muted)]"
            >
              {code} <X className="h-3 w-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => goWithExclusions([])}
            className="ml-auto font-medium text-[var(--primary)] hover:underline cursor-pointer"
          >
            Restore all
          </button>
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>
      )}

      {/* Sheets summary — which thickness, how many, across the shown programs */}
      {sheetTotals.length > 0 && (
        <div className="card-surface p-4 mb-6">
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
            <Layers className="h-4 w-4" /> Sheets to cut
          </h2>
          <p className="text-[11px] text-[var(--muted-foreground)] mb-2">
            Total raw sheets the programs below will consume
            {filter.type !== "all" || filter.category !== "all" || filter.sub !== "all"
              ? " (follows the active filter)"
              : ""}{" "}
            — whole runs, so treat as the upper estimate.
          </p>
          <div className="divide-y divide-[var(--border)]">
            {sheetTotals.map((s) => (
              <div key={s.code} className="flex items-center gap-3 py-1.5 text-xs">
                <Badge variant="amber" className="shrink-0 w-16 justify-center tabular-nums">
                  {s.thicknessMm != null ? `${s.thicknessMm} mm` : "? mm"}
                </Badge>
                <span className="font-mono text-[var(--muted-foreground)] shrink-0">{s.code}</span>
                <span className="truncate flex-1">{s.name}</span>
                <span className="tabular-nums font-semibold shrink-0">
                  {s.total.toLocaleString()} sheet{s.total === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The plan, grouped by the category of what each program makes */}
      <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Hammer className="h-4 w-4" /> Run these audited programs
      </h2>
      {shownPrograms.length === 0 ? (
        <div className="card-surface p-6 text-center text-sm text-[var(--muted-foreground)] mb-6">
          {plan.plan.length === 0 ? "No audited programs can make any of the current shortfall." : "No programs match the filter."}
        </div>
      ) : (
        <div className="mb-8">
          {sections.map((sec) => (
            <div key={sec.category} className="mb-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5 flex items-center gap-2">
                {sec.category}
                <span className="font-normal normal-case">· {sec.programs.length} program{sec.programs.length === 1 ? "" : "s"}</span>
              </h3>
              <div className="space-y-2">
                {sec.programs.map((p) => (
            <div key={p.code} className="card-surface p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="neutral" className="font-mono text-[11px]">{MACHINE[p.machine] ?? p.machine}</Badge>
                <span className="font-mono text-xs text-[var(--muted-foreground)]">{p.code}</span>
                <span className="text-sm font-medium flex-1 min-w-[120px]">{p.name}</span>
                <Badge variant="blue" className="shrink-0">Run ×{p.runs}</Badge>
                <span
                  className="text-[11px] shrink-0 tabular-nums font-medium"
                  title={
                    p.machiningTimeSeconds != null
                      ? `${formatDuration(p.machiningTimeSeconds)} per run × ${p.runs} runs`
                      : "No machining time captured on this program (Edit → Machining time / run)"
                  }
                >
                  {p.machineSeconds != null ? formatDuration(p.machineSeconds) : "— time"}
                </span>
                <span
                  className={`text-[11px] shrink-0 tabular-nums font-medium ${
                    p.scrapPercent == null
                      ? "text-[var(--muted-foreground)]"
                      : p.scrapPercent > 15
                        ? "text-red-600"
                        : p.scrapPercent > 8
                          ? "text-amber-600"
                          : "text-emerald-600"
                  }`}
                  title={
                    p.scrapPercent != null
                      ? `Sheet scrap from the machine report: ${p.scrapPercent}% — ${p.scrapKg ?? "?"} kg wasted of ${p.materialKg ?? "?"} kg loaded across ${p.runs} run${p.runs === 1 ? "" : "s"}. A redesigned nest lowers this.`
                      : "No scrap data captured from this program's sketch PDF"
                  }
                >
                  {p.scrapPercent != null ? `${p.scrapPercent}% scrap` : "— scrap"}
                </span>
                <span className="text-[11px] text-[var(--muted-foreground)] shrink-0 tabular-nums">
                  {p.partsMade} parts{p.extra > 0 ? ` · ${p.extra} extra` : " · no waste"}
                </span>
                <button
                  type="button"
                  onClick={() => excludeProgram(p.code)}
                  disabled={isPending}
                  title="Don't run this program — the plan recalculates without it (other programs cover its parts, or they show as blocked)"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"
                >
                  <Ban className="h-3 w-3" /> Don&rsquo;t run
                </button>
              </div>
              {(p.inputs ?? []).length > 0 && (
                <div className="mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-[var(--muted-foreground)]">
                  <Layers className="h-3 w-3 shrink-0" />
                  {p.inputs.map((i) => (
                    <span key={i.code} className="inline-flex items-center gap-1.5">
                      {i.thicknessMm != null && (
                        <Badge variant="amber" className="tabular-nums">{i.thicknessMm} mm</Badge>
                      )}
                      <span className="truncate max-w-[340px]">{i.name}</span>
                      <span className="tabular-nums font-semibold text-[var(--foreground)]">
                        × {i.total.toLocaleString()} sheet{i.total === 1 ? "" : "s"}
                      </span>
                      {i.perRun !== 1 && <span>({i.perRun}/run)</span>}
                    </span>
                  ))}
                </div>
              )}
              {/* EVERY part this program's runs produce: how many made, and how
                  many of those the requirement actually counts. "not needed"
                  rows are the waste to judge a program by. */}
              <div className="mt-2 pl-1 space-y-1.5">
                {(p.outputs ?? []).map((o) => {
                  const cover = p.covers.find((c) => c.code === o.code);
                  const unneeded = o.used === 0;
                  return (
                    <div key={o.code} className="text-xs">
                      <div className="flex items-center gap-2">
                        <ChevronRight className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
                        <span className="font-mono text-[var(--muted-foreground)]">{o.code}</span>
                        <span className={`truncate flex-1 ${unneeded ? "text-[var(--muted-foreground)]" : ""}`}>{o.name}</span>
                        {cover?.direct ? (
                          <Badge variant="neutral" className="shrink-0">finished item</Badge>
                        ) : unneeded ? (
                          <Badge variant="amber" className="shrink-0">not needed</Badge>
                        ) : (
                          <span className="italic text-[var(--muted-foreground)] shrink-0">sub-part</span>
                        )}
                        <span className="tabular-nums shrink-0">
                          <span className="text-[var(--muted-foreground)]">makes ×{o.produced} · </span>
                          <span className={unneeded ? "text-amber-600 font-medium" : "text-emerald-700 font-medium"}>
                            {o.used} counted
                          </span>
                        </span>
                      </div>
                      {cover && cover.feeds.length > 0 && (
                        <div className="pl-6 mt-0.5 text-[11px] text-[var(--muted-foreground)] leading-snug">
                          ↳ goes into{" "}
                          {cover.feeds.slice(0, 6).map((f, i) => (
                            <span key={f.code}>
                              {i > 0 && ", "}
                              {f.name} <span className="tabular-nums">(need {f.need})</span>
                            </span>
                          ))}
                          {cover.feeds.length > 6 && ` +${cover.feeds.length - 6} more`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Blocked */}
      {shownBlocked.length > 0 && (
        <>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Ban className="h-4 w-4 text-[var(--warning)]" /> Still blocked ({shownBlocked.length}) — a required part has no audited program
          </h2>
          <div className="flex items-start gap-2 mb-3 px-4 py-2.5 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Items whose parts need a program <strong>audited</strong> (shown) or <strong>created</strong> (no program). Audit those to unlock them, then re-run.</span>
          </div>
          <div className="card-surface divide-y divide-[var(--border)]">
            {shownBlocked.map((b) => (
              <div key={b.code} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span className="font-mono text-[var(--muted-foreground)] w-28 shrink-0">{b.code}</span>
                <span className="truncate flex-1">{b.name}</span>
                <span className="italic text-[var(--muted-foreground)] shrink-0">{b.subCategory}</span>
                <span className="tabular-nums shrink-0 w-16 text-right">need {b.need}</span>
                <span className="shrink-0 w-[42%] text-right text-[var(--muted-foreground)] truncate">
                  {b.missing.map((m) => m.auditProgram ? `audit ${m.auditProgram}` : `${m.code}: no program`).join(", ")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-[var(--foreground)]";
  return (
    <div className="card-surface p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{typeof value === "number" ? value.toLocaleString() : value}</div>
      {sub && <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{sub}</div>}
    </div>
  );
}
