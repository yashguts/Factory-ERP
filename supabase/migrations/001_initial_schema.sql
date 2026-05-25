-- Factory ERP - Initial Schema
-- Covers: Master Data, Inventory, BOM, Jobs, and MRP foundations

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE item_type AS ENUM ('raw_material', 'sub_assembly', 'finished_good');
CREATE TYPE transaction_type AS ENUM ('purchase_in', 'production_in', 'production_out', 'adjustment', 'transfer', 'scrap');
CREATE TYPE job_status AS ENUM ('draft', 'planned', 'in_progress', 'completed', 'cancelled');
CREATE TYPE uom_category AS ENUM ('quantity', 'length', 'weight', 'area', 'volume');

-- ============================================================
-- MASTER DATA
-- ============================================================

-- Units of Measurement
CREATE TABLE units_of_measurement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    abbreviation TEXT NOT NULL UNIQUE,
    category uom_category NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Item Categories (hierarchical - e.g., Electrical > Motors > Geared Motors)
CREATE TABLE item_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES item_categories(id),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(name, parent_id)
);

-- Items Master - the core entity (raw materials, sub-assemblies, finished goods)
CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    item_type item_type NOT NULL DEFAULT 'raw_material',
    category_id UUID REFERENCES item_categories(id),
    uom_id UUID NOT NULL REFERENCES units_of_measurement(id),
    minimum_stock NUMERIC(12, 3) DEFAULT 0,
    reorder_point NUMERIC(12, 3) DEFAULT 0,
    lead_time_days INTEGER DEFAULT 0,
    cost_price NUMERIC(12, 2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Warehouses / Storage Locations
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    location TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INVENTORY
-- ============================================================

-- Current stock levels (per item per warehouse)
CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(item_id, warehouse_id)
);

-- Stock movement transactions (audit trail)
CREATE TABLE inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    transaction_type transaction_type NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL,
    reference_type TEXT,
    reference_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID
);

-- ============================================================
-- BILL OF MATERIALS (Multi-Level)
-- ============================================================

-- BOM Header (a BOM belongs to an item - typically sub_assembly or finished_good)
CREATE TABLE bom_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id),
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(item_id, version)
);

-- BOM Lines (components of a BOM - can reference items that themselves have BOMs)
CREATE TABLE bom_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    quantity NUMERIC(12, 4) NOT NULL,
    wastage_percent NUMERIC(5, 2) DEFAULT 0,
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- JOB ORDERS
-- ============================================================

-- Jobs (each elevator order)
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_number TEXT NOT NULL UNIQUE,
    description TEXT,
    customer_name TEXT,
    status job_status NOT NULL DEFAULT 'draft',
    planned_start DATE,
    planned_end DATE,
    actual_start DATE,
    actual_end DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Job BOM (snapshot/customized BOM for a specific job)
CREATE TABLE job_bom_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    source_bom_id UUID REFERENCES bom_headers(id),
    quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Job BOM Lines (editable copy of BOM lines for a job)
CREATE TABLE job_bom_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_bom_id UUID NOT NULL REFERENCES job_bom_headers(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    required_quantity NUMERIC(12, 4) NOT NULL,
    issued_quantity NUMERIC(12, 4) DEFAULT 0,
    wastage_percent NUMERIC(5, 2) DEFAULT 0,
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_items_type ON items(item_type);
CREATE INDEX idx_items_category ON items(category_id);
CREATE INDEX idx_items_code ON items(code);
CREATE INDEX idx_inventory_item ON inventory(item_id);
CREATE INDEX idx_inventory_warehouse ON inventory(warehouse_id);
CREATE INDEX idx_transactions_item ON inventory_transactions(item_id);
CREATE INDEX idx_transactions_date ON inventory_transactions(created_at);
CREATE INDEX idx_bom_lines_bom ON bom_lines(bom_id);
CREATE INDEX idx_bom_lines_item ON bom_lines(item_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_job_bom_job ON job_bom_headers(job_id);
CREATE INDEX idx_job_bom_lines_header ON job_bom_lines(job_bom_id);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_updated_at BEFORE UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER bom_headers_updated_at BEFORE UPDATE ON bom_headers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON inventory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SEED DATA: Units of Measurement
-- ============================================================

INSERT INTO units_of_measurement (name, abbreviation, category) VALUES
    ('Pieces', 'pcs', 'quantity'),
    ('Numbers', 'nos', 'quantity'),
    ('Meters', 'm', 'length'),
    ('Millimeters', 'mm', 'length'),
    ('Feet', 'ft', 'length'),
    ('Kilograms', 'kg', 'weight'),
    ('Grams', 'g', 'weight'),
    ('Square Meters', 'sqm', 'area'),
    ('Liters', 'L', 'volume'),
    ('Sets', 'set', 'quantity');

-- ============================================================
-- SEED DATA: Default Warehouse
-- ============================================================

INSERT INTO warehouses (name, location) VALUES
    ('Main Store', 'Factory Floor'),
    ('Raw Material Store', 'Warehouse Block A'),
    ('Finished Goods', 'Dispatch Area');

-- ============================================================
-- SEED DATA: Item Categories for Elevator Manufacturing
-- ============================================================

INSERT INTO item_categories (name, description) VALUES
    ('Mechanical', 'Mechanical components and assemblies'),
    ('Electrical', 'Electrical components, wiring, and controls'),
    ('Structural', 'Steel, frames, and structural components'),
    ('Cabin & Interiors', 'Cabin panels, flooring, lighting'),
    ('Safety', 'Safety devices and equipment'),
    ('Doors', 'Landing and car door systems');
