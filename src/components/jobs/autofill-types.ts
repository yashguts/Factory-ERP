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
/**
 * A raw fact read straight off the drawing (door type, rail gap, travel, …) that the
 * predictor consumed internally. Surfaced read-only so the engineer can verify the
 * vision read and catch a misread before it silently flips a prediction.
 */
export interface DrawingRead {
  label: string;
  value: string;
  confidence?: Confidence;
  /** Short "what this drives" note, e.g. "sets the main-bracket projection class". */
  note?: string;
}

/**
 * A section deliberately left for MANUAL fill (the drawing doesn't reliably carry it),
 * with the reason + any drawing-derived hints to speed the manual entry. Read-only —
 * never applied as a BOM line (these sections are suppressed by design).
 */
export interface ManualSectionHint {
  section: string;
  reason: string;
  hints: { label: string; value: string }[];
}

export interface AutofillResult {
  /** true = the drawing was read by AI; false = used the spec already in the form. */
  drawingRead: boolean;
  /** Why the spec block is what it is. */
  specSource: "drawing" | "typed" | "none";
  /** null when drawing-reading isn't configured (no key). */
  spec: SpecSuggestion | null;
  bom: SuggestedLine[];
  /** Raw drawing reads beyond the 5 spec fields — only populated when the drawing was read. */
  drawingReads?: DrawingRead[];
  /** Suppressed sections left for manual fill, with drawing-derived hints. */
  manualSections?: ManualSectionHint[];
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
