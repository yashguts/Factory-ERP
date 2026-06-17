"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { Plus, Trash2, Loader2, Paperclip, X } from "lucide-react";
import { createPurchaseOrder, recordPoDocument } from "@/lib/actions/procurement";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import { createClient } from "@/lib/supabase/client";

const PDF_BUCKET = "po-invoices";
const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp",
]);

interface LineRow {
  key: string;
  item: SearchableItem | null;
  qty: string;
  unit_cost: string;
}

let _k = 0;
const nextKey = () => `r${_k++}`;

export function PoNewClient() {
  const router = useRouter();
  const toast = useToast();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [poNumber, setPoNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<LineRow[]>([{ key: nextKey(), item: null, qty: "1", unit_cost: "" }]);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addRow = () =>
    setRows((p) => [...p, { key: nextKey(), item: null, qty: "1", unit_cost: "" }]);
  const removeRow = (key: string) =>
    setRows((p) => (p.length === 1 ? p : p.filter((r) => r.key !== key)));
  const patchRow = (key: string, patch: Partial<LineRow>) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const estTotal = rows.reduce((a, r) => {
    const q = Number(r.qty) || 0;
    const c = Number(r.unit_cost) || 0;
    return a + q * c;
  }, 0);

  const pickFile = (f: File | null) => {
    setError(null);
    if (!f) { setFile(null); return; }
    if (f.size > MAX_BYTES) { setError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max is 50 MB.`); return; }
    if (!ALLOWED_MIME.has(f.type)) { setError(`Unsupported file type "${f.type}". Use PDF, PNG, JPG, or WebP.`); return; }
    setFile(f);
  };

  const submit = () => {
    setError(null);
    const num = poNumber.trim();
    if (!num) { setError("PO Number is required."); return; }
    const validLines = rows
      .filter((r) => r.item && Number(r.qty) > 0)
      .map((r) => ({
        item_id: r.item!.id,
        qty: Number(r.qty),
        unit_cost: r.unit_cost.trim() === "" ? null : Number(r.unit_cost),
      }));
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

      {/* Header fields */}
      <div className="card-surface p-3 mb-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">PO Number *</span>
            <Input size="sm" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PO-2026-001" className="mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Supplier</span>
            <Input size="sm" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" className="mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Order date</span>
            <Input size="sm" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Expected</span>
            <Input size="sm" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="mt-1" />
          </label>
          <label className="block md:col-span-4">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Note</span>
            <Input size="sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="mt-1" />
          </label>
        </div>
      </div>

      {/* Line items */}
      <div className="card-surface p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Line items</h3>
          <span className="text-xs text-[var(--muted-foreground)]">
            Est. total: {estTotal > 0 ? `₹${Math.round(estTotal).toLocaleString("en-IN")}` : "—"}
          </span>
        </div>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <ItemPicker
                  value={r.item}
                  onPick={(item) => patchRow(r.key, { item })}
                />
              </div>
              <Input
                size="sm" type="number" min={1} value={r.qty}
                onChange={(e) => patchRow(r.key, { qty: e.target.value })}
                placeholder="Qty" className="w-20 text-right" title="Quantity"
              />
              <Input
                size="sm" type="number" min={0} step="0.01" value={r.unit_cost}
                onChange={(e) => patchRow(r.key, { unit_cost: e.target.value })}
                placeholder="Rate" className="w-24 text-right" title="Unit cost (optional)"
              />
              <button
                type="button"
                onClick={() => removeRow(r.key)}
                disabled={rows.length === 1}
                aria-label="Remove line"
                className="mt-1.5 p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-bg)] disabled:opacity-30 cursor-pointer transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={addRow} className="mt-2">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add line
        </Button>
      </div>

      {/* PO PDF copy */}
      <div className="card-surface p-3 mb-3">
        <h3 className="text-sm font-semibold mb-2">PO PDF copy <span className="font-normal text-[var(--muted-foreground)]">(optional)</span></h3>
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

/* ------------------------------------------------------------------ */
/* Item search-picker (server-backed; mirrors the stock-adjust modal). */

function ItemPicker({
  value,
  onPick,
}: {
  value: SearchableItem | null;
  onPick: (item: SearchableItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await searchItems(query, undefined, 30);
        if (!cancelled) { setResults(res); setHi(0); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const choose = (item: SearchableItem) => {
    onPick(item);
    setQuery("");
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[hi]) choose(results[hi]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  const reopen = () => { setQuery(""); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); };

  return (
    <div ref={wrapRef} className="relative">
      {value && !open ? (
        <div
          className="flex items-center justify-between h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm cursor-pointer"
          onClick={reopen}
        >
          <span className="truncate">
            <span className="font-mono text-[var(--muted-foreground)]">{value.code}</span>
            {" — "}{value.name}
          </span>
          <span className="ml-2 shrink-0 text-[11px] text-[var(--muted-foreground)]">change</span>
        </div>
      ) : (
        <Input
          ref={inputRef}
          size="sm"
          placeholder="Search item by name, code, or lookup key…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
      )}
      {open && (
        <div
          ref={listRef}
          className="fixed z-[200] max-h-60 overflow-auto rounded-md border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-xl)]"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {loading && results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-[var(--muted-foreground)]">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-[var(--muted-foreground)]">No items found</div>
          ) : (
            results.map((item, idx) => (
              <div
                key={item.id}
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                  idx === hi ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--foreground)] hover:bg-[var(--muted)]"
                }`}
                onMouseEnter={() => setHi(idx)}
                onClick={() => choose(item)}
              >
                <span className={idx === hi ? "opacity-80" : "text-[var(--muted-foreground)]"}>{item.code}</span>
                {" — "}{item.name}
                <span className={idx === hi ? "opacity-70" : "text-[var(--muted-foreground)]"}> · stock {item.total_stock.toLocaleString()}{item.uom_abbreviation ? ` ${item.uom_abbreviation}` : ""}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
