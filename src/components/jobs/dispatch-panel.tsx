"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Truck,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Plus,
  Printer,
  Pencil,
  Check,
  X,
  User,
  Phone,
  CalendarCheck,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useOperator } from "@/lib/jobs/use-operator";
import {
  deleteDispatch,
  updateDispatchLineQty,
  updateDispatchDriver,
  getJobDeliveryConfirmations,
  acknowledgeDeliveryConfirmation,
  type JobDispatchSummary,
  type PhaseScope,
  type DeliveryConfirmation,
} from "@/lib/actions/dispatch";
import {
  dispatchStat,
  toneText,
  type DispatchStat,
} from "@/lib/dispatch-status";
import { downloadDispatchHistoryPdf, downloadBalancePdf } from "@/lib/export/dispatch-pdf";

const SCOPE_LABEL: Record<PhaseScope, string> = {
  first: "1st phase",
  second: "2nd phase",
  full: "Entire job",
};

/** One phase's dispatch status with a slim progress bar (lines done / total). */
function PhaseStatus({ name, stat }: { name: string; stat: DispatchStat | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-[var(--muted-foreground)]">{name}:</span>
      <span className={`font-medium ${toneText(stat?.tone)}`}>
        {stat ? stat.label : "—"}
      </span>
      {stat && (
        <span className="inline-block w-14 h-1.5 rounded-full bg-[var(--muted)] overflow-hidden">
          <span
            className="block h-full rounded-full transition-all"
            style={{
              width: `${stat.total ? (stat.done / stat.total) * 100 : 0}%`,
              backgroundColor:
                stat.tone === "done"
                  ? "var(--success)"
                  : stat.tone === "partial"
                    ? "var(--warning)"
                    : "var(--muted-foreground)",
            }}
          />
        </span>
      )}
    </span>
  );
}

/** The green "Delivery confirmed by construction" line + Acknowledge control.
 *  Shared by the per-dispatch strip and the job-level "unlinked" list so a
 *  confirmation posted with only a job key (no dispatch id) is still visible
 *  and acknowledgeable. */
function ConfirmationLine({
  conf,
  busy,
  isPending,
  onAck,
}: {
  conf: DeliveryConfirmation;
  busy: string | null;
  isPending: boolean;
  onAck: (c: DeliveryConfirmation) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      <span className="inline-flex items-center gap-1 font-medium text-[var(--success)]">
        <CalendarCheck className="h-3.5 w-3.5" />
        Delivery confirmed
        {conf.confirmed_date &&
          `: ${new Date(conf.confirmed_date).toLocaleDateString([], {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}`}
        {conf.confirmed_time && ` · ${conf.confirmed_time}`}
      </span>
      {conf.confirmed_by && (
        <span className="text-[var(--muted-foreground)]">by {conf.confirmed_by}</span>
      )}
      {conf.note && (
        <span className="text-[var(--muted-foreground)] italic truncate max-w-[40%]">
          · {conf.note}
        </span>
      )}
      {conf.acknowledged_at ? (
        <span className="inline-flex items-center gap-1 text-[var(--muted-foreground)]">
          <Check className="h-3 w-3" /> seen
          {conf.acknowledged_by ? ` by ${conf.acknowledged_by}` : ""}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onAck(conf)}
          disabled={busy === conf.id || isPending}
          className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 font-medium hover:bg-[var(--muted)] cursor-pointer"
        >
          {busy === conf.id ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          Acknowledge
        </button>
      )}
    </div>
  );
}

