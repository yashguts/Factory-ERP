"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath, revalidateTag } from "next/cache";
import type { createJob } from "@/lib/actions/jobs";
import { changeJobStatus } from "@/lib/actions/job-status";

const BUCKET = "gad-drawings";

export interface GadDrawingInfo {
  url: string;
  filename: string;
  uploaded_at: string;
  /** New revision number assigned to this upload (1,2,3 ...). */
  revision_no: number;
}

/**
 * Record a GAD drawing that the BROWSER has already uploaded to storage.
 *
 * The file bytes are uploaded client-side straight to the `gad-drawings`
 * bucket (see gad-drawing-panel.tsx) — NOT through this server action — so
 * large drawings aren't capped by the serverless host's few-MB request-body
 * limit. This action only takes the resulting object `path` and:
 *   - appends a new IMMUTABLE version row (history is kept — old files are NOT
 *     deleted, so every revision stays viewable), bumping the job's revision, and
 *   - mirrors the public URL / filename / timestamp / revision onto the jobs row.
 *
 * Re-uploading a GAD after the BOM was defined bumps `gad_revision_no` above the
 * acknowledged revision, so the drift alert (src/lib/jobs/gad-alert.ts) raises
 * automatically — no other wiring needed.
 *
 * The object lives at `{jobId}/{timestamp}-{originalName}`; we require the
 * path to sit under the job's own folder so a bad caller can't point a job
 * at an unrelated object.
 */
export async function recordGadDrawing(input: {
  jobId: string;
  path: string;
  filename: string;
  /** Operator identity (no auth wired). 'unknown' if not provided. */
  operator?: string | null;
}): Promise<GadDrawingInfo> {
  const { jobId, path, filename, operator } = input;

  if (!jobId) throw new Error("Missing jobId");
  if (!path) throw new Error("Missing storage path");
  if (!path.startsWith(`${jobId}/`)) {
    throw new Error("Invalid storage path for this job");
  }

  const supabase = await createClient();

  // Build the public URL for the freshly-uploaded object.
  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);

  // Atomically: allocate the next revision, flip the prior current off, insert
  // the new current version row, and mirror it onto the jobs row.
  const { data: rev, error } = await supabase.rpc("add_job_gad_version", {
    p_job_id: jobId,
    p_path: path,
    p_url: publicUrl,
    p_filename: filename,
    p_uploaded_by: operator ?? "unknown",
  });
  if (error) throw error;

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/edit`);
  revalidateTag("jobs");
  revalidateTag("gad-alerts");

  return {
    url: publicUrl,
    filename,
    uploaded_at: new Date().toISOString(),
    revision_no: (rev as number | null) ?? 0,
  };
}

export type CreateJobWithDrawingResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create a NEW job together with its GAD drawing — the only way the New Job
 * form creates a job (owner rule, 2026-11-16: a job is not added to the ERP
 * until its drawing is uploaded).
 *
 * The browser pre-generates the job id and uploads the file to
 * `{id}/{timestamp}-{name}` FIRST, then calls this. We confirm the file really
 * is in storage, insert the job, and attach the drawing as revision 1. If the
 * attach fails the job row is removed again, so a job can never be left behind
 * without a drawing. Returns a result (not a throw) because Next strips thrown
 * messages in production.
 *
 * Deliberately separate from createJob (jobs.ts, locked) — the Excel import
 * keeps its own path and is exempt from the drawing rule.
 */
export async function createJobWithDrawing(
  job: Parameters<typeof createJob>[0] & { id: string },
  drawing: { path: string; filename: string; operator?: string | null },
): Promise<CreateJobWithDrawingResult> {
  if (!UUID_RE.test(job.id ?? "")) return { ok: false, error: "Invalid job id." };
  if (!job.job_number?.trim()) return { ok: false, error: "Job Number is required." };
  if (!drawing?.path || !drawing.path.startsWith(`${job.id}/`)) {
    return { ok: false, error: "A GAD drawing is required to create a job." };
  }

  const supabase = await createClient();
  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(drawing.path);

  // The rule is enforced here, not just in the form: the drawing must actually
  // be in storage (the bucket is public, so a HEAD on its URL is the check).
  try {
    const head = await fetch(publicUrl, { method: "HEAD", cache: "no-store" });
    if (!head.ok) {
      return { ok: false, error: "The GAD drawing did not upload. Please choose the file again." };
    }
  } catch {
    return { ok: false, error: "Could not verify the GAD drawing upload. Please try again." };
  }

  const { error: insErr } = await supabase.from("jobs").insert(job);
  if (insErr) {
    if (insErr.code === "23505") {
      return { ok: false, error: `Job number "${job.job_number}" already exists.` };
    }
    return { ok: false, error: insErr.message };
  }

  const { error: gadErr } = await supabase.rpc("add_job_gad_version", {
    p_job_id: job.id,
    p_path: drawing.path,
    p_url: publicUrl,
    p_filename: drawing.filename,
    p_uploaded_by: drawing.operator ?? "unknown",
  });
  if (gadErr) {
    // Roll back the brand-new job (it has no children yet) — never leave a job
    // without its drawing.
    await supabase.from("jobs").delete().eq("id", job.id);
    return { ok: false, error: `Could not attach the GAD drawing: ${gadErr.message}` };
  }

  revalidateTag("jobs");
  revalidateTag("gad-alerts");
  revalidatePath("/jobs");
  return { ok: true, id: job.id };
}

/**
 * Remove the CURRENT GAD drawing pointer for a job: the version history (and the
 * stored files) is KEPT — only the live pointer is cleared. The drift alert
 * short-circuits while no current drawing is set; re-uploading bumps the
 * revision and re-raises it.
 *
 * Owner rule (2026-11-16): a job without a drawing must not stay in production,
 * so removing the drawing moves the job to HOLD, logged with the operator's
 * remark through the normal status-change path (history + Hold alert). The
 * remark is mandatory. Re-uploading a drawing does NOT auto-resume the job —
 * someone takes it off Hold deliberately.
 */
export async function deleteGadDrawing(
  jobId: string,
  remark: string,
  operator?: string | null,
): Promise<void> {
  if (!jobId) throw new Error("Missing jobId");
  const cleanRemark = remark?.trim();
  if (!cleanRemark) throw new Error("A remark is required to remove the drawing.");

  const supabase = await createClient();

  // Mark every version not-current (history rows and their files are retained).
  await supabase
    .from("job_gad_versions")
    .update({ is_current: false })
    .eq("job_id", jobId)
    .eq("is_current", true);

  // Clear the live pointer on the job. `gad_revision_no` stays monotonic so a
  // later re-upload allocates the next number and the alert re-raises correctly.
  const { error } = await supabase
    .from("jobs")
    .update({
      gad_drawing_url: null,
      gad_drawing_filename: null,
      gad_drawing_uploaded_at: null,
    })
    .eq("id", jobId);
  if (error) throw error;

  // No drawing → the job goes on Hold with the remark. (No-op if already on Hold.)
  const held = await changeJobStatus(
    jobId,
    "hold",
    operator ?? null,
    `GAD drawing removed — ${cleanRemark}`,
  );
  if (!held.ok) throw new Error(held.error ?? "Could not move the job to Hold");

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/edit`);
  revalidateTag("jobs");
  revalidateTag("gad-alerts");
}
