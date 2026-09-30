/**
 * Site clearance from Construction (the LT AMC Construction module).
 *
 * When a site is ready, a Construction supervisor or manager gives "dispatch
 * clearance"; the cx_record_clearance RPC (migration 069) records it as a row
 * in cx_dispatch_clearances against the ERP job. A CX Manager or admin can
 * later revoke it; cx_record_clearance_revocation (migration 075) stamps
 * revoked_at on that row. A job is cleared while at least one row is NOT
 * revoked; with no rows clearance is pending, and with only revoked rows the
 * last clearance was revoked (pending again, plus a notice to acknowledge).
 *
 * Owner rules (2026-09-30): dispatching a job that isn't cleared shows a SOFT
 * Yes/No warning. It never blocks a dispatch, and a failed check asks the same
 * question rather than stopping the save. A revocation reaches the ERP "just
 * as a notification": informational, never a block.
 *
 * Pure presentation + decision helpers. No imports on purpose, so
 * scripts/verify-site-clearance.ts can run this file directly under Node.
 */

export type ClearanceScope = "first" | "first_and_second" | "full";

/** One clearance row, as the server actions return it. */
export interface SiteClearance {
  id: string;
  job_id: string;
  /** Construction's clearance code, e.g. "DCL-12" (null until it's sent). */
  code: string | null;
  recommended_scope: ClearanceScope | null;
  note: string | null;
  cleared_by: string | null;
  cleared_at: string | null;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  /** Set when Construction revoked this clearance; null = in force. */
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  /** The factory office has seen the revocation notice. */
  revoke_acknowledged_at: string | null;
  revoke_acknowledged_by: string | null;
}

/** A server read of a job's clearances. `ok: false` only when the read itself
 *  failed, so callers can tell "none given" from "couldn't check". */
export type SiteClearanceRead =
  | { ok: true; clearances: SiteClearance[] }
  | { ok: false; error: string };

export type SiteClearanceStatus =
  /** At least one clearance in force: the latest of those, and how many. */
  | { state: "given"; latest: SiteClearance; count: number }
  /** Nothing in force, but Construction revoked a clearance: the latest revoked. */
  | { state: "revoked"; latest: SiteClearance }
  | { state: "pending" }
  /** The read failed. Warn as if pending; never block. */
  | { state: "unknown" };

export const CLEARANCE_SCOPE_LABEL: Record<ClearanceScope, string> = {
  first: "First phase",
  first_and_second: "First & second phase",
  full: "Complete material",
};

/** Label for a recommended scope; null when the scope is missing or unknown. */
export function clearanceScopeLabel(scope: string | null | undefined): string | null {
  if (!scope || !Object.prototype.hasOwnProperty.call(CLEARANCE_SCOPE_LABEL, scope)) return null;
  return CLEARANCE_SCOPE_LABEL[scope as ClearanceScope];
}

/** When the clearance was given: Construction's own timestamp, else when the
 *  ERP recorded it. */
function clearedWhen(c: Pick<SiteClearance, "cleared_at" | "created_at">): string {
  return c.cleared_at ?? c.created_at;
}

/** When it was revoked (falls back to when the ERP recorded the row). */
function revokedWhen(c: Pick<SiteClearance, "revoked_at" | "created_at">): string {
  return c.revoked_at ?? c.created_at;
}

function timeOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** The row with the latest `when`, whatever order the rows arrive in. */
function latestBy(rows: readonly SiteClearance[], when: (c: SiteClearance) => string): SiteClearance {
  let latest = rows[0];
  for (const r of rows) {
    if (timeOf(when(r)) > timeOf(when(latest))) latest = r;
  }
  return latest;
}

/** Given while any clearance is in force (not revoked); revoked when every row
 *  is revoked; pending when there are no rows at all. */
export function siteClearanceStatus(
  rows: readonly SiteClearance[] | null | undefined,
): SiteClearanceStatus {
  if (!rows || rows.length === 0) return { state: "pending" };
  const inForce = rows.filter((r) => !r.revoked_at);
  if (inForce.length > 0) {
    return { state: "given", latest: latestBy(inForce, clearedWhen), count: inForce.length };
  }
  return { state: "revoked", latest: latestBy(rows, revokedWhen) };
}

/** Status from a server read: a failed read is "unknown", not "pending". */
export function siteClearanceStatusOf(read: SiteClearanceRead): SiteClearanceStatus {
  return read.ok ? siteClearanceStatus(read.clearances) : { state: "unknown" };
}

/** Should the factory be asked before dispatching? Yes unless clearance is
 *  known to be given (pending, revoked AND a failed check all ask). */
export function warnBeforeDispatch(status: SiteClearanceStatus): boolean {
  return status.state !== "given";
}

/** Is there a revocation notice the factory hasn't acknowledged yet? */
export function revocationNeedsAck(status: SiteClearanceStatus | null | undefined): boolean {
  return status?.state === "revoked" && !status.latest.revoke_acknowledged_at;
}

/** Date for the status line, in the same style as the Dispatches panel's
 *  other dates. Falls back to the raw date part if the value won't parse. */
export function formatClearanceDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return new Date(t).toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** The one-line status shown on the job's Dispatches panel. */
export function siteClearanceLine(
  status: SiteClearanceStatus,
  formatDate: (iso: string) => string = formatClearanceDate,
): string {
  if (status.state === "pending") return "Site clearance (Construction): pending";
  if (status.state === "unknown") return "Site clearance (Construction): couldn't check";
  if (status.state === "revoked") {
    const c = status.latest;
    let line = `Site clearance (Construction): revoked ${formatDate(revokedWhen(c))}`;
    const by = c.revoked_by?.trim();
    if (by) line += ` by ${by}`;
    const reason = c.revoke_reason?.trim();
    if (reason) line += ` — ${reason}`;
    if (c.revoke_acknowledged_at) {
      const who = c.revoke_acknowledged_by?.trim();
      line += who ? ` (acknowledged by ${who})` : " (acknowledged)";
    }
    return line;
  }
  const { latest, count } = status;
  const parts = [`Site clearance given ${formatDate(clearedWhen(latest))}`];
  const scope = clearanceScopeLabel(latest.recommended_scope);
  if (scope) parts.push(scope);
  const by = latest.cleared_by?.trim();
  if (by) parts.push(`by ${by}`);
  return parts.join(" · ") + (count > 1 ? ` (${count} clearances)` : "");
}

/** The pop-up shown before dispatching a job that isn't cleared. */
export const SITE_CLEARANCE_PROMPT_TITLE = "Site clearance pending";

export function siteClearancePromptMessage(
  jobNumber: string,
  status?: SiteClearanceStatus | null,
  formatDate: (iso: string) => string = formatClearanceDate,
): string {
  if (status?.state === "revoked") {
    return `Site clearance is pending at the Construction end for Job ${jobNumber} — the last clearance was revoked on ${formatDate(revokedWhen(status.latest))}. Do you want to continue?`;
  }
  return `Site clearance is pending at the Construction end for Job ${jobNumber}. Do you want to continue?`;
}
