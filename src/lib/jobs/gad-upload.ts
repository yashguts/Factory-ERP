// Browser-side helpers for putting a GAD drawing file into Supabase Storage.
// Shared by the drawing panel (existing jobs) and the New Job form (which must
// upload the drawing BEFORE the job row is created — a job may not exist
// without its drawing).
import { createClient } from "@/lib/supabase/client";

export const GAD_BUCKET = "gad-drawings";
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB (matches the bucket limit)
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

/** Friendly pre-check (the bucket enforces these too). Null = file is fine. */
export function validateGadFile(file: File): string | null {
  if (file.size === 0) return "File is empty";
  if (file.size > MAX_SIZE_BYTES) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 50 MB.`;
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return `Unsupported file type "${file.type}". Use PDF, PNG, JPG, or WebP.`;
  }
  return null;
}

/**
 * Upload the bytes straight from the browser to storage (going through a
 * server action would cap the file at the host's few-MB request-body limit).
 * The object lands at `{jobId}/{timestamp}-{name}`.
 */
export async function uploadGadFile(
  jobId: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${jobId}/${Date.now()}-${safeName}`;
  const { error } = await createClient()
    .storage.from(GAD_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message || "Upload to storage failed" };
  return { ok: true, path };
}

/** Best-effort cleanup of an uploaded file whose job was never created. */
export async function removeGadFile(path: string): Promise<void> {
  try {
    await createClient().storage.from(GAD_BUCKET).remove([path]);
  } catch {
    // An orphaned file is harmless — never surface this.
  }
}
