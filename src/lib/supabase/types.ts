export type ItemType = "raw_material" | "sub_assembly" | "finished_good" | "mechanical_finished_stock" | "door_panel";
/**
 * How an item behaves in stock/planning (orthogonal to make/trade procurement_type):
 * - stocked: has a balance, is planned (raw sheets, bought parts, real sub-assemblies)
 * - phantom: made but never stocked — a transient cut part; rare as an item (mostly
 *   lives on operation_outputs.role), explodes through to its raw material
 * - tooling: jigs/templates; excluded from product BOM + MRP
 */
export type StockBehaviour = "stocked" | "phantom" | "tooling";
/**
 * How an item gets its material requirement (computed by search_inventory,
 * never stored):
 * - jobs:    independent demand — its category is pickable on the job form's
 *            BOM sections, or it already appears on a job BOM line
 * - formula: dependent demand — consumed by a program (operation_inputs) or
 *            a child in an item parts list (item_bom_lines)
 * - none:    no path to demand at all — needs a formula or a min-stock rule
 * - tooling: stock_behaviour = tooling — not planned, by design
 */
export type DemandSource = "jobs" | "formula" | "none" | "tooling";
/** Manual Demand Flow Type marking on an item; NULL = automatic (computed). */
export type DemandOverride = "jobs" | "formula" | "none";
/**
 * What a program OUTPUT line represents:
 * - component: a real (stocked) item — links/should-link to inventory
 * - cut_part: intentional phantom — cut & fitted into an assembly, never stocked
 * - tooling: a jig/template, not a product
 * - scrap: offcut, ignored in planning
 */
export type OutputRole = "component" | "cut_part" | "tooling" | "scrap";
export type TransactionType = "purchase_in" | "production_in" | "production_out" | "adjustment" | "transfer" | "scrap";
export type JobStatus = "new" | "in_production" | "hold";
export type JobStage = "new" | "first_phase" | "full_material";
export type UomCategory = "quantity" | "length" | "weight" | "area" | "volume";

export interface UnitOfMeasurement {
  id: string;
  name: string;
  abbreviation: string;
  category: UomCategory;
  created_at: string;
}

export interface ItemCategory {
  id: string;
  name: string;
  parent_id: string | null;
  description: string | null;
  created_at: string;
  /** Default Make/Trade classification for items in this (sub-)category. */
  procurement_type: "make" | "trade" | null;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  description: string | null;
  lookup_key: string | null;
  item_type: ItemType;
  category_id: string | null;
  uom_id: string;
  minimum_stock: number;
  reorder_point: number;
  lead_time_days: number;
  cost_price: number;
  is_active: boolean;
  stock_behaviour: StockBehaviour;
  /** Groups finish/material variants of one part. NULL = not a finish family. */
  family: string | null;
  /** This variant's finish/material (MS, SS, SS Champagne…). NULL = no finish. */
  finish: string | null;
  /** Manual Demand Flow Type marking; NULL = automatic (computed). */
  demand_override: DemandOverride | null;
  created_at: string;
  updated_at: string;
}

/** How a parts-list line resolves its child's finish at explode time. */
export type FinishRule = "inherit" | "pinned" | "neutral";

/** A line in an assembly item's multi-level parts list ("Built from"). */
export interface ItemBomLine {
  id: string;
  parent_item_id: string;
  /** Specific child (used for finish_rule = 'neutral'). */
  child_item_id: string | null;
  /** Child family to resolve within (used for 'inherit' / 'pinned'). */
  child_family: string | null;
  qty: number;
  finish_rule: FinishRule;
  /** The fixed finish when finish_rule = 'pinned' (e.g. 'MS'). */
  pinned_finish: string | null;
  sort_order: number;
}

