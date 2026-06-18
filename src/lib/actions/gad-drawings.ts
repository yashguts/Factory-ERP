"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath, revalidateTag } from "next/cache";

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

/**
 * Remove the CURRENT GAD drawing pointer for a job: the version history (and the
 * stored files) is KEPT — only the live pointer is cleared. The drift alert
 * short-circuits while no current drawing is set; re-uploading bumps the
 * revision and re-raises it.
 */
export async function deleteGadDrawing(jobId: string): Promise<void> {
  if (!jobId) throw new Error("Missing jobId");

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

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/edit`);
  revalidateTag("jobs");
  revalidateTag("gad-alerts");
}
