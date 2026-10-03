"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DISPATCH_DATE_REASONS,
  DISPATCH_DATE_REASON_OTHER,
  composeDispatchDateReason,
} from "@/lib/jobs/dispatch-date-reason";

function fmtDate(d: string | null): string {
  if (!d) return "— (unset)";
  // d is yyyy-mm-dd; parse as local so the day doesn't shift across timezones.
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * One dialog for the whole Req. Dispatch Date change: pick the new date AND the
 * reason together, then Save. Keeping it in a single modal (instead of editing
 * the date inline and prompting for a reason afterwards) avoids the awkward
 * "change the date, click away, then a prompt appears" two-step — and the row
 * never moves until the change is confirmed.
 *
 * Management requires a reason for every change, picked from a fixed list (so
 * the reasons stay consistent and reportable) with an "Other" escape hatch that
 * takes a free-text remark. Save stays disabled until the date actually differs
 * from the saved one and a valid reason is given.
 */
export function DispatchDateReasonModal({
  jobNumber,
  savedDate,
  onConfirm,
  onCancel,
}: {
  jobNumber: string;
  savedDate: string | null;
  onConfirm: (newDate: string | null, reason: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(savedDate ?? "");
  const [category, setCategory] = useState("");
  const [remark, setRemark] = useState("");

  const newDate = date || null;
  const dateChanged = newDate !== (savedDate ?? null);
  const reason = composeDispatchDateReason(category, remark);
  const isOther = category === DISPATCH_DATE_REASON_OTHER;
  const canSave = dateChanged && !!reason;

  return (
    <Modal title="Change Req. Dispatch Date" size="sm" onClose={onCancel}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted-foreground)]">
          Job <span className="font-mono font-medium text-[var(--foreground)]">{jobNumber}</span>
          {" — currently "}
          <span className="font-medium text-[var(--foreground)]">{fmtDate(savedDate)}</span>.
        </p>

        <div>
          <label className="mb-1 block text-sm font-medium">New date</label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Reason</label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="" disabled>
              Select a reason…
            </option>
            {DISPATCH_DATE_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value={DISPATCH_DATE_REASON_OTHER}>Other (add remark)</option>
          </Select>
        </div>

        {isOther && (
          <div>
            <label className="mb-1 block text-sm font-medium">Remark</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={3}
              placeholder="Describe the reason…"
              className="flex w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm shadow-[var(--shadow-xs)] placeholder:text-[var(--muted-foreground)] hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1 focus:border-[var(--primary)] transition-colors duration-150"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {!dateChanged && (
            <span className="mr-auto text-xs text-[var(--muted-foreground)]">
              Pick a different date to continue.
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSave}
            onClick={() => canSave && reason && onConfirm(newDate, reason)}
          >
            Save Date Change
          </Button>
        </div>
      </div>
    </Modal>
  );
}
