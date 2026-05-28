"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath, revalidateTag } from "next/cache";

const BUCKET = "gad-drawings";
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export interface GadDrawingInfo {
  url: string;
  filename: string;
  uploaded_at: string;
}

/**
 * Upload (or replace) the General Arrangement Drawing for a job.
 *
 * Accepts a FormData payload with:
 *   - jobId: string
 *   - file:  File (PDF or image)
 *
 * Stores the file at `{jobId}/{timestamp}-{originalName}` so a job
 * can keep its history if anyone ever wants it (only the latest is
 * referenced on jobs.gad_drawing_url though). Replacing a drawing
 * deletes the previous file to keep the bucket tidy.
 */
export async function uploadGadDrawing(
  formData: FormData,
): Promise<GadDrawingInfo> {
  const jobId = formData.get("jobId");
  const file = formData.get("file");

  if (typeof jobId !== "string" || !jobId) {
    throw new Error("Missing jobId");
  }
  if (!(file instanceof File)) {
    throw new Error("Missing file");
  }
  if (file.size === 0) {
    throw new Error("File is empty");
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(
      `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 50 MB.`,
    );
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error(
      `Unsupported file type "${file.type}". Use PDF, PNG, JPG, or WebP.`,
    );
  }

  const supabase = await createClient();

  // 1. Best-effort cleanup of the previous drawing for this job (so
  //    the bucket doesn't accumulate orphans on every replace).
  const { data: existingRow } = await supabase
    .from("jobs")
    .select("gad_drawing_url")
    .eq("id", jobId)
    .single();
  const previousUrl = (existingRow?.gad_drawing_url as string | null) ?? null;
  if (previousUrl) {
    const previousPath = extractStoragePath(previousUrl);
    if (previousPath) {
      // ignore errors — best effort
      await supabase.storage.from(BUCKET).remove([previousPath]);
    }
  }

  // 2. Upload the new file under a job-scoped path.
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${jobId}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  // 3. Build the public URL and record it on the jobs row.
  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const uploaded_at = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("jobs")
    .update({
      gad_drawing_url: publicUrl,
      gad_drawing_filename: file.name,
      gad_drawing_uploaded_at: uploaded_at,
    })
    .eq("id", jobId);
  if (updateError) throw updateError;

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/edit`);
  revalidateTag("jobs");

  return { url: publicUrl, filename: file.name, uploaded_at };
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
