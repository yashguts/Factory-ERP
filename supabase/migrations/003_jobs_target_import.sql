-- Extend jobs with elevator-specific metadata
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS spec_string TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS door_finish TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS progress NUMERIC(5,4) DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS order_date DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS expected_delivery DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS floors INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS door_type TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS drive_type TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS capacity TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS remark TEXT;

-- Make item_id nullable (custom elevators don't produce one specific item)
ALTER TABLE job_bom_headers ALTER COLUMN item_id DROP NOT NULL;

-- Track which Excel column each BOM line came from
ALTER TABLE job_bom_lines ADD COLUMN IF NOT EXISTS source_col_index INTEGER;

-- Excel column to ERP item mapping
CREATE TABLE IF NOT EXISTS target_column_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    column_index INTEGER NOT NULL UNIQUE,
    column_label TEXT NOT NULL,
    item_lookup_key TEXT,
    item_id UUID REFERENCES items(id),
    category TEXT,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_target_col_map_item ON target_column_map(item_id);
CREATE INDEX IF NOT EXISTS idx_target_col_map_lookup ON target_column_map(item_lookup_key);
CREATE INDEX IF NOT EXISTS idx_jobs_brand ON jobs(brand);
CREATE INDEX IF NOT EXISTS idx_jobs_door_type ON jobs(door_type);
