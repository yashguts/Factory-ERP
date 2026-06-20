/** Shared types for the brain-generated Part List draft (UI + server action). */

export type Confidence = "high" | "medium" | "low";

export interface DraftLine {
  sectionKey: string;
  label: string;
  group: string; // "PART A".."PART E"
  captureType: "item" | "free";
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  spec: string | null;
  qty: number;
  /** Where the values came from, e.g. "BOM", "BOM + travel", "similar job", "formula". */
  source: string;
  confidence: Confidence;
  is_conflict: boolean;
  conflict_note: string | null;
  /** item-type line with no resolved SKU → engineer must pick/create or free-text. */
  needs_item: boolean;
  bom_line_id: string | null;
}

export interface UnmappedBom {
  id: string;
  category: string;
  item_name: string | null;
  item_code: string | null;
  qty: number;
}

export interface BomCoverage {
  total: number;
  covered: number;
  unmapped: UnmappedBom[];
}

export interface PartListDraft {
  lines: DraftLine[];
  coverage: BomCoverage;
  neighbours: { sheet: string; sim: number }[];
  drawingRead: boolean;
  doorType: string | null;
  warnings: string[];
}
