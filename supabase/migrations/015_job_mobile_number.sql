-- 015_job_mobile_number.sql
-- Add an optional contact mobile number to jobs.
--
-- Stored as text (preserves leading zeros / is not arithmetic). Value is
-- either NULL (not provided — the field is optional) or exactly 10 numeric
-- digits. The CHECK mirrors the app-side validation in the job form so bad
-- data can't enter through raw SQL either.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS mobile_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_mobile_number_format'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_mobile_number_format
      CHECK (mobile_number IS NULL OR mobile_number ~ '^[0-9]{10}$');
  END IF;
END$$;
