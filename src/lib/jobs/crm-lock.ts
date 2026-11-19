// CRM drawing / SMR lock — shared constants (migration 079).
//
// Lives outside lib/actions/crm-lock.ts because a "use server" file may only
// export async functions; the modal, the job pages and the server actions all
// need these same strings.

/**
 * What the ERP last knew about a job's lock in its CRM.
 *  - pending:  should be locked, but the CRM has not confirmed it yet.
 *  - locked:   the CRM confirmed the lock.
 *  - released: the factory released it — the CRM can change drawing + SMR.
 *  - na:       the job number belongs to neither CRM; nothing to lock.
 */
export type CrmLockState = "pending" | "locked" | "released" | "na";

/** Shown wherever a released job is asked to leave Hold. */
export const CRM_RELEASED_HOLD_MESSAGE =
  "This job is released to the CRM. Lock it again before taking it off Hold.";

/** Shown (as a non-blocking warning) when a new job's CRM lock could not be confirmed. */
export const CRM_LOCK_UNCONFIRMED_MESSAGE =
  "Job created, but the CRM lock is not confirmed yet — open the job and press Lock now.";

/** Recorded on the CRM lock row when the job is deleted from the ERP. */
export const CRM_RELEASE_REASON_DELETED = "Job deleted from the Factory ERP";

// Fixed list (not free text) so release reasons stay consistent and
// reportable, same idea as the Req. Dispatch Date reasons. "Other" is the
// escape hatch and requires a typed remark.
export const CRM_RELEASE_REASONS = [
  "Drawing change",
  "Site measurement (SMR) change",
  "Customer change request",
  "Design correction",
] as const;

export const CRM_RELEASE_REASON_OTHER = "Other";

/**
 * Build the stored release reason from the picked category and (for "Other")
 * the typed remark. Null while the input is incomplete, so the modal can gate
 * its button on it.
 */
export function composeCrmReleaseReason(category: string, remark: string): string | null {
  if (category === CRM_RELEASE_REASON_OTHER) {
    const trimmed = remark.trim();
    return trimmed ? `Other: ${trimmed}` : null;
  }
  return (CRM_RELEASE_REASONS as readonly string[]).includes(category) ? category : null;
}
