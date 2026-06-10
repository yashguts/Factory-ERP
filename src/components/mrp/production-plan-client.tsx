"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Factory, Layers, ShoppingCart, AlertTriangle, Clock } from "lucide-react";
import { MrpToolbar } from "@/components/mrp/mrp-toolbar";
import { PlanFilters, planMatches, EMPTY_PLAN_FILTER, type PlanFilterValue } from "@/components/mrp/plan-filters";
import { formatDuration } from "@/lib/utils";
import type { ProductionPlan, PlanLeaf, ProgramRunPlan } from "@/lib/actions/mrp";

export function ProductionPlanClient({ plan }: { plan: ProductionPlan }) {
  const [filter, setFilter] = useState<PlanFilterValue>(EMPTY_PLAN_FILTER);
  const filterRows = [...plan.rawMaterials, ...plan.purchased].map((r) => ({ type: r.type, category: r.category, subCategory: r.subCategory }));
  const rawMaterials = plan.rawMaterials.filter((r) => planMatches(r, filter));
  const purchased = plan.purchased.filter((r) => planMatches(r, filter));
  const rawShortfall = rawMaterials.filter((r) => r.shortfall > 0).length;
  const totalMachineSeconds = plan.programRuns.reduce(
    (s, r) => s + (r.machine_seconds ?? 0),
    0,
  );

  return (
    <div>
      <MrpToolbar view="buy" date={plan.cutoffDate ?? ""} />
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Factory className="h-6 w-6 text-[var(--muted-foreground)]" />
          Raw Material Plan
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Job demand exploded through programs &amp; parts lists down to the
          steel and bought parts to buy
        </p>
      </div>

      {/* Estimate caveat */}
      <div className="flex items-start gap-2 mb-4 px-4 py-3 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          <strong>Estimate.</strong> Sheet demand is rolled up per program at
          whole runs (nesting/yield not optimised), so it is conservative —
          validate against a real job before ordering. Make items still missing
          a program or parts list are listed under Cannot explode.
        </span>
      </div>


      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="Raw materials" value={rawMaterials.length} sub={`${rawShortfall} short`} />
        <SummaryCard label="Purchased parts" value={purchased.length} />
        <SummaryCard
          label="Programs to run"
          value={plan.programRuns.length}
          sub={totalMachineSeconds > 0 ? `${formatDuration(totalMachineSeconds)} machine time` : undefined}
        />
        <SummaryCard label="Can't explode" value={plan.unresolved.length} tone={plan.unresolved.length > 0 ? "warn" : undefined} />
      </div>

      <PlanFilters rows={filterRows} value={filter} onChange={setFilter} />

      <LeafTable
        title="Raw materials to buy"
        subtitle="sheets & materials consumed by the programs"
        icon={<Layers className="h-4 w-4" />}
        rows={rawMaterials}
        empty="No raw-material demand — make items may be missing their program link."
      />

      <div className="mt-6">
        <LeafTable
          title="Purchased parts to buy"
          subtitle="trade items (operators, fixings, …)"
          icon={<ShoppingCart className="h-4 w-4" />}
          rows={purchased}
          empty="No purchased-part demand."
        />
      </div>

      <div className="mt-6">
        <ProgramRunsSection runs={plan.programRuns} />
      </div>

      {plan.unresolved.length > 0 && (
        <div className="mt-6 card-surface overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--warning-bg)]/40">
            <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
            <h2 className="text-sm font-semibold">Can&apos;t explode yet</h2>
            <span className="text-xs text-[var(--muted-foreground)]">
              · make items with no program and no parts list
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right w-[120px]">Required</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.unresolved.map((u) => (
                <TableRow key={u.item_id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/inventory/${u.item_id}`} className="text-[var(--primary)] hover:underline">
                      {u.code}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{u.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.qty.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * Program runs with machine time. Rows are selectable so planners can total
 * the machine time of an arbitrary subset (one machine's queue, one family,
 * …); the per-sheet rollup recomputes from the selection.
 */
function ProgramRunsSection({ runs }: { runs: ProgramRunPlan[] }) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(runs.map((r) => r.program_id)),
  );
  const allSelected = selected.size === runs.length;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(runs.map((r) => r.program_id)));

  const sel = runs.filter((r) => selected.has(r.program_id));
  const totalSeconds = sel.reduce((s, r) => s + (r.machine_seconds ?? 0), 0);
  const totalRuns = sel.reduce((s, r) => s + r.runs, 0);
  const missingTime = sel.filter((r) => r.machine_seconds == null).length;

  // Machine time rolled up per input sheet spec (over the selection).
  const bySheet = useMemo(() => {
    const m = new Map<
      string,
      { code: string; name: string; programs: number; runs: number; seconds: number }
    >();
    for (const r of sel) {
      const key = r.sheet_code ?? "(no sheet)";
      const e =
        m.get(key) ??
        { code: key, name: r.sheet_name ?? "(no input sheet)", programs: 0, runs: 0, seconds: 0 };
      e.programs += 1;
      e.runs += r.runs;
      e.seconds += r.machine_seconds ?? 0;
      m.set(key, e);
    }
    return Array.from(m.values()).sort((a, b) => b.seconds - a.seconds);
  }, [sel]);

  if (runs.length === 0) return null;

  return (
    <div className="card-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--muted)]/40">
        <Clock className="h-4 w-4" />
        <h2 className="text-sm font-semibold">Program runs &amp; machine time</h2>
        <span className="text-xs text-[var(--muted-foreground)]">
          · tick programs to total a subset
        </span>
        <span className="ml-auto text-xs tabular-nums">
          <span className="text-[var(--muted-foreground)]">
            {sel.length}/{runs.length} selected · {totalRuns.toLocaleString()} runs ·{" "}
          </span>
          <span className="font-bold">{formatDuration(totalSeconds)}</span>
          <span className="text-[var(--muted-foreground)]"> machine time</span>
        </span>
      </div>
      {missingTime > 0 && (
        <p className="px-4 py-2 text-[11px] text-[var(--warning)] bg-[var(--warning-bg)]/40 border-b border-[var(--border)]">
          {missingTime} selected program{missingTime === 1 ? "" : "s"} have no
          machining time captured — they count 0 in the totals. Add it on the
          program (Edit → Machining time / run).
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all programs"
              />
            </TableHead>
            <TableHead className="w-[220px]">Code</TableHead>
            <TableHead>Program</TableHead>
            <TableHead className="w-[200px]">Input sheet</TableHead>
            <TableHead className="text-right w-[80px]">Runs</TableHead>
            <TableHead className="text-right w-[110px]">Time / run</TableHead>
            <TableHead className="text-right w-[120px]">Machine time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => (
            <TableRow key={r.program_id}>
              <TableCell className="text-center">
                <input
                  type="checkbox"
                  checked={selected.has(r.program_id)}
                  onChange={() => toggle(r.program_id)}
                  aria-label={`Select ${r.code ?? r.name}`}
                />
              </TableCell>
              <TableCell className="font-mono text-xs">
                <Link
                  href={`/programs/${r.program_id}`}
                  className="text-[var(--primary)] hover:underline"
                >
                  {r.code ?? "—"}
                </Link>
              </TableCell>
              <TableCell className="text-sm">{r.name}</TableCell>
              <TableCell className="font-mono text-xs text-[var(--muted-foreground)]" title={r.sheet_name ?? undefined}>
                {r.sheet_code ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.runs.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">
                {r.machining_time_seconds != null ? formatDuration(r.machining_time_seconds) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                {r.machine_seconds != null ? formatDuration(r.machine_seconds) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {bySheet.length > 0 && (
        <div className="border-t border-[var(--border)]">
          <div className="flex items-center gap-2 px-4 py-2 bg-[var(--muted)]/40">
            <Layers className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <h3 className="text-xs font-semibold">
              Machine time by input sheet (selected programs)
            </h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Sheet</TableHead>
                <TableHead>Specification</TableHead>
                <TableHead className="text-right w-[100px]">Programs</TableHead>
                <TableHead className="text-right w-[80px]">Runs</TableHead>
                <TableHead className="text-right w-[130px]">Machine time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bySheet.map((s) => (
                <TableRow key={s.code}>
                  <TableCell className="font-mono text-xs">{s.code}</TableCell>
                  <TableCell className="text-sm">{s.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.programs}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.runs.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatDuration(s.seconds)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "warn";
}) {
  return (
    <div className="card-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-1">
        {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${tone === "warn" ? "text-[var(--warning)]" : ""}`}>
        {value.toLocaleString()}
      </p>
      {sub && <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{sub}</p>}
    </div>
  );
}

function LeafTable({
  title,
  subtitle,
  icon,
  rows,
  empty,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: PlanLeaf[];
  empty: string;
}) {
  return (
    <div className="card-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--muted)]/40">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-[var(--muted-foreground)]">· {subtitle}</span>
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">
          {rows.length} {rows.length === 1 ? "item" : "items"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-xs text-[var(--muted-foreground)] text-center">{empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[150px]">Code</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right w-[110px]">Required</TableHead>
              <TableHead className="text-right w-[110px]">In stock</TableHead>
              <TableHead className="text-right w-[120px]">To buy</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.item_id}>
                <TableCell className="font-mono text-xs">
                  <Link href={`/inventory/${r.item_id}`} className="text-[var(--primary)] hover:underline">
                    {r.code}
                  </Link>
                </TableCell>
                <TableCell className="font-medium text-sm">{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.qty.toLocaleString()}{" "}
                  <span className="text-xs text-[var(--muted-foreground)]">{r.uom}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-[var(--muted-foreground)]">
                  {r.in_stock.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums font-bold">
                  {r.shortfall > 0 ? (
                    <span className="text-[var(--destructive)]">{r.shortfall.toLocaleString()}</span>
                  ) : (
                    <Badge variant="success">covered</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
