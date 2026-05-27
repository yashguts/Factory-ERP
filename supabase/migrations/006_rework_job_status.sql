-- Convert status from enum to text with new values
ALTER TABLE jobs ALTER COLUMN status DROP DEFAULT;
ALTER TABLE jobs ALTER COLUMN status TYPE TEXT USING status::TEXT;
DROP TYPE IF EXISTS job_status;

-- Map old values to new
UPDATE jobs SET status = 'new' WHERE status IN ('draft', 'planned');
UPDATE jobs SET status = 'in_production' WHERE status = 'in_progress';
UPDATE jobs SET status = 'hold' WHERE status IN ('completed', 'cancelled');

ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('new', 'in_production', 'hold'));
ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'new';

-- Change requirement_stage default to null
ALTER TABLE jobs ALTER COLUMN requirement_stage DROP DEFAULT;
ALTER TABLE jobs ALTER COLUMN requirement_stage SET DEFAULT NULL;

-- Set existing requirement_stage values to null (they were auto-set to 'new')
UPDATE jobs SET requirement_stage = NULL;
