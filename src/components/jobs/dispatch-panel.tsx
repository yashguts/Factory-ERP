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

const SCOPE_LABEL: Record<PhaseScope, string> = {
  first: "First phase",
  second: "Second phase",
  full: "Entire job",
};

type Stat = { total: number; done: number } | null;

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
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const phaseStat = (phase: "first" | "second"): Stat => {
    const ls = summary.lines.filter((l) => l.phase === phase);
    if (ls.length === 0) return null;
    return { total: ls.length, done: ls.filter((l) => l.remaining <= 0).length };
  };
  const first = phaseStat("first");
  const second = phaseStat("second");

  const label = (s: Stat) =>
    !s ? "—" : s.done === 0 ? "Pending" : s.done >= s.total ? "Dispatched" : `Partial (${s.done}/${s.total})`;
  const cls = (s: Stat) =>
    !s || s.done === 0
      ? "text-[var(--muted-foreground)]"
      : s.done >= s.total
        ? "text-green-600"
        : "text-amber-600";

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
          <span className="text-xs">
            First phase:{" "}
            <span className={`font-medium ${cls(first)}`}>{label(first)}</span>
          </span>
          <span className="text-xs">
            Second phase:{" "}
            <span className={`font-medium ${cls(second)}`}>{label(second)}</span>
          </span>
        </div>
        <Button size="sm" onClick={onNewDispatch}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Mark dispatched
        </Button>
      </div>

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
