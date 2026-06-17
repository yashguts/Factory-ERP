"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { Plus, Trash2, Loader2, Paperclip, X, FileText, ClipboardList, ShoppingCart, Sparkles } from "lucide-react";
import { createPurchaseOrder, recordPoDocument } from "@/lib/actions/procurement";
import { extractPoHeader } from "@/lib/actions/po-vision";
import { type SearchableItem } from "@/lib/actions/items";
import { ItemPicker } from "@/components/procurement/item-picker";
import { createClient } from "@/lib/supabase/client";
import type { UnitOfMeasurement } from "@/lib/supabase/types";

const PDF_BUCKET = "po-invoices";
const MAX_BYTES = 50 * 1024 * 1024;
// Cap for the auto-read call (the base64 goes through a serverless function).
const EXTRACT_MAX = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp",
]);

interface LineRow {
  key: string;
  item: SearchableItem | null;
  qty: string;
  unit_cost: string;
  /** Purchase UOM chosen for this line ("" ⇒ same as stock). */
  purchase_uom_id: string;
  /** Dual-UOM only: tentative stock-UOM qty (optional, user estimate). */
  tentative: string;
}

let _k = 0;
const nextKey = () => `r${_k++}`;

const emptyRow = (): LineRow => ({
  key: nextKey(),
  item: null,
  qty: "1",
  unit_cost: "",
  purchase_uom_id: "",
  tentative: "",
});

