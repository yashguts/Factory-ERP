"use server";

import { createClient } from "@/lib/supabase/server";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import type { JobStatus, JobStatusChange } from "@/lib/supabase/types";
import { alertKind, reasonRequired, type StatusAlertKind } from "@/lib/jobs/status-alert";

/* ------------------------------------------------------------------ *
 * Job status-change alerting + audit history (047_job_status_changes).
 *
 * Sales/CRM move a job through new -> in_production -> hold per client +
 * payment clearance. Every change is logged here (who/when/why/from->to);
 * the four factory-critical transitions raise an alert that stays OPEN
 * until acknowledged. changeJobStatus() is the enforced choke-point used by
 * the status dropdowns (requires a reason for Hold / revert-to-New).
 * ------------------------------------------------------------------ */

export interface ChangeStatusResult {
  ok: boolean;
  error?: string;
  unchanged?: boolean;
  alertKind?: StatusAlertKind | null;
}

/** The single enforced entry point for a status change (the status dropdowns). */
export async function changeJobStatus(
  jobId: string,
  toStatus: JobStatus,
  operator?: string | null,
  reason?: string | null,
): Promise<ChangeStatusResult> {
  const supabase = await createClient();

  const { data: cur, error: readErr } = await supabase
    .from("jobs").select("status").eq("id", jobId).maybeSingle();
  if (readErr || !cur) return { ok: false, error: readErr?.message ?? "Job not found" };

  const from = (cur.status as JobStatus) ?? null;
  if (from === toStatus) return { ok: true, unchanged: true };

  const cleanReason = reason?.trim() || null;
  if (reasonRequired(from, toStatus) && !cleanReason) {
    return { ok: false, error: "A reason is required to change a job's status." };
  }
  const kind = alertKind(from, toStatus);

  const { error: updErr } = await supabase.from("jobs").update({ status: toStatus }).eq("id", jobId);
  if (updErr) return { ok: false, error: updErr.message };

  const { error: insErr } = await supabase.from("job_status_changes").insert({
    job_id: jobId, from_status: from, to_status: toStatus,
    alert_kind: kind, reason: cleanReason, changed_by: operator ?? null,
  });
  if (insErr) return { ok: false, error: insErr.message };

  revalidateTag("jobs");
  revalidateTag("status-alerts");
  revalidatePath("/jobs");
  revalidatePath("/jobs/status-alerts");
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, alertKind: kind };
}

export interface OpenStatusAlertRow {
  id: string;            // the change row id (acknowledge target)
  job_id: string;
  job_number: string;
  customer_name: string | null;
  from_status: JobStatus | null;
  to_status: JobStatus;
  alert_kind: StatusAlertKind;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
  requirement_dispatch_date: string | null;
  current_status: JobStatus; // the job's status now (may have moved on since)
}

const _getOpenStatusAlertsUncached = async (): Promise<OpenStatusAlertRow[]> => {
  const supabase = createCacheClient();
  const { data } = await supabase
    .from("job_status_changes")
    .select(
      "id, job_id, from_status, to_status, alert_kind, reason, changed_by, changed_at, jobs(job_number, customer_name, requirement_dispatch_date, status)",
    )
    .not("alert_kind", "is", null)
    .is("acknowledged_at", null)
    .order("changed_at", { ascending: false });
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const j = (Array.isArray(row.jobs) ? row.jobs[0] : row.jobs) as
      | { job_number: string; customer_name: string | null; requirement_dispatch_date: string | null; status: JobStatus }
      | null;
    return {
      id: row.id as string, job_id: row.job_id as string,
      job_number: j?.job_number ?? "—", customer_name: j?.customer_name ?? null,
      from_status: (row.from_status as JobStatus) ?? null, to_status: row.to_status as JobStatus,
      alert_kind: row.alert_kind as StatusAlertKind, reason: (row.reason as string) ?? null,
      changed_by: (row.changed_by as string) ?? null, changed_at: row.changed_at as string,
      requirement_dispatch_date: j?.requirement_dispatch_date ?? null,
      current_status: (j?.status as JobStatus) ?? (row.to_status as JobStatus),
    };
  });
};

/** Every OPEN (unacknowledged) status alert — global alerts page + per-job chips. */
export const getOpenStatusAlerts = unstable_cache(
  _getOpenStatusAlertsUncached,
  ["open-status-alerts"],
  { revalidate: 120, tags: ["jobs", "status-alerts"] },
);

