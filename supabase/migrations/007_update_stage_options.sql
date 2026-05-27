-- Update stage check constraint with new values
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_stage_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_stage_check CHECK (stage IN ('new', 'first_phase', 'full_material'));

-- Update requirement_stage check constraint with new values
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_requirement_stage_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_requirement_stage_check CHECK (requirement_stage IS NULL OR requirement_stage IN ('new', 'first_phase', 'full_material'));

-- Map old values to new
UPDATE jobs SET stage = 'first_phase' WHERE stage = 'first_phase_dispatched';
UPDATE jobs SET stage = 'full_material' WHERE stage IN ('second_phase_dispatched', 'full_dispatched');

UPDATE jobs SET requirement_stage = 'first_phase' WHERE requirement_stage = 'first_phase_dispatched';
UPDATE jobs SET requirement_stage = 'full_material' WHERE requirement_stage IN ('second_phase_dispatched', 'full_dispatched');
