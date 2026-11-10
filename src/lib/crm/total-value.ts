/**
 * CRM job total value (base + GST).
 *
 * The CRM stores a `contract_value` plus a `gst_treatment` flag:
 *   - "Exclusive" → contract_value is BEFORE GST, so the job's total value is
 *     contract_value + GST (at the job's gst_rate, default 18% for lifts).
 *   - "Inclusive" → contract_value ALREADY includes GST, so the total value
 *     IS the contract_value.
 * Unknown / missing treatment falls back to the contract value unchanged so we
 * never silently inflate a figure we're unsure about.
 */

const DEFAULT_GST_RATE = 18;

export function crmTotalValue(s: {
  contractValue?: number | null;
  gstTreatment?: string | null;
  gstRate?: number | null;
}): number | null {
  if (s.contractValue === null || s.contractValue === undefined) return null;
  if ((s.gstTreatment ?? "").trim().toLowerCase() === "exclusive") {
    const rate = s.gstRate ?? DEFAULT_GST_RATE;
    return s.contractValue * (1 + rate / 100);
  }
  // Inclusive or unknown: the contract value already is the total.
  return s.contractValue;
}