/** Acknowledge an open alert (closed-loop: who saw/actioned it + when). */
export async function acknowledgeStatusAlert(
  changeId: string,
  operator?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("job_status_changes")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: operator ?? "unknown" })
    .eq("id", changeId)
    .is("acknowledged_at", null);
  if (error) return { ok: false, error: error.message };
  revalidateTag("status-alerts");
  revalidatePath("/jobs/status-alerts");
  revalidatePath("/jobs");
  return { ok: true };
}

/**
 * Unified, immutable change history — every STATUS change (job_status_changes,
 * acknowledged or not) and every Req. Dispatch DATE change (job_date_changes),
 * merged newest-first. Nothing is ever deleted by acknowledging: the alerts
 * page's History tab reads this so the office can trace who moved what, when
 * and why. Baseline backfill rows (from_status null) are skipped — they mark
 * table creation, not a real change.
 */
export interface ChangeHistoryRow {
  id: string;
  kind: "status" | "date";
  job_id: string;
  job_number: string;
  customer_name: string | null;
  /** Status labels for kind=status; ISO dates (or null = unset) for kind=date. */
  from: string | null;
  to: string | null;
  alert_kind: StatusAlertKind | null;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

const _getChangeHistoryUncached = async (): Promise<ChangeHistoryRow[]> => {
  const supabase = createCacheClient();
  const [statusRes, dateRes] = await Promise.all([
    supabase
      .from("job_status_changes")
      .select(
        "id, job_id, from_status, to_status, alert_kind, reason, changed_by, changed_at, acknowledged_at, acknowledged_by, jobs(job_number, customer_name)",
      )
      .not("from_status", "is", null)
      .order("changed_at", { ascending: false })
      .limit(400),
    supabase
      .from("job_date_changes")
      .select("id, job_id, from_date, to_date, reason, changed_by, changed_at, jobs(job_number, customer_name)")
      .order("changed_at", { ascending: false })
      .limit(400),
  ]);

  const jobOf = (row: Record<string, unknown>) =>
    (Array.isArray(row.jobs) ? row.jobs[0] : row.jobs) as
      | { job_number: string; customer_name: string | null }
      | null;

  const rows: ChangeHistoryRow[] = [];
  for (const r of statusRes.data ?? []) {
    const row = r as Record<string, unknown>;
    const j = jobOf(row);
    rows.push({
      id: row.id as string, kind: "status", job_id: row.job_id as string,
      job_number: j?.job_number ?? "—", customer_name: j?.customer_name ?? null,
      from: (row.from_status as string) ?? null, to: (row.to_status as string) ?? null,
      alert_kind: (row.alert_kind as StatusAlertKind) ?? null,
      reason: (row.reason as string) ?? null,
      changed_by: (row.changed_by as string) ?? null, changed_at: row.changed_at as string,
      acknowledged_at: (row.acknowledged_at as string) ?? null,
      acknowledged_by: (row.acknowledged_by as string) ?? null,
    });
  }
  for (const r of dateRes.data ?? []) {
    const row = r as Record<string, unknown>;
    const j = jobOf(row);
    rows.push({
      id: row.id as string, kind: "date", job_id: row.job_id as string,
      job_number: j?.job_number ?? "—", customer_name: j?.customer_name ?? null,
      from: (row.from_date as string) ?? null, to: (row.to_date as string) ?? null,
      alert_kind: null,
      reason: (row.reason as string) ?? null,
      changed_by: (row.changed_by as string) ?? null, changed_at: row.changed_at as string,
      acknowledged_at: null, acknowledged_by: null,
    });
  }
  rows.sort((a, b) => b.changed_at.localeCompare(a.changed_at));
  return rows.slice(0, 500);
};

export const getChangeHistory = unstable_cache(
  _getChangeHistoryUncached,
  ["job-change-history"],
  { revalidate: 120, tags: ["jobs", "status-alerts"] },
);

/** Full ordered status history for one job (the detail timeline). Always fresh. */
export async function getJobStatusHistory(jobId: string): Promise<JobStatusChange[]> {
  const supabase = createCacheClient();
  const { data } = await supabase
    .from("job_status_changes")
    .select("*")
    .eq("job_id", jobId)
    .order("changed_at", { ascending: false });
  return (data ?? []) as JobStatusChange[];
}