export function PoNewClient({ units }: { units: UnitOfMeasurement[] }) {
  const router = useRouter();
  const toast = useToast();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [poNumber, setPoNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<LineRow[]>([emptyRow()]);
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addRow = () => setRows((p) => [...p, emptyRow()]);
  const removeRow = (key: string) =>
    setRows((p) => (p.length === 1 ? p : p.filter((r) => r.key !== key)));
  const patchRow = (key: string, patch: Partial<LineRow>) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const estTotal = rows.reduce((a, r) => {
    const q = Number(r.qty) || 0;
    const c = Number(r.unit_cost) || 0;
    return a + q * c;
  }, 0);

  const fileToBase64 = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = typeof reader.result === "string" ? reader.result : "";
        const comma = res.indexOf(",");
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(f);
    });

  // On attach, read the PO with Claude vision and auto-fill the Order details —
  // only EMPTY fields, never clobbering what the user already typed. Best-effort:
  // any failure (incl. no API key) just leaves the fields for manual entry.
  const autoReadPo = async (f: File) => {
    if (f.size > EXTRACT_MAX) {
      setExtractMsg(`File is large (${(f.size / 1024 / 1024).toFixed(1)} MB) — fill the Order details manually.`);
      return;
    }
    setExtractMsg(null);
    setExtracting(true);
    try {
      const data = await fileToBase64(f);
      const res = await extractPoHeader({ data, mediaType: f.type, filename: f.name });
      if (!res.ok) {
        if (res.reason !== "not_configured") setExtractMsg(res.error);
        return;
      }
      const h = res.header;
      const filled: string[] = [];
      if (h.po_number && !poNumber.trim()) { setPoNumber(h.po_number); filled.push("PO number"); }
      if (h.supplier_name && !supplier.trim()) { setSupplier(h.supplier_name); filled.push("supplier"); }
      if (h.order_date && !orderDate) { setOrderDate(h.order_date); filled.push("order date"); }
      if (h.expected_date && !expectedDate) { setExpectedDate(h.expected_date); filled.push("expected date"); }
      if (h.note && !note.trim()) { setNote(h.note); filled.push("note"); }
      setExtractMsg(
        filled.length
          ? `Filled ${filled.join(", ")} from your PO — please review.`
          : "Couldn't read new details from this PO — enter the Order details manually.",
      );
    } catch {
      setExtractMsg("Couldn't read the PO — fill the Order details manually.");
    } finally {
      setExtracting(false);
    }
  };

  const pickFile = (f: File | null) => {
    setError(null);
    setExtractMsg(null);
    if (!f) { setFile(null); return; }
    if (f.size > MAX_BYTES) { setError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max is 50 MB.`); return; }
    if (!ALLOWED_MIME.has(f.type)) { setError(`Unsupported file type "${f.type}". Use PDF, PNG, JPG, or WebP.`); return; }
    setFile(f);
    void autoReadPo(f);
  };

  const submit = () => {
    setError(null);
    const num = poNumber.trim();
    if (!num) { setError("PO Number is required."); return; }
    const validLines = rows
      .filter((r) => r.item && Number(r.qty) > 0)
      .map((r) => {
        const dual = !!r.purchase_uom_id;
        return {
          item_id: r.item!.id,
          qty: Number(r.qty),
          unit_cost: r.unit_cost.trim() === "" ? null : Number(r.unit_cost),
          purchase_uom_id: r.purchase_uom_id || null,
          tentative_stock_qty: dual && r.tentative.trim() !== "" ? Number(r.tentative) : null,
        };
      });
    if (validLines.length === 0) { setError("Add at least one item with a quantity."); return; }

    startSave(async () => {
      const res = await createPurchaseOrder({
        po_number: num,
        supplier_name: supplier.trim() || null,
        order_date: orderDate || null,
        expected_date: expectedDate || null,
        note: note.trim() || null,
        lines: validLines,
      });
      if (!res.ok) { setError(res.error); return; }
      const poId = res.id;

      // Optional PO PDF — upload straight from the browser to storage (bypasses
      // the serverless body cap), then record the path on the PO.
      if (file) {
        try {
          const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
          const path = `${poId}/po-document/${Date.now()}-${safeName}`;
          const supabase = createClient();
          const { error: upErr } = await supabase.storage
            .from(PDF_BUCKET)
            .upload(path, file, { contentType: file.type, upsert: false });
          if (upErr) throw upErr;
          const rec = await recordPoDocument({ poId, path, filename: file.name });
          if (!rec.ok) throw new Error(rec.error);
        } catch (e) {
          toast.error(
            "PO created, but the PDF upload failed: " +
              (e instanceof Error ? e.message : "unknown error") +
              " — you can attach it from the PO page.",
          );
          router.push(`/procurement/${poId}`);
          return;
        }
      }

      toast.success(`Purchase order ${num} created.`);
      router.push(`/procurement/${poId}`);
    });
  };

  return (
    <div>
      <PageHeader
        onBack={() => router.push("/procurement")}
        title="Add Purchase Order"
        subtitle="Create a purchase order manually and (optionally) attach its PDF copy."
      />

      {error && (
        <div className="mb-3 p-3 text-sm bg-[var(--destructive-bg)] text-[var(--destructive)] rounded-md border border-[var(--destructive-border)]">
          {error}
        </div>
      )}

      {(extracting || extractMsg) && (
        <div className="mb-3 flex items-center gap-2 p-3 text-sm rounded-md border border-[var(--border)] bg-[var(--accent)] text-[var(--accent-foreground)]">
          {extracting ? (
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1">
            {extracting ? "Reading your PO and filling the Order details…" : extractMsg}
          </span>
          {!extracting && (
            <button
              type="button"
              onClick={() => setExtractMsg(null)}
              aria-label="Dismiss"
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Header fields */}
      <div className="card-surface p-3 mb-3">
        <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5">
          <ShoppingCart className="h-4 w-4 text-[var(--muted-foreground)]" />
          Order details
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">PO Number *</span>
            <Input size="md" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PO-2026-001" className="mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Supplier</span>
            <Input size="md" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" className="mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Order date</span>
            <Input size="md" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Expected</span>
            <Input size="md" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="mt-1" />
          </label>
          <label className="block md:col-span-4">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Note</span>
            <Input size="md" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="mt-1" />
          </label>
        </div>
      </div>

      {/* Line items */}
      <div className="card-surface p-3 mb-3">
        <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5">
          <ClipboardList className="h-4 w-4 text-[var(--muted-foreground)]" />
          Line items
        </h3>
        <div className="hidden md:flex items-center gap-2.5 px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <span className="flex-1">Item</span>
          <span className="w-40">Purchase unit</span>
          <span className="w-28 text-right">Qty</span>
          <span className="w-28 text-right">Tentative</span>
          <span className="w-28 text-right">Unit cost</span>
          <span className="w-24 text-right">Amount</span>
          <span className="w-8" />
        </div>
        <div className="space-y-2">
          {rows.map((r) => {
            const unit = r.purchase_uom_id ? units.find((u) => u.id === r.purchase_uom_id) : null;
            const dual = !!unit;
            const orderAbbr = dual ? (unit!.abbreviation || "unit") : (r.item?.uom_abbreviation ?? "");
            const stockAbbr = r.item?.uom_abbreviation ?? "";
            const amount = (Number(r.qty) || 0) * (Number(r.unit_cost) || 0);
            return (
              <div key={r.key} className="rounded-md border border-[var(--border)] bg-[var(--card)] p-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex-1 min-w-0">
                    <ItemPicker
                      value={r.item}
                      onPick={(item) => patchRow(r.key, { item })}
                    />
                  </div>
                  <Select
                    size="md"
                    value={r.purchase_uom_id}
                    onChange={(e) => patchRow(r.key, { purchase_uom_id: e.target.value })}
                    className="w-40 shrink-0"
                    title="Purchase unit for this line (varies by vendor)"
                  >
                    <option value="">Stock unit{stockAbbr ? ` (${stockAbbr})` : ""}</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.abbreviation ? ` (${u.abbreviation})` : ""}
                      </option>
                    ))}
                  </Select>
                  <div className="w-28 shrink-0 flex items-center gap-1">
                    <Input
                      size="md" type="number" min={0} step="any" value={r.qty}
                      onChange={(e) => patchRow(r.key, { qty: e.target.value })}
                      placeholder="0" className="flex-1 min-w-0 text-right" title="Order quantity"
                    />
                    <span className="w-7 shrink-0 text-xs text-[var(--muted-foreground)] truncate" title={orderAbbr}>{orderAbbr}</span>
                  </div>
                  <div className="w-28 shrink-0 flex items-center gap-1">
                    {dual ? (
                      <>
                        <Input
                          size="md" type="number" min={0} step="any" value={r.tentative}
                          onChange={(e) => patchRow(r.key, { tentative: e.target.value })}
                          placeholder="≈" className="flex-1 min-w-0 text-right"
                          title="Tentative stock quantity — actual counted at receiving (optional)"
                        />
                        <span className="w-7 shrink-0 text-xs text-[var(--muted-foreground)] truncate" title={stockAbbr}>{stockAbbr}</span>
                      </>
                    ) : (
                      <span className="w-full text-right text-xs text-[var(--muted-foreground)] pr-1" title="Pick a purchase unit to estimate stock">—</span>
                    )}
                  </div>
                  <div className="w-28 shrink-0 flex items-center gap-1">
                    <Input
                      size="md" type="number" min={0} step="0.01" value={r.unit_cost}
                      onChange={(e) => patchRow(r.key, { unit_cost: e.target.value })}
                      placeholder="—" className="flex-1 min-w-0 text-right"
                      title={dual ? `Unit cost — per ${orderAbbr} (optional)` : "Unit cost (optional)"}
                    />
                    <span className="w-7 shrink-0 text-xs text-[var(--muted-foreground)] truncate">{dual && orderAbbr ? `/${orderAbbr}` : ""}</span>
                  </div>
                  <div className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
                    {amount > 0 ? `₹${Math.round(amount).toLocaleString("en-IN")}` : <span className="text-[var(--muted-foreground)]">—</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow(r.key)}
                    disabled={rows.length === 1}
                    aria-label="Remove line"
                    className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-bg)] disabled:opacity-30 cursor-pointer transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[var(--border)]">
          <Button size="sm" variant="secondary" onClick={addRow}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add line
          </Button>
          <div className="flex items-baseline gap-2">
            <span className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Estimated total</span>
            <span className="text-base font-semibold tabular-nums">{estTotal > 0 ? `₹${Math.round(estTotal).toLocaleString("en-IN")}` : "—"}</span>
          </div>
        </div>
      </div>

      {/* PO PDF copy */}
      <div className="card-surface p-3 mb-3">
        <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5">
          <FileText className="h-4 w-4 text-[var(--muted-foreground)]" />
          PO PDF copy <span className="font-normal text-[var(--muted-foreground)]">(optional)</span>
        </h3>
        <p className="text-[11px] text-[var(--muted-foreground)] -mt-1 mb-2 inline-flex items-center gap-1">
          <Sparkles className="h-3 w-3" />
          Attach the supplier&rsquo;s PO and the Order details above fill in automatically.
        </p>
        {file ? (
          <div className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <span className="inline-flex items-center gap-2 truncate">
              <Paperclip className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <span className="truncate">{file.name}</span>
              <span className="text-[var(--muted-foreground)]">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
            </span>
            <button type="button" onClick={() => pickFile(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer" aria-label="Remove file">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-3.5 w-3.5 mr-1.5" /> Attach PDF / image
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*"
          className="hidden"
          onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.push("/procurement")} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
          Create PO
        </Button>
      </div>
    </div>
  );
}
