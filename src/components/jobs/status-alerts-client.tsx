"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useOperator } from "@/lib/jobs/use-operator";
import { ALERT_META, statusLabel } from "@/lib/jobs/status-alert";
import { acknowledgeStatusAlert, type OpenStatusAlertRow } from "@/lib/actions/job-status";

const TONE: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-600",
  red: "bg-red-500/15 text-red-600",
  amber: "bg-amber-500/15 text-amber-600",
  blue: "bg-blue-500/15 text-blue-600",
};
const fmtDateTime = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN") : "—");

export function StatusAlertsClient({ rows }: { rows: OpenStatusAlertRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const { ensureOperator } = useOperator();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const ack = (id: string, jobNumber: string) => {
    const operator = ensureOperator();
    setBusyId(id);
    startTransition(async () => {
      const res = await acknowledgeStatusAlert(id, operator);
      if (!res.ok) toast.error(res.error ?? "Could not acknowledge");
      else { toast.success(`Acknowledged ${jobNumber}.`); router.refresh(); }
      setBusyId(null);
    });
  };

  return (
    <div>
      <PageHeader
        icon={<Bell size={18} />}
        title="Job Status Alerts"
        meta="Production-critical status changes by Sales/CRM — acknowledge once the factory has actioned each one"
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 size={28} className="text-emerald-600" />}
            title="No open status alerts"
            description="When a job is started, put on hold, reverted to new, or resumed, it appears here until someone acknowledges it."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
            <Bell size={15} className="text-amber-600" />
            <span className="text-sm font-semibold">{rows.length} open {rows.length === 1 ? "alert" : "alerts"}</span>
          </div>
          <Table density="dense">
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-center">Change</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>By &amp; when</TableHead>
                <TableHead>Req. Dispatch</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const meta = ALERT_META[r.alert_kind];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm font-medium">{r.job_number}</TableCell>
                    <TableCell>{r.customer_name || "—"}</TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[meta.tone]}`}>
                        {meta.icon} {meta.label}
                      </span>
                      <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                        {statusLabel(r.from_status)} → {statusLabel(r.to_status)}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[240px] text-sm">
                      {r.reason || <span className="text-[var(--muted-foreground)]">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="font-medium">{r.changed_by && r.changed_by !== "unknown" ? r.changed_by : "—"}</span>
                      <div className="text-xs text-[var(--muted-foreground)]">{fmtDateTime(r.changed_at)}</div>
                    </TableCell>
                    <TableCell className="text-sm">{fmtDate(r.requirement_dispatch_date)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/jobs/${r.job_id}`} className="text-sm font-medium text-[var(--primary)] hover:underline">Open</Link>
                        <Button size="sm" variant="secondary" onClick={() => ack(r.id, r.job_number)} disabled={busyId === r.id || pending}>
                          {busyId === r.id ? "…" : "Acknowledge"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
