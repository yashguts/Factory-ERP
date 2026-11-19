import { createClient as createCrmClient } from "@supabase/supabase-js";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ricardoKeyOf } from "@/lib/ricardo/job-number";
import { ltCrmKeyOf } from "@/lib/ltcrm/job-number";
import type { CrmName } from "@/lib/actions/crm-stage";
import { CRM_RELEASE_REASON_DELETED, type CrmLockState } from "@/lib/jobs/crm-lock";

/**
 * CRM drawing / SMR lock (owner rule, 2026-11-19; migration 079).
 *
 * Once a job is in the Factory ERP the factory is building against its drawing
 * and site measurement report, so its CRM (LT Elevator or Ricardo, picked by
 * the job-number format — same routing as the production gate in crm-stage.ts)
 * must refuse every drawing / SMR change until the factory releases the job
 * here. The real enforcement is a trigger in each CRM database; this file is
 * the ERP's switch for it — the secret-gated `erp_set_job_locks` RPC — plus the
 * ERP's own memory of what it told the CRM (jobs.crm_lock_state).
 *
 * This is the ERP's only WRITE into another system, so every call is uncached,
 * time-boxed and fails CLOSED: anything other than the CRM's explicit
 * LOCKED / RELEASED answer leaves the ERP state as it was, and the attempt is
 * logged in job_crm_lock_events either way.
 *
 * NOT a "use server" file on purpose: every export of one is an endpoint the
 * browser can call. The three buttons (Lock now / Lock again / Release job)
 * are the actions in lib/actions/crm-lock.ts; the delete-path release and the
 * bulk lock here are only ever called from other server code. Never import
 * this module from a client component.
 */

const CALL_TIMEOUT_MS = 8000;
const BULK_CHUNK = 200;

type CrmLockStatus = "LOCKED" | "RELEASED" | "NOT_FOUND" | "NOT_CRM" | "UNAVAILABLE";

export interface CrmLockCall {
  ok: boolean;
  status: CrmLockStatus;
  crm: CrmName | null;
  /** Ready-to-show sentence explaining the outcome. */
  message: string;
}

export interface CrmBulkLockResult {
  ok: boolean;
  /** Jobs considered (released jobs are never re-locked by the bulk call). */
  total: number;
  locked: number;
  /** In the ERP but the CRM has no such job — left 'pending'. */
  notFound: number;
  /** CRM unreachable / unexpected answer — left as they were. */
  failed: number;
  /** Number belongs to neither CRM — set to 'na'. */
  notCrm: number;
  skippedReleased: number;
  problems: { job_number: string; message: string }[];
}

// The CRM's erp_set_job_locks REQUIRES "key" and "locked" on every item and a
// non-empty "reason" whenever locked is false (it raises 22023 otherwise, which
// fails the whole batch). All fields are mandatory here so no caller can build
// an item without them.
interface WireItem {
  key: string;
  locked: boolean;
  by: string | null;
  reason: string | null;
}

interface WireRow {
  key: string;
  status: "LOCKED" | "RELEASED" | "NOT_FOUND";
  is_locked: boolean;
}

function crmEnv(crm: CrmName): { url?: string; anonKey?: string; secret?: string } {
  return crm === "LT Elevator CRM"
    ? {
        url: process.env.LTCRM_SUPABASE_URL,
        anonKey: process.env.LTCRM_SUPABASE_ANON_KEY,
        secret: process.env.LTCRM_ERP_SECRET,
      }
    : {
        url: process.env.RICARDO_SUPABASE_URL,
        anonKey: process.env.RICARDO_SUPABASE_ANON_KEY,
        secret: process.env.RICARDO_ERP_SECRET,
      };
}

/** Which CRM owns this job number, and under which key. LT first, then Ricardo. */
function routeOf(jobNumber: string | null | undefined): { crm: CrmName; key: string } | null {
  const ltKey = ltCrmKeyOf(jobNumber);
  if (ltKey) return { crm: "LT Elevator CRM", key: ltKey };
  const rKey = ricardoKeyOf(jobNumber);
  if (rKey) return { crm: "Ricardo CRM", key: rKey };
  return null;
}