export function DispatchPanel({
  jobId,
  summary,
  onNewDispatch,
  jobNumber,
  customerName,
  location,
}: {
  jobId: string;
  summary: JobDispatchSummary;
  onNewDispatch: () => void;
  /** Letterhead details for the printable dispatch/balance lists. */
  jobNumber?: string | null;
  customerName?: string | null;
  location?: string | null;
}) {
  const pdfInfo = { jobNumber: jobNumber ?? null, customerName, location };
  const router = useRouter();
  const toast = useToast();
  const { ensureOperator } = useOperator();
  const [isPending, startTransition] = useTransition();
  // Delivery confirmations posted back by the Construction team (LT AMC) after
  // they call the driver. Client-fetched (written outside the ERP, so the cached
  // dispatch summary never carries them) — matches the R1-chip pattern.
  const [confirmations, setConfirmations] = useState<DeliveryConfirmation[]>([]);
  useEffect(() => {
    let alive = true;
    getJobDeliveryConfirmations(jobId)
      .then((rows) => {
        if (alive) setConfirmations(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [jobId]);
  // Newest confirmation per dispatch (list is already newest-first from the server).
  const confirmByDispatch = new Map<string, DeliveryConfirmation>();
  for (const c of confirmations) {
    if (c.dispatch_id && !confirmByDispatch.has(c.dispatch_id))
      confirmByDispatch.set(c.dispatch_id, c);
  }
  // Confirmations construction posted with only a job key (no dispatch id), or
  // whose dispatch isn't in this list, would otherwise be invisible and could
  // never be acknowledged — surface them at the job level.
  const dispatchIdSet = new Set(summary.dispatches.map((d) => d.id));
  const orphanConfirmations = confirmations.filter(
    (c) => !c.dispatch_id || !dispatchIdSet.has(c.dispatch_id),
  );

  const onAcknowledge = (c: DeliveryConfirmation) => {
    const who = ensureOperator();
    setBusy(c.id);
    startTransition(async () => {
      const res = await acknowledgeDeliveryConfirmation(c.id, jobId, who);
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error || "Could not acknowledge the confirmation.");
        return;
      }
      const nowIso = new Date().toISOString();
      setConfirmations((rows) =>
        rows.map((r) =>
          r.id === c.id ? { ...r, acknowledged_at: nowIso, acknowledged_by: who ?? null } : r,
        ),
      );
      toast.success("Delivery confirmation acknowledged.");
    });
  };
  // The newest dispatch starts expanded so "what just went out" is visible
  // immediately after recording one (the page refreshes into this state).
  const [openId, setOpenId] = useState<string | null>(
    summary.dispatches[0]?.id ?? null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  // Inline qty correction on a recorded line (a marking error — e.g. 26 entered
  // when only 22 went). Saving posts the stock delta and the balance recomputes.
  const [editLineId, setEditLineId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<string>("");
  // Inline driver edit — set/change the driver on a recorded dispatch (details
  // often arrive after the material left, and drivers get swapped).
  const [editDriverId, setEditDriverId] = useState<string | null>(null);
  const [edName, setEdName] = useState("");
  const [edPhone, setEdPhone] = useState("");
  const [edVehicle, setEdVehicle] = useState("");

  const startEditDriver = (d: JobDispatchSummary["dispatches"][number]) => {
    setEditDriverId(d.id);
    setEdName(d.driver_name ?? "");
    setEdPhone(d.driver_phone ?? "");
    setEdVehicle(d.vehicle_number ?? "");
  };

  const saveDriver = (dispatchId: string) => {
    if (edPhone && edPhone.length !== 10) {
      toast.error("Driver phone must be exactly 10 digits (or left blank).");
      return;
    }
    const key = "driver:" + dispatchId;
    setBusy(key);
    startTransition(async () => {
      const res = await updateDispatchDriver(
        dispatchId,
        { driver_name: edName, driver_phone: edPhone, vehicle_number: edVehicle },
        jobId,
      );
      setBusy(null);
      setEditDriverId(null);
      if (!res.ok) {
        toast.error(res.error || "Could not save the driver details.");
        return;
      }
      toast.success("Driver details saved.");
      router.refresh();
    });
  };

  const saveQty = (lineId: string, oldQty: number) => {
    const n = Number(editQty);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Enter a quantity of 0 or more.");
      return;
    }
    if (n === oldQty) {
      setEditLineId(null);
      return;
    }
    setBusy(lineId);
    startTransition(async () => {
      const res = await updateDispatchLineQty(lineId, n, jobId);
      setBusy(null);
      setEditLineId(null);
      if (!res.ok) {
        toast.error(res.error || "Could not correct the quantity.");
        return;
      }
      toast.success(
        `Quantity corrected ${oldQty.toLocaleString()} → ${n.toLocaleString()}. Stock adjusted; the balance now shows what's left.`,
      );
      router.refresh();
    });
  };

  const first = dispatchStat(summary.lines.filter((l) => l.phase === "first"));
  const second = dispatchStat(summary.lines.filter((l) => l.phase === "second"));

  // What still needs to leave the factory. The full per-item view lives in the
  // job page's BALANCE tab — the panel only signals the overall state.
  const pendingCount = summary.lines.filter((l) => l.remaining > 0).length;
  const hasBom = summary.lines.length > 0;

  const onDelete = (id: string) => {
    if (!window.confirm("Undo this dispatch? The recorded items will be removed and their stock deduction restored."))
      return;
    setBusy(id);
    startTransition(async () => {
      const res = await deleteDispatch(id, jobId);
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error || "Could not undo the dispatch.");
        return;
      }
      toast.success(
        "Dispatch removed. The job's stage was not changed — edit it on the job if needed.",
      );
      router.refresh();
    });
  };

  return (
    <div className="card-surface p-2.5 mb-3">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-[13px] font-semibold inline-flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5" /> Dispatches
            {summary.dispatches.length > 0 && (
              <span className="font-normal text-[11px] text-[var(--muted-foreground)]">
                ({summary.dispatches.length})
              </span>
            )}
          </h3>
          <PhaseStatus name="1st phase" stat={first} />
          <PhaseStatus name="2nd phase" stat={second} />
          {hasBom &&
            (pendingCount === 0 ? (
              <span className="text-[11px] font-medium text-[var(--success)]">all sent ✓</span>
            ) : (
              <span className="text-[11px] text-[var(--warning)]">
                {pendingCount} item{pendingCount === 1 ? "" : "s"} pending — see Balance below
              </span>
            ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void downloadBalancePdf(pdfInfo, summary.lines)}
            title="Print the balance list — everything still left to send"
            className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-1 text-[11px] font-medium hover:bg-[var(--muted)] cursor-pointer"
          >
            <Printer className="h-3 w-3" /> Balance
          </button>
          <Button size="sm" onClick={onNewDispatch}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Mark dispatched
          </Button>
        </div>
      </div>

      {summary.dispatches.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          No dispatches recorded yet.
        </p>
      ) : (
        <div className="space-y-2">
          {summary.dispatches.map((d) => {
            const total = d.lines.reduce((a, l) => a + l.qty, 0);
            const isOpen = openId === d.id;
            const hasDriver = d.driver_name || d.driver_phone || d.vehicle_number;
            const conf = confirmByDispatch.get(d.id);
            return (
              <div key={d.id} className="border border-[var(--border)] rounded-md">
                <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : d.id)}
                    className="inline-flex items-center gap-1 text-sm font-medium cursor-pointer"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    {new Date(d.dispatch_date).toLocaleDateString([], {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </button>
                  <Badge variant="neutral" className="text-[10px] uppercase tracking-wide px-1.5 py-0.5">
                    {SCOPE_LABEL[d.phase_scope]}
                  </Badge>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {d.lines.length} item{d.lines.length === 1 ? "" : "s"} ·{" "}
                    {total.toLocaleString()} qty
                  </span>
                  {d.note && (
                    <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[40%]">
                      · {d.note}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void downloadDispatchHistoryPdf(pdfInfo, d)}
                    title="Print this dispatch list (reprint)"
                    className="ml-auto p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer"
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(d.id)}
                    disabled={busy === d.id || isPending}
                    title="Undo this dispatch"
                    className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-bg)] cursor-pointer"
                  >
                    {busy === d.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <div className="px-3 pb-2 flex flex-col gap-1.5">
                    {editDriverId === d.id ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <input
                          value={edName}
                          onChange={(e) => setEdName(e.target.value)}
                          placeholder="Driver name"
                          className="h-7 w-36 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        />
                        <input
                          value={edPhone}
                          onChange={(e) => setEdPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                          inputMode="numeric"
                          maxLength={10}
                          placeholder="10-digit phone"
                          className="h-7 w-32 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        />
                        <input
                          value={edVehicle}
                          onChange={(e) => setEdVehicle(e.target.value)}
                          placeholder="Vehicle no."
                          className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        />
                        <button
                          type="button"
                          onClick={() => saveDriver(d.id)}
                          disabled={busy === "driver:" + d.id}
                          title="Save driver details"
                          className="p-1 rounded text-[var(--success)] hover:bg-[var(--muted)] cursor-pointer"
                        >
                          {busy === "driver:" + d.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditDriverId(null)}
                          title="Cancel"
                          className="p-1 rounded text-[var(--muted-foreground)] hover:bg-[var(--muted)] cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : hasDriver ? (
                      <div className="flex items-center gap-3 flex-wrap text-[11px] text-[var(--muted-foreground)]">
                        {d.driver_name && (
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3 w-3" /> {d.driver_name}
                          </span>
                        )}
                        {d.driver_phone && (
                          <a
                            href={`tel:${d.driver_phone}`}
                            className="inline-flex items-center gap-1 hover:text-[var(--primary)]"
                          >
                            <Phone className="h-3 w-3" /> {d.driver_phone}
                          </a>
                        )}
                        {d.vehicle_number && (
                          <span className="inline-flex items-center gap-1">
                            <Truck className="h-3 w-3" /> {d.vehicle_number}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => startEditDriver(d)}
                          disabled={editDriverId !== null && editDriverId !== d.id}
                          title="Edit / change driver details"
                          className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditDriver(d)}
                        disabled={editDriverId !== null && editDriverId !== d.id}
                        title="Add the driver's name, phone and vehicle to this dispatch"
                        className="self-start inline-flex items-center gap-1 rounded border border-dashed border-[var(--border)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        <Plus className="h-3 w-3" /> Add driver details
                      </button>
                    )}
                    {conf && (
                      <ConfirmationLine conf={conf} busy={busy} isPending={isPending} onAck={onAcknowledge} />
                    )}
                  </div>
                {isOpen && (
                  <div className="px-3 pb-2 border-t border-[var(--border)] divide-y divide-[var(--border)]">
                    {d.lines.map((l) => (
                      <div key={l.id} className="flex justify-between gap-2 py-1 text-sm">
                        <span className="truncate">
                          {l.item_name ?? l.label ?? "(item)"}
                          {l.item_code && (
                            <span className="ml-2 font-mono text-[11px] text-[var(--muted-foreground)]">
                              {l.item_code}
                            </span>
                          )}
                          {l.category && (
                            <span className="ml-2 text-[11px] italic text-[var(--muted-foreground)]">
                              {l.category}
                            </span>
                          )}
                          {l.adhoc && (
                            <span
                              className="ml-2 inline-block rounded px-1 py-px text-[10px] font-medium bg-[var(--warning-bg)] text-[var(--warning)]"
                              title="Added at dispatch — not on the job's BOM"
                            >
                              extra item
                            </span>
                          )}
                        </span>
                        {editLineId === l.id ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              autoFocus
                              value={editQty}
                              onChange={(e) => setEditQty(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveQty(l.id, l.qty);
                                if (e.key === "Escape") setEditLineId(null);
                              }}
                              className="w-20 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                            />
                            <button
                              type="button"
                              onClick={() => saveQty(l.id, l.qty)}
                              disabled={busy === l.id}
                              title="Save corrected quantity"
                              className="p-1 rounded text-[var(--success)] hover:bg-[var(--muted)] cursor-pointer"
                            >
                              {busy === l.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditLineId(null)}
                              title="Cancel"
                              className="p-1 rounded text-[var(--muted-foreground)] hover:bg-[var(--muted)] cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <span className="font-medium">{l.qty.toLocaleString()}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditLineId(l.id);
                                setEditQty(String(l.qty));
                              }}
                              title="Correct this quantity (marking error) — stock and balance adjust automatically"
                              className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] cursor-pointer"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {orphanConfirmations.length > 0 && (
        <div className="mt-2 border-t border-[var(--border)] pt-2 space-y-1">
          <div className="text-[11px] font-medium text-[var(--muted-foreground)]">
            Delivery confirmations not linked to a dispatch
          </div>
          {orphanConfirmations.map((conf) => (
            <ConfirmationLine
              key={conf.id}
              conf={conf}
              busy={busy}
              isPending={isPending}
              onAck={onAcknowledge}
            />
          ))}
        </div>
      )}
    </div>
  );
}
