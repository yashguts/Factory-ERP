"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, PackageCheck, Paperclip, Plus, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import {
  recordReceipt,
  uploadReceiptInvoice,
  type PoLineDetail,
} from "@/lib/actions/procurement";
import {
  computeLanded,
  type LandedChargeInput,
  type LandedLineInput,
} from "@/lib/procurement/landed-cost";

const todayISO = () => new Date().toISOString().slice(0, 10);
const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN")}`;

/** Domestic additional-charge types (import customs come in Phase 3). */
const CHARGE_TYPES: { value: string; label: string }[] = [
  { value: "freight_in", label: "Freight (inbound)" },
  { value: "insurance", label: "Transit insurance" },
  { value: "packing_forwarding", label: "Packing & forwarding" },
  { value: "loading_unloading", label: "Loading / unloading" },
  { value: "handling", label: "Handling" },
  { value: "inspection", label: "Inspection / testing" },
  { value: "other", label: "Other" },
];

interface Row {
  po_line_id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  dual: boolean;
  orderAbbr: string | null;
  stockAbbr: string | null;
  perUnitStock: number | null;
  ordered: number;
  received: number;
  outstanding: number;
  qty: number;
  stockQty: number;
  rate: number | null;
  discountPct: number;
  gstRate: number | null; // pre-filled from item master (auto-learned)
  gstCreditable: boolean;
}

interface ChargeRow {
  key: string;
  chargeType: string;
  amount: number;
  creditable: boolean;
}

