"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, PackageCheck, Paperclip, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import {
  recordReceipt,
  uploadReceiptInvoice,
  type PoLineDetail,
} from "@/lib/actions/procurement";

const todayISO = () => new Date().toISOString().slice(0, 10);
const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN")}`;

interface Row {
  po_line_id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  /** Dual-UOM line: Purchase UOM ≠ stock UOM. */
  dual: boolean;
  /** Order unit (Purchase UOM for dual lines, else the stock unit). */
  orderAbbr: string | null;
  /** Stock unit (what posts to inventory). */
  stockAbbr: string | null;
  /** Nominal stock units per 1 order unit (tentative ÷ ordered) — seeds stockQty. */
  perUnitStock: number | null;
  ordered: number; // order unit
  received: number; // order unit
  outstanding: number; // order unit
  qty: number; // receive now, order unit
  stockQty: number; // actual stock counted (dual); mirrors qty for same-UOM
  rate: number | null; // per order unit
}

/**
 * Record a (possibly partial) goods receipt against a PO: pick the date, attach
 * the invoice + invoice no., and per outstanding line enter how much arrived and
 * the rate paid. Posts the received qty to stock and feeds the item price book.
 */
export function ReceiveModal({
  poId,
  lines,
  onClose,
  onSaved,
}: {
  poId: string;
  lines: PoLineDetail[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(todayISO());
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [rows, setRows] = useState<Row[]>(() =>
    lines
      .map((l) => {
        const outstanding = Math.max(0, l.qty - l.received_qty);
        const dual = !!l.purchase_uom_id;
        // Nominal stock-per-order-unit from the tentative estimate (for seeding).
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
          qty: outstanding, // default: receive what's left (order unit)
          stockQty: seededStock, // default: tentative-prorated actual stock
          rate: l.unit_cost, // default to the ordered cost (editable, optional)
        };
      })
      .filter((r) => r.outstanding > 0),
  );

  const update = (id: string, patch: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.po_line_id !== id) return r;
        const next = { ...r, ...patch };
        // When the order qty changes on a dual line with a known nominal factor,
        // re-seed the actual stock (still editable — manual stockQty edits win).
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

  // Actual stock a row will post: counted figure for dual lines, else the qty.
  const stockOf = (r: Row) =>
    r.dual ? (r.stockQty > 0 ? r.stockQty : r.perUnitStock != null ? r.qty * r.perUnitStock : r.qty) : r.qty;

  const active = rows.filter((r) => r.qty > 0);
  const totalStock = active.reduce((a, r) => a + stockOf(r), 0);
  const totalValue = active.reduce((a, r) => a + r.qty * (r.rate ?? 0), 0);

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
        lines: active.map((r) => ({
          poLineId: r.po_line_id,
          itemId: r.item_id,
          qty: r.qty,
          stockQty: stockOf(r),
          unitRate: r.rate,
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
        `Received ${active.length} item${active.length === 1 ? "" : "s"} · ${totalStock.toLocaleString()} units into Main Store stock.`,
      );
      onSaved();
      onClose();
    });
  };

  return (
    <Modal title="Receive items" onClose={onClose} className="max-w-4xl">
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
            <span className="w-36 text-right">Ordered · left</span>
            <span className="w-28 text-right">Receive now</span>
            <span className="w-28 text-right">→ Stock</span>
            <span className="w-24 text-right">Rate ₹</span>
          </div>
          <div className="max-h-[45vh] overflow-y-auto divide-y divide-[var(--border)]">
            {rows.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[var(--muted-foreground)]">
                Everything on this purchase order is already received.
              </div>
            ) : (
              rows.map((r) => {
                const over = r.qty > r.outstanding;
                const stockNow = stockOf(r);
                return (
                  <div key={r.po_line_id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-2 items-center">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate" title={r.item_name}>{r.item_name}</div>
                      <div className="text-[11px] text-[var(--muted-foreground)] font-mono">
                        {r.item_code}
                        {r.dual && (
                          <span className="ml-1.5 font-sans normal-case text-[var(--primary)]">
                            bought in {r.orderAbbr}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="w-36 text-right text-xs tabular-nums">
                      <span className="text-[var(--warning)] font-medium">
                        {r.outstanding.toLocaleString()} {r.orderAbbr ?? ""} left
                      </span>
                      <span className="block text-[10px] text-[var(--muted-foreground)]">
                        {r.ordered.toLocaleString()} ordered · {r.received.toLocaleString()} received
                      </span>
                    </div>
                    <div className="w-28 flex items-center justify-end gap-1">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={r.qty || ""}
                        onChange={(e) => update(r.po_line_id, { qty: e.target.value ? Number(e.target.value) : 0 })}
                        className={`w-16 h-8 px-2 text-sm text-right rounded-md border bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${over ? "border-[var(--warning)]" : "border-[var(--border)]"}`}
                        title={over ? "More than what's outstanding" : undefined}
                      />
                      <span className="w-8 text-[11px] text-[var(--muted-foreground)] text-center shrink-0 truncate" title={r.orderAbbr ?? ""}>{r.orderAbbr || "—"}</span>
                    </div>
                    <div className="w-28 flex items-center justify-end gap-1">
                      {r.dual ? (
                        <>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={r.stockQty || ""}
                            onChange={(e) => update(r.po_line_id, { stockQty: e.target.value ? Number(e.target.value) : 0 })}
                            className={`w-16 h-8 px-2 text-sm text-right rounded-md border bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${r.qty > 0 && stockNow <= 0 ? "border-[var(--warning)]" : "border-[var(--border)]"}`}
                            title="Actual stock counted on arrival — this is what posts to inventory"
                          />
                          <span className="w-8 text-[11px] text-[var(--muted-foreground)] text-center shrink-0 truncate" title={r.stockAbbr ?? ""}>{r.stockAbbr || "—"}</span>
                        </>
                      ) : (
                        <span className="w-full text-[11px] text-[var(--muted-foreground)] text-right pr-1" title="Same as receive qty (stock unit = purchase unit)">—</span>
                      )}
                    </div>
                    <div className="w-24 text-right">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.rate ?? ""}
                        placeholder="—"
                        onChange={(e) => update(r.po_line_id, { rate: e.target.value === "" ? null : Number(e.target.value) })}
                        className="w-20 h-8 px-2 text-sm text-right rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                        title={r.dual ? `Actual rate paid — per ${r.orderAbbr} (optional)` : "Actual rate paid (optional)"}
                      />
                    </div>
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

        <p className="text-[11px] text-[var(--muted-foreground)]">
          This posts the <b>→ Stock</b> quantities to Main Store stock and records each rate as the item&rsquo;s
          purchase price. For items bought in a different unit, enter what arrived in the purchase unit and the
          actual stock count you measured. The rate and invoice are optional — you can fill them later.
        </p>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-[var(--border)]">
          <span className="text-xs text-[var(--muted-foreground)]">
            {active.length} item{active.length === 1 ? "" : "s"} · {totalStock.toLocaleString()} to stock
            {totalValue > 0 ? ` · ${inr(totalValue)}` : ""}
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
