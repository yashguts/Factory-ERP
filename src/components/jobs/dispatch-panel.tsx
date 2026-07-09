"use client";

import { useState, useTransition } from "react";
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
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import {
  deleteDispatch,
  updateDispatchLineQty,
  type JobDispatchSummary,
  type PhaseScope,
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
  const [isPending, startTransition] = useTransition();
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
    </div>
  );
}
