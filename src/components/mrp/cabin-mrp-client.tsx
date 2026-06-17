"use client";

import { useMemo } from "react";
import Link from "next/link";
import { LayoutGrid, AlertTriangle, Scissors } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import type { CabinMrpPlan, CabinPlanProgram } from "@/lib/actions/cabin-program-plan";

export function CabinMrpClient({ plan }: { plan: CabinMrpPlan }) {
  const byCategory = useMemo(() => {
    const m = new Map<string, CabinPlanProgram[]>();
    for (const p of plan.programs) {
      const arr = m.get(p.category) ?? [];
      arr.push(p);
      m.set(p.category, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [plan.programs]);

  return (
    <div>
      <PageHeader
        icon={<LayoutGrid size={18} />}
        title="Cabin MRP — programs to cut"
        meta="Cabin-job demand, planned through cabin programs (fewest sheets), by finish"
      />

      <StatStrip className="mb-4">
        <StatTile label="Programs to run" value={plan.programs.length.toLocaleString()} />
        <StatTile label="Total runs" value={plan.totals.runs.toLocaleString()} />
        <StatTile label="Sheets to cut" value={plan.totals.sheets.toLocaleString()} />
        <StatTile label="Not mapped" value={plan.unmapped.length.toLocaleString()} tone={plan.unmapped.length ? "warn" : "default"} />
      </StatStrip>

      {plan.totals.auditedPrograms === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={<LayoutGrid size={28} />}
            title="No audited cabin programs yet"
            description="Create cabin programs and mark them audited — only audited programs are planned (same rule as Make MRP)."
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Sheets to cut */}
          {plan.sheets.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5">
                <Scissors size={15} className="text-[var(--primary)]" /> Sheets to cut
              </h2>
              <div className="flex flex-wrap gap-2">
                {plan.sheets.map((s) => (
                  <div key={s.code} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm">
                    <span className="font-medium tabular-nums">{s.sheets}</span>
                    <span className="text-[var(--muted-foreground)]"> × </span>
                    {s.thickness_mm != null && <Badge variant="blue">{s.thickness_mm}mm</Badge>}
                    <span className="ml-1.5">{s.finish}</span>
                    <span className="ml-1.5 font-mono text-[11px] text-[var(--muted-foreground)]">{s.code}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Programs to run, grouped by category */}
          {plan.programs.length === 0 ? (
            <div className="card-surface">
              <EmptyState icon={<Scissors size={26} />} title="Nothing to cut" description="Cabin-job demand is covered by stock, or not yet mapped to programs." />
            </div>
          ) : (
            byCategory.map(([category, programs]) => (
              <div key={category}>
                <h2 className="text-sm font-semibold mb-2">{category} <span className="font-normal text-[var(--muted-foreground)]">· {programs.length}</span></h2>
                <div className="card-surface overflow-hidden">
                  <Table density="dense">
                    <TableHeader sticky>
                      <TableRow>
                        <TableHead>Program</TableHead>
                        <TableHead>Finish</TableHead>
                        <TableHead>Sheet</TableHead>
                        <TableHead className="text-right">Runs</TableHead>
                        <TableHead>Makes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {programs.map((p) => (
                        <TableRow key={`${p.program_id}-${p.finish}`}>
                          <TableCell>
                            <Link href={`/cabin-programs/${p.program_id}`} className="font-medium hover:text-[var(--primary)]">{p.name}</Link>
                            {p.code && <span className="ml-1.5 font-mono text-[11px] text-[var(--muted-foreground)]">{p.code}</span>}
                          </TableCell>
                          <TableCell><Badge variant="purple">{p.finish}</Badge></TableCell>
                          <TableCell className="text-sm text-[var(--muted-foreground)]">
                            {p.thickness_mm != null && <span className="text-[var(--primary)] mr-1">{p.thickness_mm}mm</span>}
                            {p.sheet_name ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">×{p.runs}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {p.makes.map((m) => (
                                <span key={m.code} className="text-[11px] rounded bg-[var(--muted)] px-1.5 py-0.5" title={m.name}>
                                  {m.name} <span className="tabular-nums text-[var(--muted-foreground)]">×{m.qty}</span>
                                </span>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))
          )}

          {/* Not currently mapped */}
          {plan.unmapped.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5 text-[var(--warning)]">
                <AlertTriangle size={15} /> Not currently mapped · {plan.unmapped.length}
              </h2>
              <p className="text-xs text-[var(--muted-foreground)] mb-2">
                Demanded cabin items that no audited program can cut — either no program produces them, or no sheet exists for that finish.
              </p>
              <div className="card-surface overflow-hidden">
                <Table density="dense">
                  <TableHeader sticky>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Finish</TableHead>
                      <TableHead className="text-right">Need</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.unmapped.map((u) => (
                      <TableRow key={u.item_id}>
                        <TableCell className="font-mono text-xs">{u.code}</TableCell>
                        <TableCell>{u.name}</TableCell>
                        <TableCell className="text-sm text-[var(--muted-foreground)]">{u.finish ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.need.toLocaleString()}</TableCell>
                        <TableCell>
                          {u.reason === "no-sheet"
                            ? <Badge variant="amber">no sheet for finish</Badge>
                            : <Badge variant="neutral">no program</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
