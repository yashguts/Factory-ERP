// The fixed set of reasons the office may give when moving a job's Req.
// Dispatch Date. Management wants these standardised (not free text) so the
// reasons are consistent and reportable on the Status Alerts → History tab.
// "Other" is the escape hatch: it requires a free-text remark instead.
//
// The reason is persisted as plain text in job_date_changes.reason (see
// updateJob): a predefined pick stores its label verbatim; "Other" stores
// `Other: <remark>` so the category is still visible in history while the
// specific explanation is preserved.

export const DISPATCH_DATE_REASONS = [
  "Payment Not Received",
  "Site Not Ready",
  "Short of Technical Team",
  "Client Not Available",
] as const;

export const DISPATCH_DATE_REASON_OTHER = "Other";

export type DispatchDateReason =
  | (typeof DISPATCH_DATE_REASONS)[number]
  | typeof DISPATCH_DATE_REASON_OTHER;

/**
 * Build the reason string stored on the date-change log from the chosen
 * category and (for "Other") the typed remark. Returns null when the input is
 * incomplete — a predefined category must be one of the fixed options, and
 * "Other" must carry a non-empty remark — so callers can gate the Save button.
 */
export function composeDispatchDateReason(
  category: string,
  remark: string,
): string | null {
  if (category === DISPATCH_DATE_REASON_OTHER) {
    const trimmed = remark.trim();
    return trimmed ? `Other: ${trimmed}` : null;
  }
  return (DISPATCH_DATE_REASONS as readonly string[]).includes(category)
    ? category
    : null;
}
