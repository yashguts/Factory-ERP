"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath, revalidateTag } from "next/cache";

const BUCKET = "gad-drawings";

export interface GadDrawingInfo {
  url: string;
  filename: string;
  uploaded_at: string;
}

/**
 * Record a GAD drawing that the BROWSER has already uploaded to storage.
 *
 * The file bytes are uploaded client-side straight to the `gad-drawings`
 * bucket (see gad-drawing-panel.tsx) — NOT through this server action — so
 * large drawings aren't capped by the serverless host's few-MB request-body
 * limit. This action only takes the resulting object `path` and:
 *   - deletes the job's previous drawing (so the bucket doesn't accumulate
 *     orphans on every replace), and
 *   - records the public URL / filename / timestamp on the jobs row.
 *
 * The object lives at `{jobId}/{timestamp}-{originalName}`; we require the
 * path to sit under the job's own folder so a bad caller can't point a job
 * at an unrelated object.
 */
export async function recordGadDrawing(input: {
  jobId: string;
  path: string;
  filename: string;
}): Promise<GadDrawingInfo> {
  const { jobId, path, filename } = input;

  if (!jobId) throw new Error("Missing jobId");
  if (!path) throw new Error("Missing storage path");
  if (!path.startsWith(`${jobId}/`)) {
    throw new Error("Invalid storage path for this job");
  }

  const supabase = await createClient();

  // 1. Best-effort cleanup of the previous drawing for this job.
  const { data: existingRow } = await supabase
    .from("jobs")
    .select("gad_drawing_url")
    .eq("id", jobId)
    .single();
  const previousUrl = (existingRow?.gad_drawing_url as string | null) ?? null;
  if (previousUrl) {
    const previousPath = extractStoragePath(previousUrl);
    // Don't remove the object we just uploaded if the paths coincide.
    if (previousPath && previousPath !== path) {
      // ignore errors — best effort
      await supabase.storage.from(BUCKET).remove([previousPath]);
    }
  }

  // 2. Build the public URL and record it on the jobs row.
  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const uploaded_at = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("jobs")
    .update({
      gad_drawing_url: publicUrl,
      gad_drawing_filename: filename,
      gad_drawing_uploaded_at: uploaded_at,
    })
    .eq("id", jobId);
  if (updateError) throw updateError;

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/edit`);
  revalidateTag("jobs");

  return { url: publicUrl, filename, uploaded_at };
}

/**
 * Remove the GAD drawing for a job: deletes the storage object and
 * clears the columns on jobs.
 */
export async function deleteGadDrawing(jobId: string): Promise<void> {
  if (!jobId) throw new Error("Missing jobId");

  const supabase = await createClient();

  const { data: row } = await supabase
    .from("jobs")
    .select("gad_drawing_url")
    .eq("id", jobId)
    .single();
  const url = (row?.gad_drawing_url as string | null) ?? null;
  if (url) {
    const path = extractStoragePath(url);
    if (path) {
      await supabase.storage.from(BUCKET).remove([path]);
    }
  }

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
}

/**
 * Given a public storage URL like
 *   https://xyz.supabase.co/storage/v1/object/public/gad-drawings/<job>/<file>
 * return `<job>/<file>`. Returns null if the URL doesn't look like one
 * of ours.
 */
function extractStoragePath(url: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}