export function ReceiveModal({
  poId,
  lines,
  fxRate = 1,
  onClose,
  onSaved,
}: {
  poId: string;
  lines: PoLineDetail[];
  /** PO currency → INR (imports). Default 1 (domestic). */
  fxRate?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(todayISO());
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const chargeSeq = useRef(0);

  const [rows, setRows] = useState<Row[]>(() =>
    lines
      .map((l) => {
        const outstanding = Math.max(0, l.qty - l.received_qty);
        const dual = !!l.purchase_uom_id;
        const perUnitStock =
          dual && l.tentative_stock_qty != null && l.qty > 0
            ? l.tentative_stock_qty / l.qty
            : null;
        const seededStock =
          dual && perUnitStock != null
            ? Math.round(outstanding * perUnitStock * 1000) / 1000
            : outstanding;
        return {
          po_line_id: l.id,
          item_id: l.item_id,
          item_code: l.item_code,
          item_name: l.item_name,
          dual,
          orderAbbr: dual ? l.purchase_uom_abbreviation : l.uom_abbreviation,
          stockAbbr: l.uom_abbreviation,
          perUnitStock,
          ordered: l.qty,
          received: l.received_qty,
          outstanding,
          qty: outstanding,
          stockQty: seededStock,
          rate: l.unit_cost,
          discountPct: 0,
          gstRate: l.gst_rate, // null on first-ever receipt → confirm from invoice
          gstCreditable: l.gst_creditable ?? true,
        };
      })
      .filter((r) => r.outstanding > 0),
  );

  const update = (id: string, patch: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.po_line_id !== id) return r;
        const next = { ...r, ...patch };
        if (patch.qty !== undefined && patch.stockQty === undefined && r.dual && r.perUnitStock != null) {
          next.stockQty = Math.round((Number(patch.qty) || 0) * r.perUnitStock * 1000) / 1000;
        }
        return next;
      }),
    );
  const fillAll = () =>
    setRows((rs) =>
      rs.map((r) => ({
        ...r,
        qty: r.outstanding,
        stockQty:
          r.dual && r.perUnitStock != null
            ? Math.round(r.outstanding * r.perUnitStock * 1000) / 1000
            : r.stockQty,
      })),
    );
  const clearAll = () => setRows((rs) => rs.map((r) => ({ ...r, qty: 0 })));

  const addCharge = () =>
    setCharges((cs) => [
      ...cs,
      { key: `c${chargeSeq.current++}`, chargeType: "freight_in", amount: 0, creditable: false },
    ]);
  const updateCharge = (key: string, patch: Partial<ChargeRow>) =>
    setCharges((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const removeCharge = (key: string) => setCharges((cs) => cs.filter((c) => c.key !== key));

  const stockOf = (r: Row) =>
    r.dual ? (r.stockQty > 0 ? r.stockQty : r.perUnitStock != null ? r.qty * r.perUnitStock : r.qty) : r.qty;

  const active = rows.filter((r) => r.qty > 0);
  const totalStock = active.reduce((a, r) => a + stockOf(r), 0);

  // Live landed-cost preview — identical engine to the server's recordReceipt.
  const preview = useMemo(() => {
    const lineInputs: LandedLineInput[] = active.map((r) => ({
      key: r.po_line_id,
      unitRate: r.rate ?? 0,
      qty: r.qty,
      stockQty: stockOf(r),
      discountPct: r.discountPct,
      gstRate: r.gstRate ?? 0,
      gstCreditable: r.gstCreditable,
    }));
    const chargeInputs: LandedChargeInput[] = charges.map((c) => ({
      amountInr: (Number(c.amount) || 0) * (fxRate > 0 ? fxRate : 1),
      creditable: c.creditable,
    }));
    const results = computeLanded(lineInputs, chargeInputs, fxRate);
    const byLine = new Map(results.map((x) => [x.key, x]));
    const basic = results.reduce((a, x) => a + x.basicNet, 0);
    const ncTax = results.reduce((a, x) => a + x.nonCreditableTax, 0);
    const ncCharges = chargeInputs.filter((c) => !c.creditable).reduce((a, c) => a + c.amountInr, 0);
    const landed = results.reduce((a, x) => a + x.landedValue, 0);
    return { byLine, basic, ncTax, ncCharges, landed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, charges, fxRate]);

  const save = () => {
    if (active.length === 0) {
      toast.error("Enter a quantity for at least one item.");
      return;
    }
    startTransition(async () => {
      const res = await recordReceipt({
        poId,
        receiptDate: date,
        invoiceNumber: invoiceNumber || null,
        note: note || null,
        fxRate,
        lines: active.map((r) => ({
          poLineId: r.po_line_id,
          itemId: r.item_id,
          qty: r.qty,
          stockQty: stockOf(r),
          unitRate: r.rate,
          discountPct: r.discountPct || 0,
          gstRate: r.gstRate,
          gstCreditable: r.gstCreditable,
        })),
        charges: charges
          .filter((c) => Number(c.amount) > 0)
          .map((c) => ({
            chargeType: c.chargeType,
            amount: Number(c.amount),
            creditable: c.creditable,
          })),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (file) {
        const fd = new FormData();
        fd.set("receiptId", res.receiptId);
        fd.set("poId", poId);
        fd.set("file", file);
        const up = await uploadReceiptInvoice(fd);
        if (!up.ok) toast.error(`Received, but the invoice didn't upload: ${up.error}`);
      }
      toast.success(
        `Received ${active.length} item${active.length === 1 ? "" : "s"} · ${totalStock.toLocaleString()} units · landed ${inr(preview.landed)}.`,
      );
      onSaved();
      onClose();
    });
  };

  return (
    <Modal title="Receive items" onClose={onClose} className="max-w-5xl">
      <div className="space-y-4">
        {/* header fields */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Receipt date</span>
            <Input size="sm" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Invoice no.</span>
            <Input size="sm" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Optional" className="mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Note</span>
            <Input size="sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="mt-1" />
          </label>
          <div className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Invoice file</span>
            <div className="mt-1">
              {file ? (
                <div className="flex items-center gap-1.5 h-8 px-2 text-xs rounded-md border border-[var(--border)] bg-[var(--muted)]">
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate flex-1" title={file.name}>{file.name}</span>
                  <button type="button" onClick={() => setFile(null)} aria-label="Remove file" className="cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--destructive)]">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-1.5 h-8 px-2 text-xs rounded-md border border-dashed border-[var(--border)] cursor-pointer hover:bg-[var(--muted)] text-[var(--muted-foreground)]">
                  <Paperclip className="h-3.5 w-3.5" /> Attach PDF / image
                  <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              )}
            </div>
          </div>
        </div>

        {/* lines */}
        <div className="border border-[var(--border)] rounded-md overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-2 bg-[var(--muted)]/50 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            <span>Item</span>
            <span className="w-32 text-right">Ordered · left</span>
            <span className="w-24 text-right">Receive now</span>
            <span className="w-24 text-right">→ Stock</span>
            <span className="w-20 text-right">Rate ₹</span>
          </div>
          <div className="max-h-[42vh] overflow-y-auto divide-y divide-[var(--border)]">
            {rows.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[var(--muted-foreground)]">
                Everything on this purchase order is already received.
              </div>
            ) : (
              rows.map((r) => {
                const over = r.qty > r.outstanding;
                const stockNow = stockOf(r);
                const landedRow = preview.byLine.get(r.po_line_id);
                return (
                  <div key={r.po_line_id} className="px-3 py-2 space-y-1.5">
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate" title={r.item_name}>{r.item_name}</div>
                        <div className="text-[11px] text-[var(--muted-foreground)] font-mono">
                          {r.item_code}
                          {r.dual && (
                            <span className="ml-1.5 font-sans normal-case text-[var(--primary)]">bought in {r.orderAbbr}</span>
                          )}
                        </div>
                      </div>
                      <div className="w-32 text-right text-xs tabular-nums">
                        <span className="text-[var(--warning)] font-medium">{r.outstanding.toLocaleString()} {r.orderAbbr ?? ""} left</span>
                        <span className="block text-[10px] text-[var(--muted-foreground)]">{r.ordered.toLocaleString()} ord · {r.received.toLocaleString()} rcv</span>
                      </div>
                      <div className="w-24 flex items-center justify-end gap-1">
                        <input type="number" min={0} step="any" value={r.qty || ""} onChange={(e) => update(r.po_line_id, { qty: e.target.value ? Number(e.target.value) : 0 })}
                          className={`w-14 h-8 px-2 text-sm text-right rounded-md border bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${over ? "border-[var(--warning)]" : "border-[var(--border)]"}`}
                          title={over ? "More than what's outstanding" : undefined} />
                        <span className="w-6 text-[11px] text-[var(--muted-foreground)] text-center shrink-0 truncate" title={r.orderAbbr ?? ""}>{r.orderAbbr || "—"}</span>
                      </div>
                      <div className="w-24 flex items-center justify-end gap-1">
                        {r.dual ? (
                          <>
                            <input type="number" min={0} step="any" value={r.stockQty || ""} onChange={(e) => update(r.po_line_id, { stockQty: e.target.value ? Number(e.target.value) : 0 })}
                              className={`w-14 h-8 px-2 text-sm text-right rounded-md border bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${r.qty > 0 && stockNow <= 0 ? "border-[var(--warning)]" : "border-[var(--border)]"}`}
                              title="Actual stock counted on arrival — this is what posts to inventory" />
                            <span className="w-6 text-[11px] text-[var(--muted-foreground)] text-center shrink-0 truncate" title={r.stockAbbr ?? ""}>{r.stockAbbr || "—"}</span>
                          </>
                        ) : (
                          <span className="w-full text-[11px] text-[var(--muted-foreground)] text-right pr-1" title="Same as receive qty">—</span>
                        )}
                      </div>
                      <div className="w-20 text-right">
                        <input type="number" min={0} step="0.01" value={r.rate ?? ""} placeholder="—" onChange={(e) => update(r.po_line_id, { rate: e.target.value === "" ? null : Number(e.target.value) })}
                          className="w-20 h-8 px-2 text-sm text-right rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                          title={r.dual ? `Actual rate paid — per ${r.orderAbbr}` : "Actual rate paid"} />
                      </div>
                    </div>
                    {/* cost sub-row: discount · GST · creditable → landed/unit */}
                    {r.qty > 0 && (
                      <div className="flex items-center justify-end gap-3 text-[11px] text-[var(--muted-foreground)] pl-1">
                        <label className="flex items-center gap-1" title="Trade/quantity/cash discount %">
                          Disc
                          <input type="number" min={0} max={100} step="0.01" value={r.discountPct || ""} placeholder="0" onChange={(e) => update(r.po_line_id, { discountPct: e.target.value ? Number(e.target.value) : 0 })}
                            className="w-12 h-6 px-1 text-right rounded border border-[var(--border)] bg-[var(--background)]" />%
                        </label>
                        <label className="flex items-center gap-1" title="GST % — pre-filled from the item; confirm from the invoice">
                          GST
                          <input type="number" min={0} step="0.01" value={r.gstRate ?? ""} placeholder="0" onChange={(e) => update(r.po_line_id, { gstRate: e.target.value === "" ? null : Number(e.target.value) })}
                            className="w-12 h-6 px-1 text-right rounded border border-[var(--border)] bg-[var(--background)]" />%
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer" title="Creditable GST is recorded but EXCLUDED from cost (input tax credit). Uncheck to fold GST into cost.">
                          <input type="checkbox" checked={r.gstCreditable} onChange={(e) => update(r.po_line_id, { gstCreditable: e.target.checked })} />
                          ITC creditable
                        </label>
                        <span className="text-[var(--foreground)] font-medium tabular-nums">
                          Landed {landedRow ? inr(landedRow.landedUnitCost) : "—"}/{r.stockAbbr ?? "unit"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {rows.length > 0 && (
            <div className="flex items-center gap-3 px-3 py-2 border-t border-[var(--border)] text-[11px]">
              <button type="button" onClick={fillAll} className="font-medium text-[var(--primary)] hover:underline cursor-pointer">Receive all remaining</button>
              <button type="button" onClick={clearAll} className="text-[var(--muted-foreground)] hover:underline cursor-pointer">Clear</button>
            </div>
          )}
        </div>

        {/* additional charges */}
        <div className="border border-[var(--border)] rounded-md">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Additional charges <span className="font-normal normal-case">— freight, insurance, handling… (allocated by value)</span>
            </span>
            <button type="button" onClick={addCharge} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer">
              <Plus className="h-3 w-3" /> Add charge
            </button>
          </div>
          {charges.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-[var(--muted-foreground)]">No extra charges on this receipt.</div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {charges.map((c) => (
                <div key={c.key} className="flex items-center gap-2 px-3 py-1.5">
                  <select value={c.chargeType} onChange={(e) => updateCharge(c.key, { chargeType: e.target.value })}
                    className="h-8 px-2 text-sm rounded-md border border-[var(--border)] bg-[var(--background)]">
                    {CHARGE_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                  </select>
                  <input type="number" min={0} step="0.01" value={c.amount || ""} placeholder="Amount ₹" onChange={(e) => updateCharge(c.key, { amount: e.target.value ? Number(e.target.value) : 0 })}
                    className="w-32 h-8 px-2 text-sm text-right rounded-md border border-[var(--border)] bg-[var(--background)]" />
                  <label className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] cursor-pointer" title="Creditable (e.g. IGST) is excluded from cost.">
                    <input type="checkbox" checked={c.creditable} onChange={(e) => updateCharge(c.key, { creditable: e.target.checked })} /> creditable
                  </label>
                  <button type="button" onClick={() => removeCharge(c.key)} aria-label="Remove charge" className="ml-auto text-[var(--muted-foreground)] hover:text-[var(--destructive)] cursor-pointer">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* landed-cost summary */}
        {active.length > 0 && (
          <div className="rounded-md bg-[var(--muted)]/40 px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Basic <b className="tabular-nums">{inr(preview.basic)}</b></span>
            <span>+ Non-creditable GST <b className="tabular-nums">{inr(preview.ncTax)}</b></span>
            <span>+ Charges <b className="tabular-nums">{inr(preview.ncCharges)}</b></span>
            <span className="text-[var(--foreground)]">= Landed <b className="tabular-nums">{inr(preview.landed)}</b></span>
            <span className="text-[10px] text-[var(--muted-foreground)]">creditable GST excluded (claimed as ITC)</span>
          </div>
        )}

        <p className="text-[11px] text-[var(--muted-foreground)]">
          Posts the <b>→ Stock</b> quantities to Main Store and writes each item&rsquo;s <b>landed cost</b> to the price book.
          GST pre-fills from the item and is <b>learned</b> for next time. Creditable GST is excluded from cost.
        </p>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-[var(--border)]">
          <span className="text-xs text-[var(--muted-foreground)]">
            {active.length} item{active.length === 1 ? "" : "s"} · {totalStock.toLocaleString()} to stock · landed {inr(preview.landed)}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button onClick={save} disabled={isPending || active.length === 0}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5 mr-1.5" />}
              Receive
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
