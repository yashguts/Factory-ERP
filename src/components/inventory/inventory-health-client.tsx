"use client";

import Link from "next/link";
import { Activity, AlertTriangle, PackageX, Boxes, Truck, PlayCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { InventoryHealth } from "@/lib/actions/inventory-health";

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : (Math.round(n * 10) / 10).toLocaleString());

export function InventoryHealthClient({ data }: { data: InventoryHealth }) {
  const { warehouses, totalNegative, negatives, misplacedSheets, unpostedDispatches, unpostedRuns } = data;

  return (
    <div>
      <PageHeader
        icon={<Activity size={18} />}
        title="Inventory Health"
        meta="Read-only reconciliation — where the stock ledger and reality disagree"
      />

      <StatStrip className="mb-4">
        <StatTile label="Negative balances" value={fmt(totalNegative)} tone={totalNegative > 0 ? "danger" : "ok"} />
        <StatTile label="Misplaced raw sheets" value={fmt(misplacedSheets.count)} tone={misplacedSheets.count > 0 ? "warn" : "ok"} sub={`${fmt(misplacedSheets.qty)} qty outside Raw Material Store`} />
        <StatTile label="Dispatches not posted" value={fmt(unpostedDispatches.count)} tone={unpostedDispatches.count > 0 ? "warn" : "ok"} />
        <StatTile label="Runs not posted" value={fmt(unpostedRuns.count)} tone={unpostedRuns.count > 0 ? "warn" : "ok"} />
      </StatStrip>

      {/* Per-warehouse balances */}
      <Card className="mb-4 overflow-hidden p-0">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
          <Boxes size={15} className="text-[var(--muted-foreground)]" />
          <span className="text-sm font-semibold">Balances by warehouse</span>
        </div>
        <Table density="dense">
          <TableHeader>
            <TableRow>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">Items with stock</TableHead>
              <TableHead className="text-right">Negative items</TableHead>
              <TableHead className="text-right">Total qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {warehouses.map((w) => (
              <TableRow key={w.name}>
                <TableCell className="font-medium">{w.name}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(w.items_with_stock)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {w.items_negative > 0 ? <span className="text-[var(--destructive)] font-medium">{fmt(w.items_negative)}</span> : "0"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmt(w.total_qty)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Negative stock */}
      <Card className="mb-4 overflow-hidden p-0">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
          <PackageX size={15} className="text-[var(--destructive)]" />
          <span className="text-sm font-semibold">Negative stock</span>
          {totalNegative > 0 && (
            <span className="text-xs text-[var(--muted-foreground)]">
              {fmt(totalNegative)} item-locations below zero{negatives.length < totalNegative ? ` · showing ${negatives.length} most negative` : ""}
            </span>
          )}
        </div>
        {negatives.length === 0 ? (
          <EmptyState icon={<PackageX size={26} />} title="No negative balances" description="Every item-location is at or above zero." />
        ) : (
          <Table density="dense">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {negatives.map((r) => (
                <TableRow key={`${r.item_id}-${r.warehouse}`}>
                  <TableCell>
                    <Link href={`/inventory/${r.item_id}`} className="font-mono text-xs text-[var(--primary)] hover:underline cursor-pointer">
                      {r.code}
                    </Link>
                  </TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell><Badge variant="neutral">{r.warehouse}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums text-[var(--destructive)] font-medium">{fmt(r.qty)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Misplaced raw sheets */}
      <Card className="mb-4 overflow-hidden p-0">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
          <AlertTriangle size={15} className="text-[var(--warning)]" />
          <span className="text-sm font-semibold">Misplaced raw sheets</span>
          <span className="text-xs text-[var(--muted-foreground)]">raw material held outside Raw Material Store (program runs consume it from there)</span>
        </div>
        {misplacedSheets.count === 0 ? (
          <EmptyState icon={<Boxes size={26} />} title="All raw material is in the Raw Material Store" />
        ) : (
          <Table density="dense">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Sitting in</TableHead>
                <TableHead className="text-right">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {misplacedSheets.sample.map((r) => (
                <TableRow key={`${r.item_id}-${r.warehouse}`}>
                  <TableCell>
                    <Link href={`/inventory/${r.item_id}`} className="font-mono text-xs text-[var(--primary)] hover:underline cursor-pointer">
                      {r.code}
                    </Link>
                  </TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell><Badge variant="amber">{r.warehouse}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.qty)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Events not posted to stock */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
            <Truck size={15} className="text-[var(--muted-foreground)]" />
            <span className="text-sm font-semibold">Dispatches not posted to stock</span>
            {unpostedDispatches.count > 0 && <span className="text-xs text-[var(--muted-foreground)]">{fmt(unpostedDispatches.count)}</span>}
          </div>
          {unpostedDispatches.count === 0 ? (
            <EmptyState icon={<Truck size={24} />} title="All dispatches posted" />
          ) : (
            <Table density="dense">
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unpostedDispatches.sample.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono">{d.job_number}</TableCell>
                    <TableCell className="text-right text-[var(--muted-foreground)]">{d.dispatch_date}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
            <PlayCircle size={15} className="text-[var(--muted-foreground)]" />
            <span className="text-sm font-semibold">Program runs not posted to stock</span>
            {unpostedRuns.count > 0 && <span className="text-xs text-[var(--muted-foreground)]">{fmt(unpostedRuns.count)}</span>}
          </div>
          {unpostedRuns.count === 0 ? (
            <EmptyState icon={<PlayCircle size={24} />} title="All runs posted" />
          ) : (
            <Table density="dense">
              <TableHeader>
                <TableRow>
                  <TableHead>Program</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unpostedRuns.sample.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.code && <span className="font-mono text-[11px] text-[var(--muted-foreground)] mr-1.5">{r.code}</span>}
                      {r.name}
                    </TableCell>
                    <TableCell className="text-right text-[var(--muted-foreground)]">{r.run_date}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <p className="mt-4 text-[11px] text-[var(--muted-foreground)]">
        Read-only diagnostic. Fixes — warehouse routing, atomic posting, and a stock-take to zero out the negatives — ship separately for review.
      </p>
    </div>
  );
}
