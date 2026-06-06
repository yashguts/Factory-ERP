-- 016_program_extra_files.sql
-- Two extra per-program attachments beyond the existing single Sketch:
--   • Design file   (operations.design_file_*)
--   • Print file    (operations.print_file_*)
-- Any file format, max 15 MB each. Stored in a new `program-files` bucket
-- (separate from `program-sketches`, which stays PDF/image-only @ 50 MB).
--
-- Already applied to the hosted project via the Supabase MCP; this file exists
-- so the schema stays reproducible from the repo.

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS design_file_url         text,
  ADD COLUMN IF NOT EXISTS design_file_filename    text,
  ADD COLUMN IF NOT EXISTS design_file_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS print_file_url          text,
  ADD COLUMN IF NOT EXISTS print_file_filename     text,
  ADD COLUMN IF NOT EXISTS print_file_uploaded_at  timestamptz;

-- program-files bucket: public, 15 MB per file, ANY format (allowed_mime_types = NULL).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('program-files', 'program-files', true, 15728640, NULL)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "program_files_select" ON storage.objects;
CREATE POLICY "program_files_select" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'program-files');
DROP POLICY IF EXISTS "program_files_insert" ON storage.objects;
CREATE POLICY "program_files_insert" ON storage.objects
  FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'program-files');
DROP POLICY IF EXISTS "program_files_update" ON storage.objects;
CREATE POLICY "program_files_update" ON storage.objects
  FOR UPDATE TO anon, authenticated USING (bucket_id = 'program-files') WITH CHECK (bucket_id = 'program-files');
DROP POLICY IF EXISTS "program_files_delete" ON storage.objects;
CREATE POLICY "program_files_delete" ON storage.objects
  FOR DELETE TO anon, authenticated USING (bucket_id = 'program-files');
