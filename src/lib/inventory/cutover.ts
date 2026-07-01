/**
 * Inventory go-live cutover.
 *
 * The physical stock was matched as the baseline: all program runs, dispatches
 * and PO receipts dated on or before 29 Jun 2026 are ALREADY reflected in the
 * on-hand balances. From 30 Jun 2026 onward, those three flows drive inventory.
 *
 * So an event only moves stock when its OWN date (run_date / dispatch_date /
 * receipt_date) is >= the cutover. Anything dated earlier is saved to the
 * records but posts NOTHING — and, crucially, is NEVER reversed either, so the
 * baseline postings that already exist for pre-cutover events stay put even if
 * an old record is later edited or deleted.
 *
 * Dates are stored as ISO 'YYYY-MM-DD' strings, so a plain lexical compare is
 * exactly chronological. NEVER wrap in `new Date()` — a timezone shift could
 * bump a 2026-06-30 event back to 2026-06-29 and silently drop its stock move.
 */
export const CUTOVER_DATE = "2026-06-30";

/** True when an event's own date is on/after the cutover and may move stock. */
export function postsInventory(dateStr: string | null | undefined): boolean {
  return !!dateStr && dateStr >= CUTOVER_DATE;
}
