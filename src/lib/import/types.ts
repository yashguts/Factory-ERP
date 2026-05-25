import type { ItemType } from "@/lib/supabase/types";

export interface ParsedRow {
  code: string;
  name: string;
  description: string;
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
