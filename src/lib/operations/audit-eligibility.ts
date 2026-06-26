import {
  OPERATION_MACHINES,
  type OperationMachine,
  type OutputRole,
} from "@/lib/supabase/types";

/**
 * Single source of truth for "can this program be marked audited?".
 *
 * Pure (no server/client deps) so the server action, the Programs list and the
 * program detail page all enforce the SAME rules. Owner's rules: a program may
 * only be audited when it has mapped inputs AND resolved outputs AND a material/
 * finish AND a canonical type. (Description is intentionally NOT a rule.)
 */

/** The only output role that must map to a real stocked inventory item. */
export const OUTPUT_STOCK_ROLE: OutputRole = "component";

/**
 * An output line is "resolved" when it links to a real item OR is intentionally
 * not stocked (cut_part / tooling / scrap). Only an unmapped 'component' output
 * is a true gap. Mirrors the existing "Ready" badge logic.
 */
export function isOutputResolved(line: {
  item_id: string | null;
  role?: OutputRole | null;
}): boolean {
  return !!line.item_id || (line.role ?? OUTPUT_STOCK_ROLE) !== OUTPUT_STOCK_ROLE;
}

/** `machine` is one of the canonical program types (Punching / Laser / Assembly). */
export function isCanonicalMachine(
  machine: OperationMachine | null | undefined,
): boolean {
  return machine != null && OPERATION_MACHINES.includes(machine);
}

/** Normalised inputs to the audit-eligibility rules. */
export interface AuditSummary {
  inputCount: number;
  /** Input lines with no inventory item (item_id null / to-be-filled). */
  inputUnmapped: number;
  outputCount: number;
  /** Output lines that are neither item-linked nor a non-stock role. */
  outputUnresolved: number;
  hasMaterial: boolean;
  /** machine is a canonical program type. */
  typeOk: boolean;
}

/** Human-readable reasons a program may NOT be marked audited. Empty ⇒ eligible. */
export function auditBlockers(s: AuditSummary): string[] {
  const reasons: string[] = [];

  if (s.inputCount === 0) {
    reasons.push("Add at least one input (consumed per run).");
  } else if (s.inputUnmapped > 0) {
    reasons.push(
      `${s.inputUnmapped} input${s.inputUnmapped === 1 ? "" : "s"} not mapped to an inventory item.`,
    );
  }

  if (s.outputCount === 0) {
    reasons.push("Add at least one output (produced per run).");
  } else if (s.outputUnresolved > 0) {
    reasons.push(
      `${s.outputUnresolved} output${s.outputUnresolved === 1 ? "" : "s"} not mapped to an inventory item.`,
    );
  }

  if (!s.hasMaterial) reasons.push("Set the Material / finish.");
  if (!s.typeOk) {
    reasons.push("Set the program Type (Punching, Laser Cutting or Assembly).");
  }

  return reasons;
}

/** True when the program meets every audit rule. */
export function isAuditable(s: AuditSummary): boolean {
  return auditBlockers(s).length === 0;
}

/** Build a summary from the light Programs-list row (counts already computed). */
export function summaryFromCounts(row: {
  input_count: number;
  input_matched: number;
  output_count: number;
  output_matched: number;
  material_label: string | null;
  machine: OperationMachine;
}): AuditSummary {
  return {
    inputCount: row.input_count,
    inputUnmapped: Math.max(0, row.input_count - row.input_matched),
    outputCount: row.output_count,
    outputUnresolved: Math.max(0, row.output_count - row.output_matched),
    hasMaterial: !!row.material_label && row.material_label.trim() !== "",
    typeOk: isCanonicalMachine(row.machine),
  };
}

/** Build a summary from raw input/output lines (detail page + server guard). */
export function summaryFromLines(
  op: { material_label: string | null; machine: OperationMachine },
  inputs: { item_id: string | null }[],
  outputs: { item_id: string | null; role?: OutputRole | null }[],
): AuditSummary {
  return {
    inputCount: inputs.length,
    inputUnmapped: inputs.filter((l) => !l.item_id).length,
    outputCount: outputs.length,
    outputUnresolved: outputs.filter((l) => !isOutputResolved(l)).length,
    hasMaterial: !!op.material_label && op.material_label.trim() !== "",
    typeOk: isCanonicalMachine(op.machine),
  };
}
