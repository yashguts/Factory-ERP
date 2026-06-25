"use client";

import { useState } from "react";
import { Sparkles, AlertTriangle, ChevronDown, ChevronRight, X } from "lucide-react";
import { ConfidenceBadge } from "@/components/jobs/confidence-badge";
import type { AutofillResult } from "@/components/jobs/autofill-types";

/**
 * Non-modal companion to AI Auto-fill. The BOM is filled straight into the form;
 * this collapsible bar carries the read-only context the old review popup showed —
 * the raw drawing reads (so a misread is catchable) and the sections deliberately
 * left for manual fill (with drawing-derived hints). Dismissible; collapsible.
 */
export function AutofillContextPanel({
  result,
  onClose,
}: {
  result: AutofillResult;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const reads = result.drawingReads ?? [];
  const manual = result.manualSections ?? [];
  const hasBody = reads.length > 0 || manual.length > 0 || result.warnings.length > 0;

  return (
    <div className="rounded-md border border-[var(--primary)]/30 bg-[var(--primary)]/[0.04]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)] cursor-pointer min-w-0"
        >
          {hasBody &&
            (open ? (
              <ChevronDown size={13} className="shrink-0 text-[var(--muted-foreground)]" />
            ) : (
              <ChevronRight size={13} className="shrink-0 text-[var(--muted-foreground)]" />
            ))}
          <Sparkles size={13} className="shrink-0 text-[var(--primary)]" />
          <span className="truncate">
            AI Auto-fill — filled the BOM below.
            <span className="font-normal text-[var(--muted-foreground)]">
              {" "}
              {result.drawingRead
                ? "Read from the drawing + your similar past jobs."
                : "From the spec you entered + your similar past jobs."}{" "}
              Amber-outlined rows are low-confidence — verify them.
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Dismiss"
          className="ml-2 p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {open && hasBody && (
        <div className="px-3 pb-3 space-y-3 border-t border-[var(--border)] pt-2.5">
          {/* Warnings */}
          {result.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs px-2.5 py-1.5 rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]"
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {w}
            </div>
          ))}

          {/* Read from the drawing */}
          {reads.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                Read from the drawing
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                {reads.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-0.5 min-w-0">
                    <span className="w-36 shrink-0 text-[var(--muted-foreground)] text-xs">{r.label}</span>
                    <span className="font-medium truncate">{r.value}</span>
                    {r.confidence && <ConfidenceBadge level={r.confidence} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Left for you to fill */}
          {manual.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                Left for you to fill · {manual.length} section{manual.length === 1 ? "" : "s"}
              </h3>
              <div className="space-y-1.5">
                {manual.map((m) => (
                  <div key={m.section} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 bg-[var(--background)]">
                    <div className="text-[11px] font-semibold text-[var(--foreground)]">{m.section}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">{m.reason}</div>
                    {m.hints.map((h, i) => (
                      <div key={i} className="flex gap-2 text-xs py-0.5">
                        <span className="w-20 shrink-0 text-[var(--muted-foreground)]">{h.label}</span>
                        <span className="font-medium">{h.value}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
