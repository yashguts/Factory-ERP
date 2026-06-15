"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { PackageCheck, Trash2, Loader2, FileText, Paperclip, Undo2 } from "lucide-react";
import {
  updatePurchaseOrder,
  updatePoLine,
  deletePoLine,
  deletePurchaseOrder,
  deleteReceipt,
  uploadReceiptInvoice,
  type PoLineDetail,
  type PoReceipt,
} from "@/lib/actions/procurement";
import { ReceiveModal } from "@/components/procurement/receive-modal";
import type { PurchaseOrder, PurchaseOrderStatus } from "@/lib/supabase/types";

const STATUS_BADGE: Record<PurchaseOrderStatus, BadgeVariant> = {
  draft: "neutral",
  ordered: "blue",
  received: "green",
  cancelled: "red",
};
const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  received: "Received",
  cancelled: "Cancelled",
};
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const rate = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN")}`;
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function PoDetailClient({
  po,
  lines,
  receipts,
}: {
  po: PurchaseOrder;
  lines: PoLineDetail[];
  receipts: PoReceipt[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const received = po.status === "received";
  const [rows, setRows] = useState<PoLineDetail[]>(lines);
  const [supplier, setSupplier] = useState(po.supplier_name ?? "");
  const [orderDate, setOrderDate] = useState(po.order_date ?? "");
  const [expectedDate, setExpectedDate] = useState(po.expected_date ?? "");
  const [note, setNote] = useState(po.note ?? "");
  const [showReceive, setShowReceive] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const totals = useMemo(() => {
    let qty = 0;
    let cost = 0;
    let unreceived = 0;
    let receivedLines = 0;
    for (const r of rows) {
      qty += r.qty;
      cost += r.qty * (r.unit_cost ?? 0);
      unreceived += Math.max(0, r.qty - r.received_qty);
      if (r.received_qty >= r.qty && r.qty > 0) receivedLines += 1;
    }
    return { qty, cost, unreceived, receivedLines };
  }, [rows]);

  const anyReceived = rows.some((r) => r.received_qty > 0);
  const partial = po.status !== "received" && po.status !== "cancelled" && anyReceived;

  const saveHeader = () => {
    startTransition(async () => {
      const res = await updatePurchaseOrder(po.id, {
        supplier_name: supplier.trim() || null,
        order_date: orderDate || null,
        expected_date: expectedDate || null,
        note: note.trim() || null,
      });
      if (!res.ok) toast.error(res.error);
      else toast.success("Saved");
    });
  };

  const setStatus = (status: PurchaseOrderStatus) => {
    startTransition(async () => {
      const res = await updatePurchaseOrder(po.id, { status });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  };

  const persistLine = (id: string, patch: { qty?: number; unit_cost?: number | null }) => {
    startTransition(async () => {
      const res = await updatePoLine(id, po.id, patch);
      if (!res.ok) toast.error(res.error);
    });
  };

  const removeLine = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    startTransition(async () => {
      const res = await deletePoLine(id, po.id);
      if (!res.ok) {
        toast.error(res.error);
        router.refresh();
      }
    });
  };

  const undoReceipt = (receiptId: string) => {
    startTransition(async () => {
      const res = await deleteReceipt(receiptId, po.id);
      setConfirmUndo(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Receipt undone — stock reversed.");
      router.refresh();
    });
  };

  const doDelete = () => {
    startTransition(async () => {
      const res = await deletePurchaseOrder(po.id);
      setConfirmDelete(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.push("/procurement");
    });
  };

  return (
    <div>
      <PageHeader
        onBack={() => router.push("/procurement")}
        title={
          <span className="flex items-center gap-2">
            {supplier.trim() || "Unassigned supplier"}
            <Badge variant={STATUS_BADGE[po.status]}>{STATUS_LABEL[po.status]}</Badge>
            {partial && (
              <span className="text-[11px] font-medium text-[var(--warning)]">
                · {totals.receivedLines}/{rows.length} lines received
              </span>
            )}
          </span>
        }
        subtitle={`${po.note ? `${po.note} · ` : ""}Purchase order · created ${new Date(po.created_at).toLocaleDateString("en-IN")}`}
        actions={
          <>
            {!received && (
              <Select
                size="sm"
                value={po.status}
                onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus)}
                disabled={isPending}
                className="w-[130px]"
                title="Purchase order status"
              >
                <option value="draft">Draft</option>
                <option value="ordered">Ordered</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            )}
            <Button
              size="sm"
              onClick={() => setShowReceive(true)}
              disabled={isPending || received || po.status === "cancelled" || totals.unreceived <= 0}
              title="Record a goods receipt (full or partial)"
            >
              <PackageCheck className="h-4 w-4 mr-1" />
              {received ? "Received" : "Receive"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={isPending}
              aria-label="Delete purchase order"
              title="Delete this purchase order"
              className="text-[var(--destructive)] hover:bg-[var(--destructive-bg)]"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        }
      />

      {/* Details */}
      <div className="card-surface p-3 mb-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Supplier</span>
            <Input size="sm" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" disabled={received} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Order date</span>
            <Input size="sm" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} disabled={received} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Expected</span>
            <Input size="sm" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} disabled={received} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Note</span>
            <Input size="sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" disabled={received} className="mt-1" />
          </label>
        </div>
        {!received && (
          <div className="flex justify-end mt-3">
            <Button size="sm" variant="secondary" onClick={saveHeader} disabled={isPending}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Save details
            </Button>
          </div>
        )}
      </div>

      <StatStrip className="mb-3">
        <StatTile label="Lines" value={rows.length} />
        <StatTile label="Total qty" value={totals.qty.toLocaleString()} />
        <StatTile label="Est. cost" value={totals.cost > 0 ? inr(totals.cost) : "—"} tone={totals.cost > 0 ? "primary" : "default"} />
        <StatTile label={received ? "Received" : "To receive"} value={received ? "✓" : totals.unreceived.toLocaleString()} tone={received ? "ok" : "warn"} />
      </StatStrip>

      <div className="card-surface overflow-hidden">
        <Table density="compact">
          <TableHeader sticky>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Reorder pt</TableHead>
              <TableHead className="text-right w-28">Order qty</TableHead>
              <TableHead className="text-right w-28">Unit cost</TableHead>
              <TableHead className="text-right">Line total</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/inventory/${r.item_id}`}
                    className="font-mono text-xs text-[var(--primary)] hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.item_code}
                  </Link>
                </TableCell>
                <TableCell className="font-medium">
                  {r.item_name}
                  {r.description && r.description !== r.item_name && (
                    <span className="block text-[11px] font-normal text-[var(--muted-foreground)]" title="Description on the original purchase order">
                      PO: {r.description}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">{r.on_hand.toLocaleString()}</TableCell>
                <TableCell className="text-right text-[var(--muted-foreground)]">
                  {r.reorder_point != null ? r.reorder_point.toLocaleString() : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    size="sm"
                    type="number"
                    min={1}
                    value={r.qty}
                    disabled={received}
                    className="w-24 text-right ml-auto"
                    onChange={(e) =>
                      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, qty: Number(e.target.value) } : x)))
                    }
                    onBlur={() => {
                      // DB enforces qty > 0 — clamp so a cleared/0 field can't hit a raw error.
                      const q = r.qty >= 1 ? r.qty : 1;
                      if (q !== r.qty) setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, qty: q } : x)));
                      persistLine(r.id, { qty: q });
                    }}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    size="sm"
                    type="number"
                    min={0}
                    step="0.01"
                    value={r.unit_cost ?? ""}
                    disabled={received}
                    placeholder="—"
                    className="w-24 text-right ml-auto"
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x) =>
                          x.id === r.id ? { ...x, unit_cost: e.target.value === "" ? null : Number(e.target.value) } : x,
                        ),
                      )
                    }
                    onBlur={() => persistLine(r.id, { unit_cost: r.unit_cost })}
                  />
                </TableCell>
                <TableCell className="text-right font-medium">
                  {r.unit_cost != null ? inr(r.qty * r.unit_cost) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {r.received_qty >= r.qty && r.qty > 0 ? (
                    <Badge variant="green">✓ {r.received_qty.toLocaleString()}</Badge>
                  ) : r.received_qty > 0 ? (
                    <span className="text-[var(--warning)] font-medium tabular-nums">
                      {r.received_qty.toLocaleString()} / {r.qty.toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {!received && (
                    <button
                      onClick={() => removeLine(r.id)}
                      aria-label="Remove line"
                      className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-bg)] cursor-pointer transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-[var(--muted-foreground)] py-6">
                  No lines on this purchase order.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Receipt history */}
      {receipts.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold mb-2">
            Receipts <span className="text-[var(--muted-foreground)] font-normal">({receipts.length})</span>
          </h3>
          <div className="space-y-2">
            {receipts.map((rec) => (
              <ReceiptCard
                key={rec.id}
                receipt={rec}
                poId={po.id}
                busy={isPending}
                onUndo={() => setConfirmUndo(rec.id)}
                onChanged={() => router.refresh()}
              />
            ))}
          </div>
        </div>
      )}

      {showReceive && (
        <ReceiveModal
          poId={po.id}
          lines={rows}
          onClose={() => setShowReceive(false)}
          onSaved={() => router.refresh()}
        />
      )}
      {confirmUndo && (
        <ConfirmDialog
          title="Undo this receipt?"
          message="This reverses the stock it added (a negative inventory adjustment) and reopens the purchase order. It does not change any purchase price already recorded."
          confirmLabel="Undo receipt"
          confirmVariant="destructive"
          busy={isPending}
          onConfirm={() => undoReceipt(confirmUndo)}
          onCancel={() => setConfirmUndo(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete purchase order?"
          message="This permanently removes the purchase order and its lines. It does not touch any stock already received."
          confirmLabel="Delete"
          confirmVariant="destructive"
          busy={isPending}
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ReceiptCard({
  receipt,
  poId,
  busy,
  onUndo,
  onChanged,
}: {
  receipt: PoReceipt;
  poId: string;
  busy: boolean;
  onUndo: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const totalQty = receipt.lines.reduce((a, l) => a + l.qty, 0);
  const totalValue = receipt.lines.reduce((a, l) => a + l.qty * (l.unit_rate ?? 0), 0);

  const attach = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.set("receiptId", receipt.id);
    fd.set("poId", poId);
    fd.set("file", file);
    const res = await uploadReceiptInvoice(fd);
    setUploading(false);
    if (!res.ok) toast.error(res.error);
    else {
      toast.success("Invoice attached.");
      onChanged();
    }
  };

  return (
    <div className="card-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{fmtDate(receipt.receipt_date)}</span>
          {receipt.invoice_number && (
            <span className="text-[var(--muted-foreground)]">Inv {receipt.invoice_number}</span>
          )}
          <span className="text-[var(--muted-foreground)]">
            · {receipt.lines.length} item{receipt.lines.length === 1 ? "" : "s"} · {totalQty.toLocaleString()} qty
            {totalValue > 0 ? ` · ${rate(totalValue)}` : ""}
          </span>
          {receipt.note && <span className="italic text-[var(--muted-foreground)]">· {receipt.note}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {receipt.invoice_url ? (
            <a
              href={receipt.invoice_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
            >
              <FileText className="h-3.5 w-3.5" />
              {receipt.invoice_filename ?? "Invoice"}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
              Attach invoice
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) attach(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            title="Undo this receipt (reverses stock)"
            className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--destructive)] cursor-pointer"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {receipt.lines.map((l) => (
          <span key={l.id} className="text-[var(--muted-foreground)]">
            <span className="font-mono text-[var(--foreground)]">{l.item_code}</span>{" "}
            {l.qty.toLocaleString()} {l.uom_abbreviation ?? ""}
            {l.unit_rate != null && <span> @ {rate(l.unit_rate)}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
