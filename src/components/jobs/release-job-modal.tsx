"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  CRM_RELEASE_REASONS,
  CRM_RELEASE_REASON_OTHER,
  composeCrmReleaseReason,
} from "@/lib/jobs/crm-lock";

/**
 * "Release job" dialog (owner rule, 2026-11-19). While a job is in the Factory
 * ERP its CRM refuses every drawing / SMR change; releasing is the factory's
 * deliberate "go ahead and change it". It stops production on the job (Hold),
 * so a reason is mandatory — picked from a fixed list so reasons stay
 * consistent, with an "Other" escape hatch that needs a typed remark.
 */
export function ReleaseJobModal({
  jobNumber,
  alreadyOnHold,
  busy,
  onConfirm,
  onCancel,
}: {
  jobNumber: string;
  /** The job is already on Hold, so releasing won't change its status. */
  alreadyOnHold?: boolean;
  /** The release is being saved — keep the dialog open but inert. */
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState("");
  const [remark, setRemark] = useState("");

  const reason = composeCrmReleaseReason(category, remark);
  const isOther = category === CRM_RELEASE_REASON_OTHER;
  const canSave = !!reason && !busy;

  return (
    <Modal title="Release job to the CRM" size="sm" onClose={busy ? () => {} : onCancel}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted-foreground)]">
          Job <span className="font-mono font-medium text-[var(--foreground)]">{jobNumber}</span>
          {" — its drawing and site measurement report (SMR) are locked in the CRM while the job is in the factory."}
        </p>

        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="font-medium">What releasing does</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>
              {alreadyOnHold
                ? "The job is already on Hold and stays on Hold."
                : "The job goes on Hold here, so the factory stops working on it."}
            </li>
            <li>The CRM team can change the drawing and the SMR again.</li>
            <li>
              When the new drawing is ready, upload the new GAD here and press{" "}
              <span className="font-medium">Lock again</span>. Taking the job off Hold is a separate step.
            </li>
          </ul>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Reason</label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} autoFocus disabled={busy}>
            <option value="" disabled>
              Select a reason…
            </option>
            {CRM_RELEASE_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value={CRM_RELEASE_REASON_OTHER}>Other (add remark)</option>
          </Select>
        </div>

        {isOther && (
          <div>
            <label className="mb-1 block text-sm font-medium">Remark</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={3}
              disabled={busy}
              placeholder="Describe the reason…"
              className="flex w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm shadow-[var(--shadow-xs)] placeholder:text-[var(--muted-foreground)] hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1 focus:border-[var(--primary)] transition-colors duration-150"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSave} onClick={() => canSave && reason && onConfirm(reason)}>
            {busy ? "Releasing…" : "Release job"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
