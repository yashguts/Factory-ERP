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
  created_at: string;
  updated_at: string;
}

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
    };
    Enums: {
      item_type: ItemType;
      transaction_type: TransactionType;
      job_status: JobStatus;
      uom_category: UomCategory;
    };
  };
}
