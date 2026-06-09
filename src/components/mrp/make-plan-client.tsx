"use client";

import { useState } from "react";
import { Hammer, AlertTriangle, Ban, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { PlanFilters, planMatches, EMPTY_PLAN_FILTER, type PlanFilterValue } from "@/components/mrp/plan-filters";
import type { MakeProductionPlan } from "@/lib/actions/production-plan";

const MACHINE: Record<string, string> = {
  cnc_punch: "Punch",
  cnc_laser: "Laser",
  cnc_cutting: "Cutting",
  assembly_fit: "Assembly",
};

export function MakePlanClient({ plan }: { plan: MakeProductionPlan }) {
  const t = plan.totals;
  const [filter, setFilter] = useState<PlanFilterValue>(EMPTY_PLAN_FILTER);
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
  const shownPrograms = plan.plan.filter((p) => p.covers.some(coverMatches));
  const shownBlocked = plan.blocked.filter((b) => planMatches(b, filter));

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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Card label="Shortfall items" value={t.shortfallItems} />
        <Card label="Makeable now" value={t.makeable} tone="ok" />
        <Card label="Blocked" value={t.blocked} tone={t.blocked ? "warn" : undefined} />
        <Card label="Programs to run" value={t.programs} />
        <Card label="Total runs" value={t.runs} />
        <Card label="Other parts" value={t.otherParts} sub={`${t.partsMade} made / ${t.partsNeeded} needed`} tone={t.otherParts ? "warn" : undefined} />
      </div>

      <PlanFilters rows={filterRows} value={filter} onChange={setFilter} />

      {/* The plan */}
      <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Hammer className="h-4 w-4" /> Run these audited programs
      </h2>
      {shownPrograms.length === 0 ? (
        <div className="card-surface p-6 text-center text-sm text-[var(--muted-foreground)] mb-6">
          {plan.plan.length === 0 ? "No audited programs can make any of the current shortfall." : "No programs match the filter."}
        </div>
      ) : (
        <div className="space-y-2 mb-8">
          {shownPrograms.map((p) => (
            <div key={p.code} className="card-surface p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="neutral" className="font-mono text-[11px]">{MACHINE[p.machine] ?? p.machine}</Badge>
                <span className="font-mono text-xs text-[var(--muted-foreground)]">{p.code}</span>
                <span className="text-sm font-medium flex-1 min-w-[120px]">{p.name}</span>
                <Badge variant="blue" className="shrink-0">Run ×{p.runs}</Badge>
                <span className="text-[11px] text-[var(--muted-foreground)] shrink-0 tabular-nums">
                  {p.partsMade} parts{p.extra > 0 ? ` · ${p.extra} extra` : " · no waste"}
                </span>
              </div>
              <div className="mt-2 pl-1 space-y-1.5">
                {p.covers.map((c) => (
                  <div key={c.code} className="text-xs">
                    <div className="flex items-center gap-2">
                      <ChevronRight className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
                      <span className="font-mono text-[var(--muted-foreground)]">{c.code}</span>
                      <span className="truncate flex-1">{c.name}</span>
                      {c.direct ? (
                        <Badge variant="neutral" className="shrink-0">finished item</Badge>
                      ) : (
                        <span className="italic text-[var(--muted-foreground)] shrink-0">sub-part</span>
                      )}
                      <span className="tabular-nums shrink-0 text-[var(--muted-foreground)]">makes ×{c.qty}</span>
                    </div>
                    {c.feeds.length > 0 && (
                      <div className="pl-6 mt-0.5 text-[11px] text-[var(--muted-foreground)] leading-snug">
                        ↳ goes into{" "}
                        {c.feeds.slice(0, 6).map((f, i) => (
                          <span key={f.code}>
                            {i > 0 && ", "}
                            {f.name} <span className="tabular-nums">(need {f.need})</span>
                          </span>
                        ))}
                        {c.feeds.length > 6 && ` +${c.feeds.length - 6} more`}
                      </div>
                    )}
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

function Card({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-[var(--foreground)]";
  return (
    <div className="card-surface p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value.toLocaleString()}</div>
      {sub && <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{sub}</div>}
    </div>
  );
}
