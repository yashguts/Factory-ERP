-- Add sub-categories for inventory import
-- These are children of the top-level categories seeded in 001

-- Get parent category IDs and insert sub-categories
DO $$
DECLARE
  doors_id UUID;
  mechanical_id UUID;
  electrical_id UUID;
  cabin_id UUID;
  safety_id UUID;
BEGIN
  SELECT id INTO doors_id FROM item_categories WHERE name = 'Doors' AND parent_id IS NULL;
  SELECT id INTO mechanical_id FROM item_categories WHERE name = 'Mechanical' AND parent_id IS NULL;
  SELECT id INTO electrical_id FROM item_categories WHERE name = 'Electrical' AND parent_id IS NULL;
  SELECT id INTO cabin_id FROM item_categories WHERE name = 'Cabin & Interiors' AND parent_id IS NULL;
  SELECT id INTO safety_id FROM item_categories WHERE name = 'Safety' AND parent_id IS NULL;

  -- Doors sub-categories
  INSERT INTO item_categories (name, parent_id, description) VALUES
    ('Door Panels', doors_id, 'Landing and car door panels'),
    ('Landing Header System', doors_id, 'Landing door headers and components'),
    ('Car Header System', doors_id, 'Car door headers and components'),
    ('Door Shoe Channel', doors_id, 'Door shoe channels and guides'),
    ('Aluminium Sill', doors_id, 'Landing and car aluminium sills')
  ON CONFLICT (name, parent_id) DO NOTHING;

  -- Mechanical sub-categories
  INSERT INTO item_categories (name, parent_id, description) VALUES
    ('Guide Rails', mechanical_id, 'Guide rails for car and counterweight'),
    ('Machine Units', mechanical_id, 'Traction machines, brakes, belts'),
    ('Wire Rope & Rigging', mechanical_id, 'Wire ropes, thimbles, clips, shackles'),
    ('Oils & Lubricants', mechanical_id, 'Machine oils and lubricants'),
    ('Dead Weight', mechanical_id, 'Counterweight blocks')
  ON CONFLICT (name, parent_id) DO NOTHING;

  -- Electrical sub-categories
  INSERT INTO item_categories (name, parent_id, description) VALUES
    ('Belt Detector', electrical_id, 'Belt detection sensors')
  ON CONFLICT (name, parent_id) DO NOTHING;

  -- Cabin & Interiors sub-categories
  INSERT INTO item_categories (name, parent_id, description) VALUES
    ('Fan & Ventilation', cabin_id, 'Cabin fans, grills, ventilation')
  ON CONFLICT (name, parent_id) DO NOTHING;

  -- Safety sub-categories
  INSERT INTO item_categories (name, parent_id, description) VALUES
    ('Retiring Cam', safety_id, 'Door retiring cam mechanisms'),
    ('Safety Devices', safety_id, 'Safety blocks, governors, buffers')
  ON CONFLICT (name, parent_id) DO NOTHING;
END $$;
