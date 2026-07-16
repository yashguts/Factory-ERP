"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, AlertTriangle, Ban, ChevronRight, Layers, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardBody, SectionHeader } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { CabinScopePicker } from "@/components/mrp/cabin-scope-picker";
import { formatDuration } from "@/lib/utils";
import type { CabinMrpPlan, CabinPlanProgram } from "@/lib/actions/cabin-program-plan";
import type { CabinScopeData } from "@/lib/actions/job-sets";

const MACHINE: Record<string, string> = { cnc_punch: "Punch", cnc_laser: "Laser", assembly_fit: "Assembly" };

export function CabinMrpClient({
  plan,
  scope,
}: {
  plan: CabinMrpPlan;
  scope: CabinScopeData;
}) {
  const t = plan.totals;
  const router = useRouter();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [catFilter, setCatFilter] = useState("all");
  const [finishFilter, setFinishFilter] = useState("all");

  const excluded = plan.excluded ?? [];
  const goWithExclusions = (excl: string[]) => {
    const params = new URLSearchParams();
    if (excl.length) params.set("exclude", excl.join(","));
    // Keep the job-scope selection (?jobs= or saved ?set=) when toggling exclusions.
    const jobsScope = sp.get("jobs");
    if (jobsScope) params.set("jobs", jobsScope);
    const setScope = sp.get("set");
    if (setScope) params.set("set", setScope);
    const qs = params.toString();
    startTransition(() => router.push(`/mrp/cabin/programs${qs ? `?${qs}` : ""}`));
  };
  const excludeProgram = (key: string) => goWithExclusions([...excluded, key]);
  const restoreProgram = (key: string) => goWithExclusions(excluded.filter((c) => c !== key));

  const categories = useMemo(() => [...new Set(plan.plan.map((p) => p.category))].sort(), [plan.plan]);
  const finishes = useMemo(() => [...new Set(plan.plan.map((p) => p.finish))].sort(), [plan.plan]);

  const shown = plan.plan.filter(
    (p) => (catFilter === "all" || p.category === catFilter) && (finishFilter === "all" || p.finish === finishFilter),
  );

  // Group by program category (Cabin / Platform / Canopy).
  const sections = useMemo(() => {
    const byCat = new Map<string, CabinPlanProgram[]>();
    for (const p of shown) {
      const arr = byCat.get(p.category) ?? [];
      arr.push(p);
      byCat.set(p.category, arr);
    }
    return [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  // Sheets to cut across the shown programs, per thickness/finish.
  const sheetTotals = useMemo(() => {
    const agg = new Map<string, { name: string; finish: string; thicknessMm: number | null; total: number }>();
    for (const p of shown)
      for (const i of p.inputs) {
        const cur = agg.get(i.code) ?? { name: i.name, finish: p.finish, thicknessMm: i.thicknessMm, total: 0 };
        cur.total += i.total;
        agg.set(i.code, cur);
      }
    return [...agg.entries()]
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => (a.thicknessMm ?? 99) - (b.thicknessMm ?? 99) || b.total - a.total);
  }, [shown]);

  return (
    <div>
      <MrpToolbar view="programs" date="" section="cabin" />
      <CabinScopePicker scope={scope} />
      <PageHeader
        icon={<LayoutGrid size={18} />}
        title="Cabin MRP — programs to cut"
        subtitle="Fewest program runs to clear the cabin-job shortfall — drawn from every audited program and planned with the same optimiser as Make MRP."
      />

      {/* Summary */}
      <StatStrip className="mb-4">
        <StatTile label="Demanded items" value={t.demandedItems.toLocaleString()} />
        <StatTile label="In stock" value={t.inStock.toLocaleString()} tone="ok" />
        <StatTile label="To cut" value={t.toCut.toLocaleString()} />
        <StatTile label="Makeable now" value={t.makeable.toLocaleString()} tone="ok" />
        <StatTile label="Not mapped" value={t.blocked.toLocaleString()} tone={t.blocked ? "warn" : "default"} />
        <StatTile label="Programs to run" value={t.programs.toLocaleString()} />
        <StatTile label="Total runs" value={t.runs.toLocaleString()} />
        <StatTile label="Sheets to cut" value={t.sheets.toLocaleString()} />
        <StatTile label="Machine time" value={t.machineSeconds > 0 ? formatDuration(t.machineSeconds) : "—"} sub={t.machineSeconds > 0 ? "runs × time/run" : "no time set"} tone={t.machineSeconds > 0 ? "ok" : "default"} />
      </StatStrip>

      {plan.totals.auditedPrograms === 0 ? (
        <Card>
          <EmptyState
            icon={<LayoutGrid size={28} />}
            title="No audited program can cut the cabin demand"
            description="No audited program produces any of the currently-demanded cabin items. Audit a program that outputs them (same rule as Make MRP)."
          />
        </Card>
      ) : (
        <>
          {/* Filters */}
          {(categories.length > 1 || finishes.length > 1) && (
            <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
              {categories.length > 1 && (
                <Select size="sm" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="w-auto">
                  <option value="all">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              )}
              {finishes.length > 1 && (
                <Select size="sm" value={finishFilter} onChange={(e) => setFinishFilter(e.target.value)} className="w-auto">
                  <option value="all">All finishes</option>
                  {finishes.map((f) => <option key={f} value={f}>{f}</option>)}
                </Select>
              )}
            </div>
          )}

          {/* Excluded banner */}
          {excluded.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-4 px-4 py-2.5 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] text-xs">
              <Ban className="h-4 w-4 shrink-0 text-[var(--warning)]" />
              <span className="font-medium">Plan recalculated without {excluded.length} run{excluded.length === 1 ? "" : "s"}:</span>
              {excluded.map((key) => (
                <button key={key} type="button" onClick={() => restoreProgram(key)} title="Bring this back into the plan"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--border)] bg-[var(--card)] font-mono cursor-pointer hover:bg-[var(--muted)]">
                  {key.split("::")[1]} <X className="h-3 w-3" />
                </button>
              ))}
              <button type="button" onClick={() => goWithExclusions([])} className="ml-auto font-medium text-[var(--primary)] hover:underline cursor-pointer">Restore all</button>
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </div>
          )}

          {/* Sheets summary */}
          {sheetTotals.length > 0 && (
            <Card className="mb-4">
              <SectionHeader title={<span className="flex items-center gap-2"><Layers className="h-4 w-4" /> Sheets to cut</span>} />
              <CardBody>
                <p className="text-[11px] text-[var(--muted-foreground)] mb-2">Total raw sheets the programs below will consume — whole runs, so treat as the upper estimate.</p>
                <div className="divide-y divide-[var(--border)]">
                  {sheetTotals.map((s) => (
                    <div key={s.code} className="flex items-center gap-3 py-1.5 text-xs">
                      <Badge variant="amber" className="shrink-0 w-16 justify-center tabular-nums">{s.thicknessMm != null ? `${s.thicknessMm} mm` : "? mm"}</Badge>
                      <span className="shrink-0">{s.finish}</span>
                      <span className="font-mono text-[var(--muted-foreground)] shrink-0">{s.code}</span>
                      <span className="truncate flex-1">{s.name}</span>
                      <span className="tabular-nums font-semibold shrink-0">{s.total.toLocaleString()} sheet{s.total === 1 ? "" : "s"}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Programs grouped by category */}
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><LayoutGrid className="h-4 w-4" /> Run these audited cabin programs</h2>
          {shown.length === 0 ? (
            <Card className="mb-4">
              <EmptyState icon={<LayoutGrid size={28} />} title={plan.plan.length === 0 ? "No audited cabin program can cut any of the current shortfall." : "No programs match the filter."} />
            </Card>
          ) : (
            <div className="mb-4">
              {sections.map(([category, programs]) => (
                <div key={category} className="mb-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5 flex items-center gap-2">
                    {category}
                    <span className="font-normal normal-case">· {programs.length} program{programs.length === 1 ? "" : "s"}</span>
                  </h3>
                  <div className="space-y-2">
                    {programs.map((p) => (
                      <div key={p.excludeKey} className="card-surface p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {p.machine && <Badge variant="neutral" className="font-mono text-[11px]">{MACHINE[p.machine] ?? p.machine}</Badge>}
                          <span className="font-mono text-xs text-[var(--muted-foreground)]">{p.code}</span>
                          <Link href={`/programs/${p.program_id}`} className="text-sm font-medium flex-1 min-w-[120px] hover:text-[var(--primary)]">{p.name}</Link>
                          {p.finish && <Badge variant="purple" className="shrink-0">{p.finish}</Badge>}
                          <Badge variant="blue" className="shrink-0">Run ×{p.runs}</Badge>
                          {p.machineSeconds != null && (
                            <span className="text-[11px] shrink-0 tabular-nums font-medium" title={`per run × ${p.runs} runs`}>{formatDuration(p.machineSeconds)}</span>
                          )}
                          <span className="text-[11px] text-[var(--muted-foreground)] shrink-0 tabular-nums">{p.partsMade} parts{p.extra > 0 ? ` · ${p.extra} extra` : " · no waste"}</span>
                          <button type="button" onClick={() => excludeProgram(p.excludeKey)} disabled={isPending}
                            title="Don't run this — the plan recalculates without it"
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-bg)] cursor-pointer shrink-0">
                            <Ban className="h-3 w-3" /> Don&rsquo;t run
                          </button>
                        </div>
                        {p.inputs.length > 0 && (
                          <div className="mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-[var(--muted-foreground)]">
                            <Layers className="h-3 w-3 shrink-0" />
                            {p.inputs.map((i) => (
                              <span key={i.code} className="inline-flex items-center gap-1.5">
                                {i.thicknessMm != null && <Badge variant="amber" className="tabular-nums">{i.thicknessMm} mm</Badge>}
                                <span className="truncate max-w-[340px]">{i.name}</span>
                                <span className="tabular-nums font-semibold text-[var(--foreground)]">× {i.total.toLocaleString()} sheet{i.total === 1 ? "" : "s"}</span>
                                {i.perRun !== 1 && <span>({i.perRun}/run)</span>}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 pl-1 space-y-1.5">
                          {p.outputs.map((o) => {
                            const unneeded = o.used === 0;
                            return (
                              <div key={o.code} className="text-xs flex items-center gap-2">
                                <ChevronRight className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
                                <span className="font-mono text-[var(--muted-foreground)]">{o.code}</span>
                                <span className={`truncate flex-1 ${unneeded ? "text-[var(--muted-foreground)]" : ""}`}>{o.name}</span>
                                {unneeded && <Badge variant="amber" className="shrink-0">not needed</Badge>}
                                <span className="tabular-nums shrink-0">
                                  <span className="text-[var(--muted-foreground)]">makes ×{o.produced} · </span>
                                  <span className={unneeded ? "text-[var(--warning)] font-medium" : "text-[var(--success)] font-medium"}>{o.used} counted</span>
                                </span>
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

        </>
      )}

      {/* Not mapped — OUTSIDE the audited-programs ternary on purpose: when NO
          audited program covers any shortfall item (auditedPrograms === 0), the
          whole shortfall lands here, and hiding it made a scoped plan look
          empty (the RNLIND-0015 lesson). */}
      {plan.blocked.length > 0 && (
        <>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Ban className="h-4 w-4 text-[var(--warning)]" /> Not currently mapped ({plan.blocked.length})
          </h2>
          <div className="flex items-start gap-2 mb-2 px-4 py-2.5 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Short cabin items no audited program can cut — either <strong>no program</strong> produces them, or there&rsquo;s <strong>no sheet</strong> for that finish. Add/audit a program (and a sheet) to unlock them.</span>
          </div>
          <Card>
            <Table density="compact" className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-40">Finish</TableHead>
                  <TableHead className="text-right w-20">Need</TableHead>
                  <TableHead className="w-40">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.blocked.map((b) => (
                  <TableRow key={b.item_id}>
                    <TableCell className="font-mono text-[var(--muted-foreground)] truncate" title={b.code}>{b.code}</TableCell>
                    <TableCell className="font-medium truncate" title={b.name}>{b.name}</TableCell>
                    <TableCell className="italic text-[var(--muted-foreground)] truncate">{b.finish ?? "—"}</TableCell>
                    <TableCell className="tabular-nums text-right whitespace-nowrap">need {b.need}</TableCell>
                    <TableCell>{b.reason === "no-sheet" ? <Badge variant="amber">no sheet for finish</Badge> : <Badge variant="neutral">no program</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
