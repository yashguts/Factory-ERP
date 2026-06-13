"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Truck,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Plus,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import {
  deleteDispatch,
  type JobDispatchSummary,
  type PhaseScope,
} from "@/lib/actions/dispatch";
import {
  dispatchStat,
  toneText,
  type DispatchStat,
} from "@/lib/dispatch-status";

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
                  ? "#16a34a"
                  : stat.tone === "partial"
                    ? "#d97706"
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
}: {
  jobId: string;
  summary: JobDispatchSummary;
  onNewDispatch: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  // The newest dispatch starts expanded so "what just went out" is visible
  // immediately after recording one (the page refreshes into this state).
  const [openId, setOpenId] = useState<string | null>(
    summary.dispatches[0]?.id ?? null,
  );
  const [busy, setBusy] = useState<string | null>(null);

  const first = dispatchStat(summary.lines.filter((l) => l.phase === "first"));
  const second = dispatchStat(summary.lines.filter((l) => l.phase === "second"));

  // What still needs to leave the factory, grouped by dispatch phase.
  const pending = summary.lines
    .filter((l) => l.remaining > 0)
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        (a.item_name ?? "").localeCompare(b.item_name ?? ""),
    );
  const pendingFirst = pending.filter((l) => l.phase === "first");
  const pendingSecond = pending.filter((l) => l.phase === "second");
  const hasBom = summary.lines.length > 0;
  const [openRemaining, setOpenRemaining] = useState(pending.length > 0);

  const onDelete = (id: string) => {
    if (!window.confirm("Undo this dispatch? The recorded items will be removed (inventory is not affected)."))
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
    <div className="card-surface p-4 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
            <Truck className="h-4 w-4" /> Dispatch
          </h3>
          <PhaseStatus name="1st phase" stat={first} />
          <PhaseStatus name="2nd phase" stat={second} />
        </div>
        <Button size="sm" onClick={onNewDispatch}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Mark dispatched
        </Button>
      </div>

      {/* Remaining to dispatch — what still needs to be sent, with quantities */}
      {hasBom &&
        (pending.length === 0 ? (
          <p className="text-sm font-medium text-green-600 mb-3">
            All materials dispatched ✓
          </p>
        ) : (
          <div className="border border-[var(--border)] rounded-md mb-3">
            <button
              type="button"
              onClick={() => setOpenRemaining((o) => !o)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer"
            >
              {openRemaining ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <span className="text-amber-600">
                Remaining to dispatch — {pending.length} item
                {pending.length === 1 ? "" : "s"}
              </span>
              <span className="text-xs text-[var(--muted-foreground)]">
                1st phase: {pendingFirst.length} · 2nd phase: {pendingSecond.length}
              </span>
            </button>
            {openRemaining && (
              <div className="px-3 pb-2 border-t border-[var(--border)]">
                {([
                  ["1st phase", pendingFirst],
                  ["2nd phase", pendingSecond],
                ] as const).map(([title, rows]) =>
                  rows.length === 0 ? null : (
                    <div key={title} className="pt-2">
                      <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                        {title} · {rows.length}
                      </div>
                      <div className="divide-y divide-[var(--border)]">
                        {rows.map((l) => (
                          <div
                            key={l.job_bom_line_id}
                            className="flex justify-between gap-2 py-1 text-sm"
                          >
                            <span className="truncate">
                              {l.item_name ?? "(item)"}
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
                            </span>
                            <span className="whitespace-nowrap text-right">
                              <span className="font-medium text-amber-600">
                                {l.remaining.toLocaleString()}
                                {l.uom ? ` ${l.uom}` : ""} remaining
                              </span>
                              <span className="ml-2 text-[11px] text-[var(--muted-foreground)]">
                                {l.required.toLocaleString()} required,{" "}
                                {l.dispatched.toLocaleString()} dispatched
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        ))}

      {summary.dispatches.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
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
                  <span className="text-[10px] uppercase tracking-wide rounded-full px-1.5 py-0.5 border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]">
                    {SCOPE_LABEL[d.phase_scope]}
                  </span>
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
                    onClick={() => onDelete(d.id)}
                    disabled={busy === d.id || isPending}
                    title="Undo this dispatch"
                    className="ml-auto p-1 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer"
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
                            <span className="ml-2 text-[10px] text-amber-600">ad-hoc</span>
                          )}
                        </span>
                        <span className="font-medium whitespace-nowrap">
                          {l.qty.toLocaleString()}
                        </span>
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
