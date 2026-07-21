"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IndianRupee, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useOperator } from "@/lib/jobs/use-operator";
import {
  acknowledgeCrmPaymentEvents,
  type CrmPaymentEvent,
} from "@/lib/actions/crm-payment-events";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const fmt = (n: number) => `₹${inr.format(Math.round(n))}`;
const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const fmtDate = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const KIND_META: Record<CrmPaymentEvent["kind"], { label: string; cls: string }> = {
  approved: { label: "Payment approved", cls: "bg-emerald-500/15 text-emerald-600" },
  // Neutral wording: an 'updated' event is any post-approval change to an
  // approved payment's details, not necessarily a hand edit.
  updated: { label: "Payment updated", cls: "bg-blue-500/15 text-blue-600" },
};

export function CrmPaymentsClient({ events }: { events: CrmPaymentEvent[] }) {
  const router = useRouter();
  const toast = useToast();
  const { ensureOperator } = useOperator();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const ack = (toAck: CrmPaymentEvent[], doneMsg: string) => {
    const operator = ensureOperator();
    setBusyId(toAck.length === 1 ? toAck[0].id : "__all__");
    startTransition(async () => {
      const res = await acknowledgeCrmPaymentEvents(
        toAck.map((e) => ({ id: e.id, source: e.source, erpJobNumber: e.erpJobNumber })),
        operator,
      );
      if (!res.ok) toast.error(res.error ?? "Could not acknowledge");
      else {
        toast.success(doneMsg);
        // Nudge the sidebar's blinker right away (it also polls every 60s).
        window.dispatchEvent(new Event("crm-payments-refresh"));
        router.refresh();
      }
      setBusyId(null);
    });
  };

  return (
    <div>
      <PageHeader
        icon={<IndianRupee size={18} />}
        title="CRM Payments"
        meta="New approved customer payments from the last 14 days, live from the Ricardo and LT Elevator CRMs — the sidebar blinks until each is acknowledged. Full payment history stays on each job's money panel."
      />

      {events.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 size={28} className="text-emerald-600" />}
            title="No new payment updates"
            description="When a customer payment is approved (or an approved payment is updated) in either CRM for a job the ERP carries, it appears here for 14 days and blinks in the sidebar until acknowledged."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
            <IndianRupee size={15} className="text-emerald-600" />
            <span className="text-sm font-semibold">
              {events.length} new payment {events.length === 1 ? "update" : "updates"}
            </span>
            <div className="ml-auto">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => ack(events, "All payment updates acknowledged.")}
                disabled={pending}
              >
                {busyId === "__all__" ? "…" : "Acknowledge all"}
              </Button>
            </div>
          </div>
          <Table density="dense">
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-center">Event</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Mode / Ref</TableHead>
                <TableHead>CRM</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-sm font-medium">
                    <Link href={`/jobs/${e.erpJobId}`} className="hover:underline">
                      {e.erpJobNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{e.customerName || "—"}</TableCell>
                  <TableCell className="text-center">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_META[e.kind].cls}`}
                    >
                      {KIND_META[e.kind].label}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold text-emerald-700 whitespace-nowrap">
                    {fmt(e.amount)}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{fmtDate(e.dateReceived)}</TableCell>
                  <TableCell className="max-w-[220px] text-xs text-[var(--muted-foreground)]">
                    {[e.mode, e.reference, e.bank].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell>
                    <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                      {e.source === "ltcrm" ? "LT CRM" : "Ricardo CRM"}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                    {fmtDateTime(e.eventAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/jobs/${e.erpJobId}`}
                        className="text-sm font-medium text-[var(--primary)] hover:underline"
                      >
                        Open
                      </Link>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => ack([e], `Acknowledged ${e.erpJobNumber}.`)}
                        disabled={busyId === e.id || pending}
                      >
                        {busyId === e.id ? "…" : "Acknowledge"}
                      </Button>
                    </div>
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