/** One `erp_set_job_locks` round trip. key → row, or a failure sentence. */
async function callSetLocks(
  crm: CrmName,
  items: WireItem[],
): Promise<{ rows: Map<string, WireRow> } | { failure: string }> {
  const env = crmEnv(crm);
  if (!env.url || !env.anonKey || !env.secret) {
    return { failure: `The ${crm} connection is not configured, so the lock could not be changed.` };
  }
  // Refuse here rather than let the CRM reject the whole batch: every item
  // goes out with its key and an explicit true/false, every release a reason.
  const wire: WireItem[] = items.map((it) => ({
    key: it.key,
    locked: it.locked,
    by: it.by?.trim() || null,
    reason: it.reason?.trim() || null,
  }));
  if (wire.some((it) => !it.key || typeof it.locked !== "boolean")) {
    return { failure: `The ${crm} lock request was incomplete, so nothing was changed.` };
  }
  if (wire.some((it) => !it.locked && !it.reason)) {
    return { failure: `A reason is required to release a job in the ${crm}, so nothing was changed.` };
  }
  try {
    const supabase = createCrmClient(env.url, env.anonKey);
    const { data, error } = await supabase
      .rpc("erp_set_job_locks", { p_secret: env.secret, p_items: wire })
      .abortSignal(AbortSignal.timeout(CALL_TIMEOUT_MS));
    if (error) {
      console.error(`[crm-lock] ${crm} erp_set_job_locks error:`, error.message);
      return { failure: `Could not reach the ${crm}. Please try again in a moment.` };
    }
    return { rows: new Map(((data ?? []) as WireRow[]).map((r) => [r.key, r])) };
  } catch (e) {
    console.error(`[crm-lock] ${crm} unreachable:`, e);
    return { failure: `Could not reach the ${crm}. Please try again in a moment.` };
  }
}

/** Read one CRM answer strictly: only the exact expected status counts as done. */
function readAnswer(
  crm: CrmName,
  jobNumber: string,
  wantLocked: boolean,
  row: WireRow | undefined,
): CrmLockCall {
  if (row?.status === "NOT_FOUND") {
    return {
      ok: false,
      status: "NOT_FOUND",
      crm,
      message: `Job ${jobNumber} was not found in the ${crm}.`,
    };
  }
  if (wantLocked && row?.status === "LOCKED" && row.is_locked === true) {
    return { ok: true, status: "LOCKED", crm, message: `${crm}: drawings and SMR locked.` };
  }
  if (!wantLocked && row?.status === "RELEASED" && row.is_locked === false) {
    return { ok: true, status: "RELEASED", crm, message: `${crm}: drawings and SMR released.` };
  }
  return {
    ok: false,
    status: "UNAVAILABLE",
    crm,
    message: `The ${crm} gave an unexpected answer for job ${jobNumber}. Please try again.`,
  };
}

/** Lock or release ONE job in its CRM. Never throws. */
export async function setCrmLock(
  jobNumber: string,
  locked: boolean,
  by: string | null,
  reason: string | null,
): Promise<CrmLockCall> {
  const route = routeOf(jobNumber);
  if (!route) {
    return {
      ok: false,
      status: "NOT_CRM",
      crm: null,
      message: `"${jobNumber}" is not a CRM job number, so there is nothing to lock in a CRM.`,
    };
  }
  const res = await callSetLocks(route.crm, [{ key: route.key, locked, by, reason }]);
  if ("failure" in res) {
    return { ok: false, status: "UNAVAILABLE", crm: route.crm, message: res.failure };
  }
  return readAnswer(route.crm, jobNumber, locked, res.rows.get(route.key));
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface EventRow {
  job_id: string;
  action: "lock" | "release";
  reason: string | null;
  performed_by: string | null;
  crm: string | null;
  ok: boolean;
  detail: string | null;
}

/** Audit rows are best-effort: a logging hiccup must not undo a lock change. */
export async function logEvents(supabase: ServerClient, rows: EventRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    const { error } = await supabase.from("job_crm_lock_events").insert(rows.slice(i, i + BULK_CHUNK));
    if (error) console.error("[crm-lock] could not write audit rows:", error.message);
  }
}

