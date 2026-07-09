"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCircle2, History, CalendarClock, Search } from "lucide-react";
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
import {
  acknowledgeStatusAlert,
  type OpenStatusAlertRow,
  type ChangeHistoryRow,
} from "@/lib/actions/job-status";

const TONE: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-600",
  red: "bg-red-500/15 text-red-600",
  amber: "bg-amber-500/15 text-amber-600",
  blue: "bg-blue-500/15 text-blue-600",
  purple: "bg-purple-500/15 text-purple-600",
};
const fmtDateTime = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN") : "—");

export function StatusAlertsClient({
  rows,
  history = [],
}: {
  rows: OpenStatusAlertRow[];
  history?: ChangeHistoryRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { ensureOperator } = useOperator();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "history">("open");
  const [q, setQ] = useState("");

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

  // History filter: every word must match somewhere (job #, customer, reason, who).
  const filteredHistory = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return history;
    return history.filter((h) => {
      const hay = [h.job_number, h.customer_name, h.reason, h.changed_by, h.kind]
        .filter(Boolean).join(" ").toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [history, q]);

  const tabBtn = (key: "open" | "history", label: string, count: number) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        tab === key
          ? "border-[var(--primary)] text-[var(--foreground)]"
          : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      }`}
    >
      {label}
      <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[11px] font-semibold">{count}</span>
    </button>
  );

  return (
    <div>
      <PageHeader
        icon={<Bell size={18} />}
        title="Job Status Alerts"
        meta="Production-critical changes by Sales/CRM — acknowledge each one; the History tab keeps every status and dispatch-date change on permanent record"
      />

      <div className="mb-3 flex items-center gap-1 border-b border-[var(--border)]">
        {tabBtn("open", "Open alerts", rows.length)}
        {tabBtn("history", "History", history.length)}
      </div>

      {tab === "open" ? (
        rows.length === 0 ? (
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
        )
      ) : filteredHistory.length === 0 && !q ? (
        <Card>
          <EmptyState
            icon={<History size={28} className="text-[var(--muted-foreground)]" />}
            title="No recorded changes yet"
            description="Every status change and every Req. Dispatch Date change is stored here permanently, with who did it, when, and why."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2.5">
            <History size={15} className="text-[var(--muted-foreground)]" />
            <span className="text-sm font-semibold">
              {filteredHistory.length} {filteredHistory.length === 1 ? "change" : "changes"}
            </span>
            <div className="relative ml-auto">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter job #, customer, reason, who…"
                className="w-[260px] rounded-md border border-[var(--border)] bg-transparent py-1 pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
          </div>
          <Table density="dense">
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-center">Change</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>By &amp; when</TableHead>
                <TableHead>Acknowledged</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredHistory.map((h) => (
                <TableRow key={`${h.kind}-${h.id}`}>
                  <TableCell className="font-mono text-sm font-medium">
                    <Link href={`/jobs/${h.job_id}`} className="hover:underline">{h.job_number}</Link>
                  </TableCell>
                  <TableCell>{h.customer_name || "—"}</TableCell>
                  <TableCell className="text-center">
                    {h.kind === "status" ? (
                      <>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          h.alert_kind ? TONE[ALERT_META[h.alert_kind].tone] : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                        }`}>
                          {h.alert_kind ? `${ALERT_META[h.alert_kind].icon} ${ALERT_META[h.alert_kind].label}` : "Status changed"}
                        </span>
                        <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                          {statusLabel(h.from)} → {statusLabel(h.to)}
                        </div>
                      </>
                    ) : (
                      <>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE.purple}`}>
                          <CalendarClock size={12} /> Dispatch date moved
                        </span>
                        <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                          {fmtDate(h.from)} → {fmtDate(h.to)}
                        </div>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[240px] text-sm">
                    {h.reason || <span className="text-[var(--muted-foreground)]">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="font-medium">{h.changed_by && h.changed_by !== "unknown" ? h.changed_by : "—"}</span>
                    <div className="text-xs text-[var(--muted-foreground)]">{fmtDateTime(h.changed_at)}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {h.kind === "date" ? (
                      <span className="text-[var(--muted-foreground)]">n/a</span>
                    ) : h.acknowledged_at ? (
                      <>
                        <span className="font-medium">{h.acknowledged_by || "—"}</span>
                        <div className="text-xs text-[var(--muted-foreground)]">{fmtDateTime(h.acknowledged_at)}</div>
                      </>
                    ) : h.alert_kind ? (
                      <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600">Open</span>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    )}
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
