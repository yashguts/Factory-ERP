"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath, revalidateTag } from "next/cache";

const BUCKET = "gad-drawings";
// Size/MIME are validated client-side before the direct-to-storage upload
// (see lib/storage/upload.ts); here we just sanity-check the filename extension.
const ALLOWED_EXTENSION = /\.(pdf|png|jpe?g|webp)$/i;

export interface GadDrawingInfo {
  url: string;
  filename: string;
  uploaded_at: string;
}

/**
 * Record a GAD drawing the browser has ALREADY uploaded directly to Supabase
 * Storage (see lib/storage/upload.ts). The 50 MB file never passes through this
 * server function — only its storage object `path` does — which keeps us under
 * serverless body limits and is faster.
 *
 * `path` looks like `{jobId}/{timestamp}-{name}`; we re-check it belongs to this
 * job, point jobs.gad_drawing_url at it, and best-effort delete the previous file.
 */
export async function recordGadDrawing(
  jobId: string,
  path: string,
  filename: string,
): Promise<GadDrawingInfo> {
  if (!jobId) throw new Error("Missing jobId");
  if (!path || !path.startsWith(`${jobId}/`)) {
    throw new Error("Invalid upload path");
  }
  if (!ALLOWED_EXTENSION.test(filename)) {
    throw new Error("Unsupported file type. Use PDF, PNG, JPG, or WebP.");
  }

  const supabase = await createClient();

  // Best-effort cleanup of the previous drawing so the bucket doesn't keep orphans.
  const { data: existingRow } = await supabase
    .from("jobs")
    .select("gad_drawing_url")
    .eq("id", jobId)
    .single();
  const previousUrl = (existingRow?.gad_drawing_url as string | null) ?? null;
  if (previousUrl) {
    const previousPath = extractStoragePath(previousUrl);
    if (previousPath && previousPath !== path) {
      await supabase.storage.from(BUCKET).remove([previousPath]);
    }
  }

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
