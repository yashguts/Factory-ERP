"use client";

import Link from "next/link";
import { AlertTriangle, FileWarning, ArrowRight, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { GadDriftRow } from "@/lib/actions/gad-alerts";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN");
}

export function GadAlertsClient({ rows }: { rows: GadDriftRow[] }) {
  return (
    <div>
      <PageHeader
        icon={<FileWarning size={18} />}
        title="GAD Change Alerts"
        meta="Jobs whose GAD drawing changed after the BOM was defined — review before cutting, procuring, or dispatching"
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 size={28} className="text-emerald-600" />}
            title="No GAD changes pending review"
            description="When a job's drawing is re-uploaded after its BOM was defined, it appears here until someone marks the job audited."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
            <AlertTriangle size={15} className="text-red-600" />
            <span className="text-sm font-semibold">
              {rows.length} {rows.length === 1 ? "job needs" : "jobs need"} re-audit
            </span>
          </div>
          <Table density="dense">
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-center">GAD change</TableHead>
                <TableHead>Req. Dispatch</TableHead>
                <TableHead>GAD uploaded</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm font-medium">{r.job_number}</TableCell>
                  <TableCell>{r.customer_name || "—"}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center justify-center gap-1.5 font-mono text-xs">
                      <span className="text-[var(--muted-foreground)]">rev {r.baseline_rev ?? 0}</span>
                      <ArrowRight size={12} className="text-red-500" />
                      <span className="rounded bg-red-600 px-1.5 py-0.5 font-bold text-white">
                        rev {r.current_rev}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{fmtDate(r.requirement_dispatch_date)}</TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)]">
                    {fmtDate(r.gad_uploaded_at)}
                    {r.gad_uploaded_by && r.gad_uploaded_by !== "unknown" ? ` · ${r.gad_uploaded_by}` : ""}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/jobs/${r.id}`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)] hover:underline"
                    >
                      Review <ArrowRight size={13} />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
