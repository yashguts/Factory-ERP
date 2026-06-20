/**
 * Landed-cost engine — the single source of truth for "exact product costing".
 * Pure (no imports), so the server (recordReceipt) and the receive-modal live
 * preview compute identical numbers.
 *
 * Per receipt line, all in INR:
 *   basic_net   = unit_rate × qty × fx_rate × (1 − discount_pct/100)
 *   gst_amount  = basic_net × gst_rate/100
 *   nc_line_tax = gst_creditable ? 0 : gst_amount         (creditable GST excluded)
 *   alloc       = Σ(non-creditable charges, INR) × basic_net / Σ basic_net
 *   landed_unit_cost = (basic_net + nc_line_tax + alloc) / stock_qty
 *
 * Creditable GST/IGST is recorded elsewhere but NOT costed (claimed as ITC).
 * Charge allocation is BY LINE VALUE; if every line's basic_net is 0 we fall
 * back to splitting by stock_qty so charges are never lost.
 */

export interface LandedLineInput {
  /** Stable identifier (item_id, po_line_id, or row index as string). */
  key: string;
  /** Rate paid per ORDER unit, in the PO currency (converted via fxRate). */
  unitRate: number;
  /** Quantity in the ORDER unit. */
  qty: number;
  /** Actual stock-UOM qty counted (what posts to inventory). */
  stockQty: number;
  discountPct?: number;
  /** GST % for this line (already resolved from item default if needed). */
  gstRate?: number;
  /** When false, this line's GST is folded INTO landed cost. Default true. */
  gstCreditable?: boolean;
}

export interface LandedChargeInput {
  /** Charge amount already converted to INR (amount × its own fx_rate). */
  amountInr: number;
  /** Creditable charges (e.g. IGST on imports) are excluded from cost. */
  creditable: boolean;
}

export interface LandedLineResult {
  key: string;
  /** Basic value net of discount, in INR. */
  basicNet: number;
  /** Full GST on the line, in INR (recorded even when creditable). */
  gstAmount: number;
  /** GST actually added to cost (0 when creditable). */
  nonCreditableTax: number;
  /** Share of non-creditable charges allocated to this line, in INR. */
  allocatedCharge: number;
  /** basicNet + nonCreditableTax + allocatedCharge, in INR. */
  landedValue: number;
  /** landedValue / stockQty — what gets written to items.cost_price. */
  landedUnitCost: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeLanded(
  lines: LandedLineInput[],
  charges: LandedChargeInput[],
  fxRate = 1,
): LandedLineResult[] {
  const fx = fxRate > 0 ? fxRate : 1;
  const ncCharges = charges
    .filter((c) => !c.creditable)
    .reduce((a, c) => a + (Number(c.amountInr) || 0), 0);

  const base = lines.map((l) => {
    const basicNet =
      (Number(l.unitRate) || 0) *
      (Number(l.qty) || 0) *
      fx *
      (1 - (Number(l.discountPct) || 0) / 100);
    const gstAmount = basicNet * ((Number(l.gstRate) || 0) / 100);
    const creditable = l.gstCreditable ?? true;
    return {
      key: l.key,
      basicNet,
      gstAmount,
      nonCreditableTax: creditable ? 0 : gstAmount,
      stockQty: Number(l.stockQty) || 0,
    };
  });

  const totalBasis = base.reduce((a, b) => a + b.basicNet, 0);
  const totalStock = base.reduce((a, b) => a + b.stockQty, 0);

  return base.map((b) => {
    const share =
      totalBasis > 0
        ? b.basicNet / totalBasis
        : totalStock > 0
          ? b.stockQty / totalStock
          : 0;
    const allocatedCharge = ncCharges * share;
    const landedValue = b.basicNet + b.nonCreditableTax + allocatedCharge;
    const landedUnitCost = b.stockQty > 0 ? landedValue / b.stockQty : 0;
    return {
      key: b.key,
      basicNet: round2(b.basicNet),
      gstAmount: round2(b.gstAmount),
      nonCreditableTax: round2(b.nonCreditableTax),
      allocatedCharge: round2(allocatedCharge),
      landedValue: round2(landedValue),
      landedUnitCost: round2(landedUnitCost),
    };
  });
}