export interface Warehouse {
  id: string;
  name: string;
  location: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Inventory {
  id: string;
  item_id: string;
  warehouse_id: string;
  quantity: number;
  updated_at: string;
}

export interface InventoryTransaction {
  id: string;
  item_id: string;
  warehouse_id: string;
  transaction_type: TransactionType;
  quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export interface BomHeader {
  id: string;
  item_id: string;
  version: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BomLine {
  id: string;
  bom_id: string;
  item_id: string;
  quantity: number;
  wastage_percent: number;
  notes: string | null;
  sort_order: number;
  created_at: string;
}

export interface Job {
  id: string;
  job_number: string;
  description: string | null;
  customer_name: string | null;
  /** Optional contact mobile number. NULL or exactly 10 numeric digits. */
  mobile_number: string | null;
  status: JobStatus;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  notes: string | null;
  spec_string: string | null;
  door_finish: string | null;
  location: string | null;
  progress: number;
  order_date: string | null;
  expected_delivery: string | null;
  brand: string | null;
  floors: number | null;
  door_type: string | null;
  drive_type: string | null;
  capacity: string | null;
  remark: string | null;
  stage: JobStage;
  requirement_stage: JobStage | null;
  requirement_dispatch_date: string | null;
  gad_drawing_url: string | null;
  gad_drawing_filename: string | null;
  gad_drawing_uploaded_at: string | null;
  /** Whether the elevator structure is part of this job. */
  structure_included: StructureIncluded;
  created_at: string;
  updated_at: string;
}

export type StructureIncluded = "NA" | "Factory-made" | "Site-fabricated";
export const STRUCTURE_INCLUDED_OPTIONS: StructureIncluded[] = [
  "NA",
  "Factory-made",
  "Site-fabricated",
];

export interface JobBomHeader {
  id: string;
  job_id: string;
  item_id: string | null;
  source_bom_id: string | null;
  quantity: number;
  notes: string | null;
  created_at: string;
}

export interface JobBomLine {
  id: string;
  job_bom_id: string;
  item_id: string | null;
  required_quantity: number;
  issued_quantity: number;
  wastage_percent: number;
  notes: string | null;
  sort_order: number;
  source_col_index: number | null;
  category: string | null;
  variant: string | null;
  value_text: string | null;
  created_at: string;
}

export interface TargetColumnMap {
  id: string;
  column_index: number;
  column_label: string;
  item_lookup_key: string | null;
  item_id: string | null;
  category: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// --- Inventory change log -------------------------------------------------

export type ItemChangeAction = "create" | "update" | "delete";

/**
 * One field's before/after within an item change-log entry.
 * `old`/`new` hold the raw stored values; `label`, `old_display` and
 * `new_display` are filled in at read time for human-friendly rendering
 * (e.g. resolving a category_id to its name).
 */
export interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
  label?: string;
  old_display?: string | null;
  new_display?: string | null;
}

/** A row of `item_change_log` (audit of item create/update/delete). */
export interface ItemChangeLog {
  id: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  action: ItemChangeAction;
  changes: FieldChange[];
  note: string | null;
  created_at: string;
  created_by: string | null;
  reverted_at: string | null;
  revert_of: string | null;
}

/** Unified daily-summary row: an item edit. */
export interface ItemChangeRow {
  kind: "item";
  id: string;
  created_at: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  action: ItemChangeAction;
  changes: FieldChange[];
  note: string | null;
  reverted_at: string | null;
  revert_of: string | null;
  /** True when a one-click undo can be offered for this entry. */
  can_undo: boolean;
}

/** Unified daily-summary row: a stock movement (from inventory_transactions). */
export interface StockChangeRow {
  kind: "stock";
  id: string;
  created_at: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  transaction_type: TransactionType;
  /** Signed delta as applied to stock (negative = outbound). */
  quantity: number;
  warehouse_id: string | null;
  warehouse_name: string | null;
  note: string | null;
  /** True when a reversing adjustment can be posted. */
  can_undo: boolean;
}

export type InventoryChangeRow = ItemChangeRow | StockChangeRow;

/** Human labels for the tracked item fields, used by the daily-changes UI. */
export const ITEM_FIELD_LABELS: Record<string, string> = {
  code: "Code",
  name: "Name",
  description: "Description",
  item_type: "Type",
  category_id: "Category",
  uom_id: "Unit",
  minimum_stock: "Minimum Stock",
  reorder_point: "Reorder Point",
  lead_time_days: "Lead Time (days)",
  cost_price: "Cost Price",
  procurement_type: "Make/Trade",
  stock_behaviour: "Stock Behaviour",
  suppliers: "Suppliers",
  is_active: "Active",
};

// --- Operations catalog (production-visibility Phase 0) -------------------

/**
 * The machine / station an operation runs on. Phase 0 only uses
 * `cnc_cutting` (the laser + punch nesting programs, where all the
 * co-production lives). The remaining values exist in the DB constraint
 * for later phases (bending, powder coat, manual fab) but aren't surfaced
 * in the UI yet.
 */
export type OperationMachine =
  | "cnc_cutting"
  | "cnc_punch"
  | "cnc_laser"
  | "cnc_bending"
  | "powder_coat"
  | "manual_cut"
  | "manual_weld"
  | "manual_fit"
  | "assembly_fit";

/** Human labels for each machine value, used across the Programs UI. */
export const OPERATION_MACHINE_LABELS: Record<OperationMachine, string> = {
  cnc_laser: "Laser Cutting",
  cnc_punch: "Punching",
  assembly_fit: "Assembly",
  // Legacy: programs created before laser/punch were split. Still rendered
  // so existing rows read correctly; re-tag via Edit. Not offered for new.
  cnc_cutting: "CNC Cutting",
  cnc_bending: "CNC Bending",
  powder_coat: "Powder Coat",
  manual_cut: "Manual Cut",
  manual_weld: "Manual Weld",
  manual_fit: "Manual Fit",
};

/**
 * Machine values offered in the Programs UI right now: the two cutting
 * machines (laser + punch, which run different programs) and Assembly.
 * `cnc_cutting` is a legacy value kept renderable for older rows but no
 * longer offered. Widen this list as later phases add their stations.
 */
export const OPERATION_MACHINES: OperationMachine[] = [
  "cnc_laser",
  "cnc_punch",
  "assembly_fit",
];

/** A program/recipe: one run produces many parts (the nest). */
export interface Operation {
  id: string;
  name: string;
  code: string | null;
  machine: OperationMachine;
  description: string | null;
  sketch_url: string | null;
  sketch_filename: string | null;
  sketch_uploaded_at: string | null;
  notes: string | null;
  is_active: boolean;
  /** Groups material/finish variants of the same base program. */
  family_key: string | null;
  /** e.g. "MS", "SS", "SS Rose Gold" — the variant's material/finish. */
  material_label: string | null;
  /** null = manually entered; a tag (e.g. "cnc_std_v1") marks bulk-imported rows. */
  import_source: string | null;
  /** Program-set grouping, e.g. "Standard Programs". */
  program_label: string | null;
  /** Set when the program has been reviewed/signed off; null = pending. */
  audited_at: string | null;
  audited_by: string | null;
  /** Machining time of one run in seconds (from the set-up schedule). */
  machining_time_seconds: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * A raw material consumed per run. `item_id` may be NULL ("to be filled") —
 * in that case `label` holds the captured original name to resolve later.
 */
export interface OperationInput {
  id: string;
  operation_id: string;
  item_id: string | null;
  label: string | null;
  qty_per_run: number;
  notes: string | null;
  sort_order: number;
  created_at: string;
}

/** A part produced per run. Same shape as OperationInput (item_id may be NULL). */
export interface OperationOutput {
  id: string;
  operation_id: string;
  item_id: string | null;
  label: string | null;
  qty_per_run: number;
  notes: string | null;
  sort_order: number;
  created_at: string;
}

export type PurchaseOrderStatus = "draft" | "ordered" | "received" | "cancelled";

/** A purchase order — one dated buy from a supplier (procurement Phase 0). */
export interface PurchaseOrder {
  id: string;
  supplier_name: string | null;
  status: PurchaseOrderStatus;
  order_date: string | null;
  expected_date: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** A line on a PO. Receiving posts inventory (purchase_in) for the unreceived qty. */
export interface PurchaseOrderLine {
  id: string;
  po_id: string;
  item_id: string;
  qty: number;
  unit_cost: number | null;
  received_qty: number;
  sort_order: number;
  created_at: string;
}

// Supabase Database type definition
export interface Database {
  public: {
    Tables: {
      units_of_measurement: {
        Row: UnitOfMeasurement;
        Insert: Omit<UnitOfMeasurement, "id" | "created_at">;
        Update: Partial<Omit<UnitOfMeasurement, "id" | "created_at">>;
      };
      item_categories: {
        Row: ItemCategory;
        Insert: Omit<ItemCategory, "id" | "created_at">;
        Update: Partial<Omit<ItemCategory, "id" | "created_at">>;
      };
      items: {
        Row: Item;
        Insert: Omit<Item, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Item, "id" | "created_at" | "updated_at">>;
      };
      warehouses: {
        Row: Warehouse;
        Insert: Omit<Warehouse, "id" | "created_at">;
        Update: Partial<Omit<Warehouse, "id" | "created_at">>;
      };
      inventory: {
        Row: Inventory;
        Insert: Omit<Inventory, "id" | "updated_at">;
        Update: Partial<Omit<Inventory, "id" | "updated_at">>;
      };
      inventory_transactions: {
        Row: InventoryTransaction;
        Insert: Omit<InventoryTransaction, "id" | "created_at">;
        Update: Partial<Omit<InventoryTransaction, "id" | "created_at">>;
      };
      bom_headers: {
        Row: BomHeader;
        Insert: Omit<BomHeader, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<BomHeader, "id" | "created_at" | "updated_at">>;
      };
      bom_lines: {
        Row: BomLine;
        Insert: Omit<BomLine, "id" | "created_at">;
        Update: Partial<Omit<BomLine, "id" | "created_at">>;
      };
      jobs: {
        Row: Job;
        Insert: Omit<Job, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Job, "id" | "created_at" | "updated_at">>;
      };
      job_bom_headers: {
        Row: JobBomHeader;
        Insert: Omit<JobBomHeader, "id" | "created_at">;
        Update: Partial<Omit<JobBomHeader, "id" | "created_at">>;
      };
      job_bom_lines: {
        Row: JobBomLine;
        Insert: Omit<JobBomLine, "id" | "created_at">;
        Update: Partial<Omit<JobBomLine, "id" | "created_at">>;
      };
      target_column_map: {
        Row: TargetColumnMap;
        Insert: Omit<TargetColumnMap, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<TargetColumnMap, "id" | "created_at" | "updated_at">>;
      };
      item_change_log: {
        Row: ItemChangeLog;
        Insert: Omit<ItemChangeLog, "id" | "created_at">;
        Update: Partial<Omit<ItemChangeLog, "id" | "created_at">>;
      };
      operations: {
        Row: Operation;
        Insert: Omit<Operation, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Operation, "id" | "created_at" | "updated_at">>;
      };
      operation_inputs: {
        Row: OperationInput;
        Insert: Omit<OperationInput, "id" | "created_at">;
        Update: Partial<Omit<OperationInput, "id" | "created_at">>;
      };
      operation_outputs: {
        Row: OperationOutput;
        Insert: Omit<OperationOutput, "id" | "created_at">;
        Update: Partial<Omit<OperationOutput, "id" | "created_at">>;
      };
      purchase_orders: {
        Row: PurchaseOrder;
        Insert: Omit<PurchaseOrder, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<PurchaseOrder, "id" | "created_at" | "updated_at">>;
      };
      purchase_order_lines: {
        Row: PurchaseOrderLine;
        Insert: Omit<PurchaseOrderLine, "id" | "created_at">;
        Update: Partial<Omit<PurchaseOrderLine, "id" | "created_at">>;
      };
    };
    Enums: {
      item_type: ItemType;
      transaction_type: TransactionType;
      job_status: JobStatus;
      uom_category: UomCategory;
    };
  };
}
