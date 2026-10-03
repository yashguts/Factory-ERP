"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
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
 * Asked whenever the Req. Dispatch Date is moved. Management requires a reason
 * for every change, picked from a fixed list (so the reasons stay consistent
 * and reportable) with an "Other" escape hatch that takes a free-text remark.
 * The composed reason is handed to onConfirm; closing or Cancel reverts the
 * date edit.
 */
export function DispatchDateReasonModal({
  jobNumber,
  fromDate,
  toDate,
  onConfirm,
  onCancel,
}: {
  jobNumber: string;
  fromDate: string | null;
  toDate: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState("");
  const [remark, setRemark] = useState("");

  const reason = composeDispatchDateReason(category, remark);
  const isOther = category === DISPATCH_DATE_REASON_OTHER;

  return (
    <Modal title="Reason for changing Req. Dispatch Date" size="sm" onClose={onCancel}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted-foreground)]">
          Job <span className="font-mono font-medium text-[var(--foreground)]">{jobNumber}</span>
          {" — moving "}
          <span className="font-medium text-[var(--foreground)]">{fmtDate(fromDate)}</span>
          {" → "}
          <span className="font-medium text-[var(--foreground)]">{fmtDate(toDate)}</span>.
          A reason is required.
        </p>

        <div>
          <label className="mb-1 block text-sm font-medium">Reason</label>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            autoFocus
          >
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
              autoFocus
              placeholder="Describe the reason…"
              className="flex w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm shadow-[var(--shadow-xs)] placeholder:text-[var(--muted-foreground)] hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1 focus:border-[var(--primary)] transition-colors duration-150"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!reason}
            onClick={() => reason && onConfirm(reason)}
          >
            Save Date Change
          </Button>
        </div>
      </div>
    </Modal>
  );
}
