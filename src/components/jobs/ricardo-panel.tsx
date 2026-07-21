"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IndianRupee, AlertTriangle } from "lucide-react";
import {
  getCrmFinancials,
  type CrmFinancials,
} from "@/lib/actions/crm-financials";
import { getCrmPaymentEventJobs } from "@/lib/actions/crm-payment-event-count";
import { ricardoKeyOf } from "@/lib/ricardo/job-number";
import { ltCrmKeyOf } from "@/lib/ltcrm/job-number";

/**
 * Live money panel for CRM-linked jobs — contract value, transport scope and
 * customer payments read straight from the owning CRM (Ricardo or LT
 * Elevator) at view time. Self-contained: fetches on mount (same pattern as
 * the R1 chip) so the server page needs no new props; renders nothing for
 * jobs neither CRM knows.
 */

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${inr.format(Math.round(n))}`;

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
      {sub && <p className="text-[10px] text-[var(--muted-foreground)]">{sub}</p>}
    </div>
  );
}

export function RicardoPanel({ jobNumber }: { jobNumber: string }) {
  const isCrm = ricardoKeyOf(jobNumber) !== null || ltCrmKeyOf(jobNumber) !== null;
  const [data, setData] = useState<CrmFinancials | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Unacknowledged payment events on THIS job → "New payment" pill.
  const [hasNewPayment, setHasNewPayment] = useState(false);

  useEffect(() => {
    if (!isCrm) return;
    let alive = true;
    getCrmFinancials(jobNumber)
      .then((d) => {
        if (alive) {
          setData(d);
          setLoaded(true);
        }
      })
      .catch(() => {});
    getCrmPaymentEventJobs()
      .then((list) => {
        if (alive) setHasNewPayment(list.includes(jobNumber));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [jobNumber, isCrm]);

  // Job neither CRM knows, still loading, or integration not configured — no panel.
  if (!isCrm || !loaded || data === null) return null;

  const crmName = data.source === "ltcrm" ? "LT CRM" : "Ricardo CRM";

  if (!data.found) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
        <AlertTriangle size={14} />
        <span>
          <span className="font-medium">{crmName}:</span> no live job found for{" "}
          <span className="font-medium">{jobNumber}</span> — financials unavailable.
        </span>
      </div>
    );
  }

  const transport =
    data.transportMode === "Customer" ? (
      <span className="text-sky-700">Customer scope</span>
    ) : data.transportMode ? (
      <>
        {fmt(data.transportAmount) === "—" && data.transportTbd
          ? "TBD"
          : fmt(data.transportAmount)}
        <span className="ml-1 font-normal text-[var(--muted-foreground)]">
          ({data.transportMode})
        </span>
      </>
    ) : (
      "—"
    );

  // Owner's call (2026-07-04): only approved money is shown — no pending
  // figures anywhere, including the history rows.
  const payments = (data.payments ?? []).filter((p) => p.status === "approved");

  return (
    <div className="mb-3 card-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-semibold">
          <IndianRupee size={13} />
          {crmName}
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {data.fullJobNumber}
          {data.customerName ? ` · ${data.customerName}` : ""}
        </span>
        {data.isGovernment && (
          <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-orange-500" />
            </span>
            Government
          </span>
        )}
        {hasNewPayment && (
          <Link
            href="/jobs/crm-payments"
            title="New payment update from the CRM — open CRM Payments to review and acknowledge"
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            New payment
          </Link>
        )}
        {data.isAudited ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            Audited
          </span>
        ) : (
          <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">
            Not audited
          </span>
        )}
        <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">
          live from CRM
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Contract Value" value={fmt(data.contractValue)} />
        <Stat label="Transport" value={transport} />
        <Stat
          label="Received (approved)"
          value={<span className="text-emerald-700">{fmt(data.receivedApproved)}</span>}
          sub={
            payments.length
              ? `${payments.length} payment${payments.length === 1 ? "" : "s"}`
              : undefined
          }
        />
      </div>

      {payments.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[11px] text-[var(--muted-foreground)]">
            Payment history ({payments.length})
          </summary>
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {payments.map((p, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    <td className="py-1 pr-3 whitespace-nowrap text-[var(--muted-foreground)]">
                      {p.date
                        ? new Date(p.date).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="py-1 pr-3 font-medium whitespace-nowrap">{fmt(p.amount)}</td>
                    <td className="py-1 pr-3">{p.mode ?? "—"}</td>
                    <td className="py-1 pr-3 text-[var(--muted-foreground)]">
                      {[p.reference, p.bank].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-1">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                        approved
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
