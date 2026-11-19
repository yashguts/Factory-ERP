"use server";

import { createClient } from "@/lib/supabase/server";
import { changeJobStatus } from "@/lib/actions/job-status";
import type { CrmLockState } from "@/lib/jobs/crm-lock";
import { cleanName, logEvents, readJob, setCrmLock, touch } from "@/lib/jobs/crm-lock-server";

/**
 * CRM drawing / SMR lock — the three buttons the browser may press (Lock now,
 * Lock again, Release job). The CRM call itself, and the two helpers that are
 * NOT meant to be callable from the browser (the delete-path release and the
 * bulk lock), live in lib/jobs/crm-lock-server.ts: every export of a
 * "use server" file is a public endpoint, so only these three belong here.
 */

export type CrmLockResult =
  | { ok: true; state: CrmLockState; message: string; warning?: string }
  | { ok: false; error: string };

/** Shared body of "lock" (new job / Lock now) and "lock again" (after a release). */
async function lockOne(
  jobId: string,
  operator: string | null | undefined,
  allowReleased: boolean,
): Promise<CrmLockResult> {
  const supabase = await createClient();
  const job = await readJob(supabase, jobId);
  if (!job) return { ok: false, error: "Job not found." };
  const by = cleanName(operator);

  // A released job is only ever re-locked on purpose ("Lock again") — never by
  // the create hook, a retry or the bulk backfill.
  if (job.crm_lock_state === "released" && !allowReleased) {
    return { ok: false, error: 'This job is released to the CRM. Use "Lock again" on the job to lock it.' };
  }

  const call = await setCrmLock(job.job_number, true, by ?? "Factory ERP", null);

  if (call.status === "NOT_CRM") {
    if (job.crm_lock_state !== "na") {
      await supabase.from("jobs").update({ crm_lock_state: "na" }).eq("id", jobId);
    }
    await logEvents(supabase, [
      { job_id: jobId, action: "lock", reason: null, performed_by: by, crm: null, ok: true, detail: call.message },
    ]);
    touch(jobId);
    return { ok: true, state: "na", message: call.message };
  }

  if (!call.ok) {
    // State is left alone on purpose: a new job stays 'pending' (the UI offers
    // "Lock now"), and a job the CRM already holds locked is not downgraded
    // just because one re-check could not get through.
    await logEvents(supabase, [
      { job_id: jobId, action: "lock", reason: null, performed_by: by, crm: call.crm, ok: false, detail: call.message },
    ]);
    touch(jobId);
    // Name the button the operator will actually see: a released job offers
    // "Lock again", a never-confirmed one offers "Lock now".
    const button = job.crm_lock_state === "released" ? "Lock again" : "Lock now";
    const tail =
      call.status === "NOT_FOUND"
        ? ` Its drawings and SMR are NOT locked there. Check the job number, then press ${button} on the job.`
        : ` The CRM lock is not confirmed yet — press ${button} on the job to try again.`;
    return { ok: false, error: call.message + tail };
  }

  const { error } = await supabase
    .from("jobs")
    .update({ crm_lock_state: "locked", crm_lock_synced_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) {
    await logEvents(supabase, [
      {
        job_id: jobId, action: "lock", reason: null, performed_by: by, crm: call.crm, ok: false,
        detail: `CRM locked, ERP could not record it: ${error.message}`,
      },
    ]);
    return {
      ok: false,
      error: `The ${call.crm} locked the job, but the Factory ERP could not record it (${error.message}). Press the lock button again.`,
    };
  }

  await logEvents(supabase, [
    { job_id: jobId, action: "lock", reason: null, performed_by: by, crm: call.crm, ok: true, detail: call.message },
  ]);
  touch(jobId);
  return { ok: true, state: "locked", message: call.message };
}

/**
 * Lock a job's drawings + SMR in its CRM — called right after a job is created
 * and by the "Lock now" retry. On success the job becomes 'locked'; if the CRM
 * can't be reached or doesn't have the job it stays 'pending' and the returned
 * error says so. A number that belongs to neither CRM becomes 'na'.
 */
export async function lockJobInCrm(jobId: string, operator?: string | null): Promise<CrmLockResult> {
  return lockOne(jobId, operator, false);
}

/**
 * "Lock again" after a release: CRM first, then the ERP state. The release
 * stamp (who / when / why) is deliberately kept as history, and the job stays
 * on Hold — taking it off Hold is a separate, deliberate step.
 */
export async function relockJob(jobId: string, operator?: string | null): Promise<CrmLockResult> {
  return lockOne(jobId, operator, true);
}

/**
 * "Release job": let the CRM change this job's drawing / SMR again.
 *
 * Order matters. The CRM is released FIRST and must confirm it — otherwise
 * the ERP would show "Released" while the CRM still refuses every change.
 * Only then does the ERP record the release and move the job to Hold (the
 * factory must not keep building against a drawing that is about to change).
 * Every step is idempotent, so pressing Release again repairs a half-done one.
 */
export async function releaseJob(
  jobId: string,
  reason: string,
  operator?: string | null,
): Promise<CrmLockResult> {
  const cleanReason = reason?.trim();
  if (!cleanReason) return { ok: false, error: "A reason is required to release a job." };

  const supabase = await createClient();
  const job = await readJob(supabase, jobId);
  if (!job) return { ok: false, error: "Job not found." };
  if (job.crm_lock_state === "na") {
    return { ok: false, error: `"${job.job_number}" is not a CRM job number, so there is nothing to release.` };
  }
  const by = cleanName(operator);

  const call = await setCrmLock(job.job_number, false, by ?? "Factory ERP", cleanReason);
  if (!call.ok) {
    await logEvents(supabase, [
      { job_id: jobId, action: "release", reason: cleanReason, performed_by: by, crm: call.crm, ok: false, detail: call.message },
    ]);
    const tail =
      call.status === "NOT_FOUND"
        ? " There is nothing to release there, so the job was not changed."
        : " The job was NOT released and has not been put on Hold.";
    return { ok: false, error: call.message + tail };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("jobs")
    .update({
      crm_lock_state: "released",
      crm_lock_synced_at: now,
      crm_released_at: now,
      crm_released_by: by ?? "unknown",
      crm_release_reason: cleanReason,
    })
    .eq("id", jobId);
  if (error) {
    await logEvents(supabase, [
      {
        job_id: jobId, action: "release", reason: cleanReason, performed_by: by, crm: call.crm, ok: false,
        detail: `CRM released, ERP could not record it: ${error.message}`,
      },
    ]);
    return {
      ok: false,
      error: `The ${call.crm} released the job, but the Factory ERP could not record it (${error.message}). Press Release job again.`,
    };
  }

  // Through the normal status path so the Hold is in the status history and
  // raises the usual Hold alert. No-op when the job is already on Hold.
  const held = await changeJobStatus(
    jobId,
    "hold",
    by,
    `Released to CRM for drawing/SMR change — ${cleanReason}`,
  );

  await logEvents(supabase, [
    {
      job_id: jobId, action: "release", reason: cleanReason, performed_by: by, crm: call.crm, ok: true,
      detail: held.ok ? call.message : `${call.message} Could not move the job to Hold: ${held.error ?? "unknown error"}`,
    },
  ]);
  touch(jobId);
  return {
    ok: true,
    state: "released",
    message: call.message,
    warning: held.ok
      ? undefined
      : `The job is released, but it could not be moved to Hold (${held.error ?? "unknown error"}). Put it on Hold from the status dropdown.`,
  };
}
