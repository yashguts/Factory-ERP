-- Job stage: tracks manufacturing/dispatch progress
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'new' CHECK (stage IN ('new', 'first_phase_dispatched', 'second_phase_dispatched', 'full_dispatched'));

-- Requirement stage: tracks material requirement fulfillment progress
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requirement_stage TEXT DEFAULT 'new' CHECK (requirement_stage IN ('new', 'first_phase_dispatched', 'second_phase_dispatched', 'full_dispatched'));

-- When materials need to be dispatched by
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requirement_dispatch_date DATE;

CREATE INDEX IF NOT EXISTS idx_jobs_stage ON jobs(stage);
CREATE INDEX IF NOT EXISTS idx_jobs_requirement_stage ON jobs(requirement_stage);
CREATE INDEX IF NOT EXISTS idx_jobs_requirement_dispatch_date ON jobs(requirement_dispatch_date);
