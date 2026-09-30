/**
 * Site clearance from Construction (the LT AMC Construction module).
 *
 * When a site is ready, a Construction supervisor or manager gives "dispatch
 * clearance"; the cx_record_clearance RPC (migration 069) records it as a row
 * in cx_dispatch_clearances against the ERP job. A job with at least one row
 * is cleared; none means clearance is still pending at the Construction end.
 *
 * Owner rule (2026-09-30): dispatching a job that isn't cleared shows a SOFT
 * Yes/No warning. It never blocks a dispatch, and a failed check asks the same
 * question rather than stopping the save.
 *
 * Pure presentation + decision helpers. No imports on purpose, so
 * scripts/verify-site-clearance.ts can run this file directly under Node.
 */

export type ClearanceScope = "first" | "first_and_second" | "full";

/** One clearance row, as the server actions return it. */
export interface SiteClearance {
  id: string;
  job_id: string;
  recommended_scope: ClearanceScope | null;
  note: string | null;
  cleared_by: string | null;
  cleared_at: string | null;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

/** A server read of a job's clearances. `ok: false` only when the read itself
 *  failed, so callers can tell "none given" from "couldn't check". */
export type SiteClearanceRead =
  | { ok: true; clearances: SiteClearance[] }
  | { ok: false; error: string };

export type SiteClearanceStatus =
  | { state: "given"; latest: SiteClearance; count: number }
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

function timeOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Pending when there are no rows; otherwise given, with the latest clearance
 *  (by when it was given, whatever order the rows arrive in) and the count. */
export function siteClearanceStatus(
  rows: readonly SiteClearance[] | null | undefined,
): SiteClearanceStatus {
  if (!rows || rows.length === 0) return { state: "pending" };
  let latest = rows[0];
  for (const r of rows) {
    if (timeOf(clearedWhen(r)) > timeOf(clearedWhen(latest))) latest = r;
  }
  return { state: "given", latest, count: rows.length };
}

/** Status from a server read: a failed read is "unknown", not "pending". */
export function siteClearanceStatusOf(read: SiteClearanceRead): SiteClearanceStatus {
  return read.ok ? siteClearanceStatus(read.clearances) : { state: "unknown" };
}

/** Should the factory be asked before dispatching? Yes unless clearance is
 *  known to be given (pending AND a failed check both ask). */
export function warnBeforeDispatch(status: SiteClearanceStatus): boolean {
  return status.state !== "given";
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

export function siteClearancePromptMessage(jobNumber: string): string {
  return `Site clearance is pending at the Construction end for Job ${jobNumber}. Do you want to continue?`;
}
