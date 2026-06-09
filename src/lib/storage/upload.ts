"use client";

import { createClient } from "@/lib/supabase/client";

/** Shared limits for browser → Supabase Storage uploads (GAD drawings, program sketches). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
/** `accept` attribute for the file pickers. */
export const UPLOAD_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*";
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

/**
 * Upload a file straight from the browser to a public Supabase Storage bucket and
 * return the stored object path.
 *
 * Going direct (instead of POSTing the file through a Server Action) keeps large
 * files — up to 50 MB GAD drawings / sketches — OFF the serverless request body.
 * That matters because serverless hosts cap the function body small (Vercel ~4.5 MB),
 * and it's faster anyway (browser → Storage, no server hop). The file never touches
 * our server function; only the resulting object path does, via a `record*` action.
 *
 * Validates size + MIME here; the matching `record*` server action re-checks the
 * path + extension before pointing a row at it.
 */
export async function uploadFileToBucket(
  bucket: string,
  prefix: string,
  file: File,
): Promise<{ path: string }> {
  if (file.size === 0) throw new Error("File is empty");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 50 MB.`,
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error(
      `Unsupported file type "${file.type || "unknown"}". Use PDF, PNG, JPG, or WebP.`,
    );
  }

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${prefix}/${Date.now()}-${safeName}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message || "Upload failed");
  return { path };
}