export function touch(jobId: string): void {
  revalidateTag("jobs");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
}

export async function readJob(
  supabase: ServerClient,
  jobId: string,
): Promise<{ id: string; job_number: string; status: string; crm_lock_state: CrmLockState } | null> {
  if (!jobId) return null;
  const { data } = await supabase
    .from("jobs")
    .select("id, job_number, status, crm_lock_state")
    .eq("id", jobId)
    .maybeSingle();
  return (data as { id: string; job_number: string; status: string; crm_lock_state: CrmLockState } | null) ?? null;
}

export const cleanName = (operator?: string | null): string | null => operator?.trim() || null;

/**
 * Called by deleteJob BEFORE the row is removed: a job that leaves the ERP
 * must not stay locked in its CRM for ever (nobody could release it any more).
 *
 * Refuses (ok:false) when the CRM could not be reached, or when the job's lock
 * state could not even be read. "Not a CRM number" and "the CRM has no such
 * job" both mean there is nothing locked there, so the delete may go ahead.
 * The ERP state is flipped to 'released' too, so if the delete itself then
 * fails the job honestly shows as released and offers "Lock again";
 * `releasedNow` tells deleteJob that happened so it can say so.
 */
export async function releaseCrmLockForDelete(
  jobId: string,
  operator?: string | null,
): Promise<{ ok: true; releasedNow?: boolean } | { ok: false; error: string }> {
  const supabase = await createClient();
  // Read here (not via readJob) so a FAILED read is told apart from "no such
  // job". Treating a read hiccup as "nothing to release" would let the delete
  // go ahead and leave the job locked in its CRM with no ERP row to release it.
  const { data, error: readErr } = await supabase
    .from("jobs")
    .select("id, job_number, crm_lock_state")
    .eq("id", jobId)
    .maybeSingle();
  if (readErr) {
    return {
      ok: false,
      error: `Could not check this job's CRM lock (${readErr.message}). The job was NOT deleted — please try again.`,
    };
  }
  const job = data as { id: string; job_number: string; crm_lock_state: CrmLockState } | null;
  if (!job) return { ok: true }; // nothing to release; deleteJob reports the missing job itself
  if (job.crm_lock_state === "na" || job.crm_lock_state === "released") return { ok: true };

  const by = cleanName(operator);
  const call = await setCrmLock(job.job_number, false, by ?? "Factory ERP", CRM_RELEASE_REASON_DELETED);
  if (call.status === "NOT_CRM" || call.status === "NOT_FOUND") return { ok: true };

  if (!call.ok) {
    await logEvents(supabase, [
      {
        job_id: jobId, action: "release", reason: CRM_RELEASE_REASON_DELETED, performed_by: by,
        crm: call.crm, ok: false, detail: call.message,
      },
    ]);
    return {
      ok: false,
      error: `${call.message} The job was NOT deleted, because its drawings and SMR would have stayed locked in the ${call.crm ?? "CRM"}.`,
    };
  }

  const now = new Date().toISOString();
  await supabase
    .from("jobs")
    .update({
      crm_lock_state: "released",
      crm_lock_synced_at: now,
      crm_released_at: now,
      crm_released_by: by ?? "unknown",
      crm_release_reason: CRM_RELEASE_REASON_DELETED,
    })
    .eq("id", jobId);
  await logEvents(supabase, [
    {
      job_id: jobId, action: "release", reason: CRM_RELEASE_REASON_DELETED, performed_by: by,
      crm: call.crm, ok: true, detail: call.message,
    },
  ]);
  // If the delete that follows fails, the job page must show the true state
  // ("Released" + "Lock again") instead of a cached "CRM locked".
  touch(jobId);
  return { ok: true, releasedNow: true };
}

/**
 * Bulk lock — used by the Excel import (one call for all the jobs it just
 * created) and for the one-off backfill of jobs that were already in the ERP
 * when this rule came in.
 *
 * With no ids it takes every job still 'pending'; with ids it takes those jobs.
 * Released jobs are always skipped (only "Lock again" re-locks one). One RPC
 * per CRM per 200 jobs. Safe to re-run: locking an already-locked job in the
 * CRM keeps its original locked_at / locked_by.
 */
