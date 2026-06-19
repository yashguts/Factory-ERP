import type { TransactionType } from "@/lib/supabase/types";

/**
 * Human labels for each inventory transaction type. Single source shared by the
 * Daily Changes feed and the per-item Stock Ledger. (Pure module — safe to
 * import from both server actions and client components.)
 */
export const TXN_LABELS: Record<TransactionType, string> = {
  purchase_in: "Purchase In",
  production_in: "Production In",
  production_out: "Production Out",
  adjustment: "Adjustment",
  transfer: "Transfer",
  scrap: "Scrap",
  dispatch_out: "Dispatch Out",
};

/**
 * The signed stock delta a transaction applied. `inventory_transactions.quantity`
 * is stored RAW (positive); the sign is implied by the type — this mirrors the
 * delta logic in recordTransaction (inventory.ts). Outbound types subtract;
 * `adjustment` is taken as-is (may already be negative); everything else adds.
 */
export function appliedDelta(type: TransactionType, quantity: number): number {
  if (type === "adjustment") return quantity;
  if (type === "production_out" || type === "scrap" || type === "dispatch_out")
    return -Math.abs(quantity);
  return Math.abs(quantity);
}
