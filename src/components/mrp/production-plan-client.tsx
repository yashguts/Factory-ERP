"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  CalendarDays,
  Factory,
  Layers,
  ShoppingCart,
  AlertTriangle,
} from "lucide-react";
import type { ProductionPlan, PlanLeaf } from "@/lib/actions/mrp";

export function ProductionPlanClient({ plan }: { plan: ProductionPlan }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cutoff, setCutoff] = useState(plan.cutoffDate ?? "");
  const dateRef = useRef<HTMLInputElement>(null);

  const setDate = (d: string) => {
    setCutoff(d);
    startTransition(() =>
      router.push(`/mrp/plan${d ? `?date=${d}` : ""}`),
    );
  };

  const rawShortfall = plan.rawMaterials.filter((r) => r.shortfall > 0).length;

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <Link
          href="/mrp"
          className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to MRP
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Factory className="h-6 w-6 text-[var(--muted-foreground)]" />
          Raw Material Plan
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Job demand exploded through programs &amp; parts lists down to the
          steel and bought parts to buy
          {isPending ? " — refreshing…" : ""}
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

      {/* Date filter */}
      <div className="flex items-center gap-3 mb-4 p-3 card-surface">
        <CalendarDays size={18} className="text-[var(--muted-foreground)] shrink-0" />
        <span className="text-sm font-medium whitespace-nowrap">
          Requirement Dispatch Date up to:
        </span>
        <input
          ref={dateRef}
          type="date"
          value={cutoff}
          onChange={(e) => setDate(e.target.value)}
          className="flex h-10 w-[200px] rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm cursor-pointer hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)] focus:ring-offset-1 transition-colors [color-scheme:dark]"
        />
        {cutoff ? (
          <Button variant="secondary" size="sm" onClick={() => setDate("")}>
            Clear
          </Button>
        ) : (
          <span className="text-xs text-[var(--muted-foreground)]">
            Showing all jobs
          </span>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="Raw materials" value={plan.rawMaterials.length} sub={`${rawShortfall} short`} />
        <SummaryCard label="Purchased parts" value={plan.purchased.length} />
        <SummaryCard label="Program runs" value={plan.programRuns.length} />
        <SummaryCard label="Can't explode" value={plan.unresolved.length} tone={plan.unresolved.length > 0 ? "warn" : undefined} />
      </div>

      <LeafTable
        title="Raw materials to buy"
        subtitle="sheets & materials consumed by the programs"
        icon={<Layers className="h-4 w-4" />}
        rows={plan.rawMaterials}
        empty="No raw-material demand — make items may be missing their program link."
      />

      <div className="mt-6">
        <LeafTable
          title="Purchased parts to buy"
          subtitle="trade items (operators, fixings, …)"
          icon={<ShoppingCart className="h-4 w-4" />}
          rows={plan.purchased}
          empty="No purchased-part demand."
        />
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