export async function lockJobsInCrm(
  jobIds?: string[],
  operator?: string | null,
): Promise<CrmBulkLockResult> {
  const supabase = await createClient();
  const by = cleanName(operator) ?? "Factory ERP backfill";
  const out: CrmBulkLockResult = {
    ok: true, total: 0, locked: 0, notFound: 0, failed: 0, notCrm: 0, skippedReleased: 0, problems: [],
  };

  type Row = { id: string; job_number: string; crm_lock_state: CrmLockState };
  const jobs: Row[] = [];
  if (jobIds) {
    const ids = Array.from(new Set(jobIds.filter(Boolean)));
    for (let i = 0; i < ids.length; i += BULK_CHUNK) {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, job_number, crm_lock_state")
        .in("id", ids.slice(i, i + BULK_CHUNK));
      if (error) return { ...out, ok: false, problems: [{ job_number: "—", message: error.message }] };
      jobs.push(...((data ?? []) as Row[]));
    }
  } else {
    // PostgREST returns at most 1000 rows per select — page through.
    const PAGE = 1000;
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, job_number, crm_lock_state")
        .eq("crm_lock_state", "pending")
        .order("id")
        .range(off, off + PAGE - 1);
      if (error) return { ...out, ok: false, problems: [{ job_number: "—", message: error.message }] };
      jobs.push(...((data ?? []) as Row[]));
      if ((data ?? []).length < PAGE) break;
    }
  }

  const events: EventRow[] = [];
  const byCrm = new Map<CrmName, { job: Row; key: string }[]>();
  const naIds: string[] = [];
  for (const job of jobs) {
    if (job.crm_lock_state === "released") {
      out.skippedReleased++;
      continue;
    }
    out.total++;
    const route = routeOf(job.job_number);
    if (!route) {
      out.notCrm++;
      if (job.crm_lock_state !== "na") naIds.push(job.id);
      continue;
    }
    const list = byCrm.get(route.crm) ?? [];
    list.push({ job, key: route.key });
    byCrm.set(route.crm, list);
  }

  const lockedIds: string[] = [];
  for (const [crm, list] of byCrm) {
    for (let i = 0; i < list.length; i += BULK_CHUNK) {
      const chunk = list.slice(i, i + BULK_CHUNK);
      const res = await callSetLocks(
        crm,
        chunk.map((c) => ({ key: c.key, locked: true, by, reason: null })),
      );
      for (const { job, key } of chunk) {
        const call: CrmLockCall =
          "failure" in res
            ? { ok: false, status: "UNAVAILABLE", crm, message: res.failure }
            : readAnswer(crm, job.job_number, true, res.rows.get(key));
        if (call.ok) {
          out.locked++;
          lockedIds.push(job.id);
        } else {
          if (call.status === "NOT_FOUND") out.notFound++;
          else out.failed++;
          out.problems.push({ job_number: job.job_number, message: call.message });
        }
        events.push({
          job_id: job.id, action: "lock", reason: null, performed_by: by, crm, ok: call.ok, detail: call.message,
        });
      }
    }
  }

  const now = new Date().toISOString();
  for (let i = 0; i < lockedIds.length; i += BULK_CHUNK) {
    const { error } = await supabase
      .from("jobs")
      .update({ crm_lock_state: "locked", crm_lock_synced_at: now })
      .in("id", lockedIds.slice(i, i + BULK_CHUNK))
      // A job released while this ran must not be flipped back to locked.
      .neq("crm_lock_state", "released");
    if (error) {
      out.ok = false;
      out.problems.push({ job_number: "—", message: `Could not record locks in the ERP: ${error.message}` });
    }
  }
  for (let i = 0; i < naIds.length; i += BULK_CHUNK) {
    await supabase.from("jobs").update({ crm_lock_state: "na" }).in("id", naIds.slice(i, i + BULK_CHUNK));
  }
  await logEvents(supabase, events);

  if (out.failed > 0) out.ok = false;
  revalidateTag("jobs");
  revalidatePath("/jobs");
  return out;
}
