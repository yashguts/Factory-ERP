/** Client-safe types shared between the autofill modal and the job form. */
export type Confidence = "high" | "medium" | "low";

export interface SpecFieldSuggestion {
  value: string | number | null;
  confidence: Confidence;
  rationale: string;
}
export interface SpecSuggestion {
  floors: SpecFieldSuggestion;
  drive_type: SpecFieldSuggestion;
  capacity: SpecFieldSuggestion;
  door_finish: SpecFieldSuggestion;
  brand: SpecFieldSuggestion;
}
export interface SuggestedLine {
  section: string;
  phase: string;
  item_id: string;
  item_code: string;
  item_name: string;
  uom: string;
  suggestedQty: number;
  confidence: number;
  confidenceBand: Confidence;
  supportingJobs: string[];
}
export interface AutofillResult {
  /** true = the drawing was read by AI; false = used the spec already in the form. */
  drawingRead: boolean;
  /** Why the spec block is what it is. */
  specSource: "drawing" | "typed" | "none";
  /** null when drawing-reading isn't configured (no key). */
  spec: SpecSuggestion | null;
  bom: SuggestedLine[];
  neighbours: { job_number: string; sim: number }[];
  warnings: string[];
  overallConfidence: number;
}

/** What the engineer chose to apply — threaded to capture on Save for learning. */
export interface AppliedSuggestion {
  kind: "spec" | "bom_line";
  field: string; // spec field name, or the section category
  suggested_value: string | null; // spec value, or item_id
  suggested_qty: number | null;
  confidence: Confidence;
  provenance: string[];
}
