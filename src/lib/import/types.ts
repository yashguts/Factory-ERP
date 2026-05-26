import type { ItemType } from "@/lib/supabase/types";

export interface ParsedRow {
  code: string;
  name: string;
  description: string;
  lookup_key: string;
  item_type: ItemType;
  category_name: string;
  sub_category_name: string;
  current_stock: number;
  uom: string;
}

export interface ImportPreviewRow extends ParsedRow {
  row_number: number;
  status: "valid" | "error" | "duplicate";
  error?: string;
  selected: boolean;
}

export interface ImportResult {
  total: number;
  created: number;
  stock_set: number;
  errors: { row: number; message: string }[];
}

export type ImportTemplate = "door-panels" | "finished-stock";

// --- Job Import Types ---

export interface ParsedJobRow {
  job_number: string;
  customer_name: string;
  progress: number;
  spec_string: string;
  door_finish: string;
  location: string;
  expected_delivery: string | null;
  remark: string;
  order_date: string | null;
  floors: number | null;
  door_type: string | null;
  drive_type: string | null;
  capacity: string | null;
  brand: string | null;
}

export interface JobImportPreviewRow extends ParsedJobRow {
  row_number: number;
  status: "new" | "update" | "error";
  error?: string;
  selected: boolean;
  bom_item_count: number;
}

export interface ColumnMatchResult {
  column_index: number;
  column_label: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  match_status: "matched" | "unmatched" | "skipped";
}

export interface JobImportResult {
  total_jobs: number;
  created: number;
  updated: number;
  bom_lines_created: number;
  errors: { row: number; message: string }[];
}
