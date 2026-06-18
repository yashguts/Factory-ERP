import type { BadgeVariant } from "@/components/ui/badge";
import type { PurchaseOrderStatus } from "@/lib/supabase/types";

/**
 * A purchase order carries TWO orthogonal statuses that the UI must not conflate:
 *  - ORDER status   — the order's lifecycle: Draft → Ordered → Closed / Cancelled.
 *  - RECEIPT status — how much has physically arrived: Pending → Partial → Received.
 *
 * The stored `purchase_orders.status` overloads both ("received" = ordered AND
 * fully received), so these helpers derive the two clean axes from the stored
 * status + the line-receipt aggregates. No schema change.
 */
export interface StatusBadge {
  label: string;
  variant: BadgeVariant;
}

export interface ReceiptInput {
  status: PurchaseOrderStatus;
  lineCount: number;
  /** Lines fully received (received_qty ≥ qty). */
  receivedLines: number;
  /** Any quantity received at all (catches a single line received in part). */
  anyReceived: boolean;
}

/** Order lifecycle. A fully-received PO reads "Closed" — the order is done. */
export function orderStatus(status: PurchaseOrderStatus): StatusBadge {
  switch (status) {
    case "draft":
      return { label: "Draft", variant: "neutral" };
    case "ordered":
      return { label: "Ordered", variant: "blue" };
    case "received":
      return { label: "Closed", variant: "green" };
    case "cancelled":
      return { label: "Cancelled", variant: "red" };
    default:
      return { label: String(status), variant: "neutral" };
  }
}

export function orderStatusKey(
  status: PurchaseOrderStatus,
): "draft" | "ordered" | "closed" | "cancelled" {
  return status === "received" ? "closed" : status;
}

/** Goods-receipt progress. Returns null for draft/cancelled (not applicable). */
export function receiptStatus(input: ReceiptInput): StatusBadge | null {
  const { status, lineCount, receivedLines, anyReceived } = input;
  if (status === "draft" || status === "cancelled") return null;
  if (status === "received") return { label: "Received", variant: "green" };
  if (anyReceived) {
    const detail = receivedLines > 0 && lineCount > 0 ? ` · ${receivedLines}/${lineCount}` : "";
    return { label: `Partial${detail}`, variant: "amber" };
  }
  return { label: "Pending", variant: "neutral" };
}

export function receiptStatusKey(
  input: Pick<ReceiptInput, "status" | "anyReceived">,
): "none" | "pending" | "partial" | "received" {
  const { status, anyReceived } = input;
  if (status === "draft" || status === "cancelled") return "none";
  if (status === "received") return "received";
  return anyReceived ? "partial" : "pending";
}
