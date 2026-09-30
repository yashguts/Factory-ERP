"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface ConfirmDialogProps {
  title: string;
  /** Body of the dialog — string or rich node. */
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "destructive";
  /** Disable buttons + show a spinner on confirm while an action runs. */
  busy?: boolean;
  /** Button to focus when the dialog opens. Unset = focus stays where it was
   *  (the original behaviour). "cancel" makes a reflex Enter the safe answer. */
  initialFocus?: "confirm" | "cancel";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Small Yes/No confirmation modal built on the shared Modal. Use for
 * deliberate actions (marking audited, irreversible toggles) where a plain
 * optimistic click is too easy to trigger by accident.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Yes",
  cancelLabel = "No",
  confirmVariant = "primary",
  busy = false,
  initialFocus,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel} className="max-w-md">
      <div className="space-y-5">
        <div className="text-sm text-[var(--foreground)] leading-relaxed">
          {message}
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
            autoFocus={initialFocus === "cancel"}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={busy}
            autoFocus={initialFocus === "confirm"}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
