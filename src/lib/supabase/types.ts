export type ItemType = "raw_material" | "sub_assembly" | "finished_good" | "mechanical_finished_stock" | "door_panel";
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
  created_at: string;
  updated_at: string;
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
  cnc_cutting: "CNC Cutting",
  assembly_fit: "Assembly",
  cnc_punch: "CNC Punch",
  cnc_laser: "CNC Laser",
  cnc_bending: "CNC Bending",
  powder_coat: "Powder Coat",
  manual_cut: "Manual Cut",
  manual_weld: "Manual Weld",
  manual_fit: "Manual Fit",
};

/**
 * Machine values offered in the Programs UI right now. Phase 0 covers CNC
 * Cutting (raw sheet -> cut pieces) and Assembly (cut pieces + bought parts
 * -> sub-assembly). Widen this list as later phases add their stations.
 */
export const OPERATION_MACHINES: OperationMachine[] = [
  "cnc_cutting",
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
  created_at: string;
  updated_at: string;
}

/** A raw material consumed per run of an operation. */
export interface OperationInput {
  id: string;
  operation_id: string;
  item_id: string;
  qty_per_run: number;
  notes: string | null;
  sort_order: number;
  created_at: string;
}

/** A part produced per run of an operation. Same shape as OperationInput. */
export interface OperationOutput {
  id: string;
  operation_id: string;
  item_id: string;
  qty_per_run: number;
  notes: string | null;
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
    };
    Enums: {
      item_type: ItemType;
      transaction_type: TransactionType;
      job_status: JobStatus;
      uom_category: UomCategory;
    };
  };
}
