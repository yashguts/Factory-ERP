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
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { PackageCheck, Trash2, Loader2, FileText, Paperclip, Undo2, ShieldCheck, History, X, ListOrdered, Package, Wallet, CircleCheck, ClipboardList, Inbox } from "lucide-react";
import {
  updatePurchaseOrder,
  updatePoLine,
  addPoLine,
  deletePoLine,
  deletePurchaseOrder,
  deleteReceipt,
  uploadReceiptInvoice,
  setPoAudited,
  recordPoDocument,
  deletePoDocument,
  type PoLineDetail,
  type PoReceipt,
} from "@/lib/actions/procurement";
import { ReceiveModal } from "@/components/procurement/receive-modal";
import { ItemPicker } from "@/components/procurement/item-picker";
import { type SearchableItem } from "@/lib/actions/items";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { PurchaseOrder, PurchaseOrderStatus, PoChangeLog, UnitOfMeasurement } from "@/lib/supabase/types";

const PDF_BUCKET = "po-invoices";
const PDF_MAX_BYTES = 50 * 1024 * 1024;
const PDF_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"]);

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
  changeLog,
  units,
}: {
  po: PurchaseOrder;
  lines: PoLineDetail[];
  receipts: PoReceipt[];
  changeLog: PoChangeLog[];
  units: UnitOfMeasurement[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const received = po.status === "received";
  const [rows, setRows] = useState<PoLineDetail[]>(lines);
  const [poNumber, setPoNumber] = useState(po.po_number ?? "");
  const [supplier, setSupplier] = useState(po.supplier_name ?? "");
  const [orderDate, setOrderDate] = useState(po.order_date ?? "");
  const [expectedDate, setExpectedDate] = useState(po.expected_date ?? "");
  const [note, setNote] = useState(po.note ?? "");
  const [showReceive, setShowReceive] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newItem, setNewItem] = useState<SearchableItem | null>(null);
  const [newQty, setNewQty] = useState("1");
  const [newCost, setNewCost] = useState("");
  const [newPurchaseUom, setNewPurchaseUom] = useState("");
  const [newTentative, setNewTentative] = useState("");

  // Derived purchase-UOM context for the "Add item" bar (chosen per line).
  const addUnit = newPurchaseUom ? units.find((u) => u.id === newPurchaseUom) : null;
  const addDual = !!addUnit;
  const addOrderAbbr = addDual ? (addUnit!.abbreviation || "unit") : (newItem?.uom_abbreviation ?? "");
  const addStockAbbr = newItem?.uom_abbreviation ?? "";

  // Set/clear a line's purchase unit (and keep the abbreviation in sync for display).
  const setLineUom = (id: string, unitId: string) => {
    const ab = unitId ? (units.find((u) => u.id === unitId)?.abbreviation ?? null) : null;
    setRows((prev) =>
      prev.map((x) =>
        x.id === id ? { ...x, purchase_uom_id: unitId || null, purchase_uom_abbreviation: ab } : x,
      ),
    );
    persistLine(id, { purchase_uom_id: unitId || null });
  };

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
        po_number: poNumber.trim() || null,
        supplier_name: supplier.trim() || null,
        order_date: orderDate || null,
        expected_date: expectedDate || null,
        note: note.trim() || null,
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Saved");
        router.refresh();
      }
    });
  };

  const toggleAudited = () => {
    startTransition(async () => {
      const res = await setPoAudited(po.id, !po.audited_at);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(po.audited_at ? "Audit cleared." : "Marked audited.");
      router.refresh();
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

  const persistLine = (
    id: string,
    patch: { qty?: number; unit_cost?: number | null; tentative_stock_qty?: number | null; purchase_uom_id?: string | null },
  ) => {
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

  const addItem = () => {
    if (!newItem) { toast.error("Pick an item to add."); return; }
    if (!(Number(newQty) > 0)) { toast.error("Enter a quantity greater than zero."); return; }
    const tentative = addDual && newTentative.trim() !== "" ? Number(newTentative) : null;
    startTransition(async () => {
      const res = await addPoLine(po.id, {
        item_id: newItem.id,
        qty: Number(newQty),
        unit_cost: newCost.trim() === "" ? null : Number(newCost),
        purchase_uom_id: newPurchaseUom || null,
        tentative_stock_qty: tentative,
      });
      if (!res.ok) { toast.error(res.error); return; }
      setNewItem(null);
      setNewQty("1");
      setNewCost("");
      setNewPurchaseUom("");
      setNewTentative("");
      toast.success("Item added.");
      router.refresh();
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
            {po.po_number && <span className="font-mono">{po.po_number}</span>}
            <span className={po.po_number ? "text-[var(--muted-foreground)] font-normal" : ""}>
              {supplier.trim() || "Unassigned supplier"}
            </span>
            <Badge variant={STATUS_BADGE[po.status]}>{STATUS_LABEL[po.status]}</Badge>
            {po.audited_at && (
              <Badge variant="green">
                <ShieldCheck className="h-3 w-3 mr-1" />Audited
              </Badge>
            )}
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
              variant={po.audited_at ? "secondary" : "secondary"}
              onClick={toggleAudited}
              disabled={isPending}
              title={po.audited_at ? `Audited ${new Date(po.audited_at).toLocaleString("en-IN")} — click to clear` : "Mark this PO as audited / verified"}
              className={po.audited_at ? "text-[var(--success)]" : ""}
            >
              <ShieldCheck className="h-4 w-4 mr-1" />
              {po.audited_at ? "Audited" : "Mark audited"}
            </Button>
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
        <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5">
          <ClipboardList className="h-4 w-4 text-[var(--muted-foreground)]" />
          Order details
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">PO Number</span>
            <Input size="sm" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PO-2026-001" disabled={received} className="mt-1 font-mono" />
          </label>
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

      <PoDocumentPanel po={po} busy={isPending} onChanged={() => router.refresh()} />

      <KpiGrid className="mb-4">
        <KpiCard icon={<ListOrdered size={18} />} label="Lines" value={rows.length} sub={`${rows.length === 1 ? "item" : "items"} on this PO`} />
        <KpiCard icon={<Package size={18} />} tone="primary" label="Order qty" value={totals.qty.toLocaleString()} sub="across all lines" />
        <KpiCard icon={<Wallet size={18} />} tone={totals.cost > 0 ? "primary" : "default"} label="Est. cost" value={totals.cost > 0 ? inr(totals.cost) : "—"} sub={totals.cost > 0 ? "estimated value" : "no rates yet"} />
        <KpiCard
          icon={received ? <CircleCheck size={18} /> : <PackageCheck size={18} />}
          tone={received ? "success" : "warning"}
          label={received ? "Received" : "To receive"}
          value={received ? "All in" : totals.unreceived.toLocaleString()}
          sub={received ? "fully received" : `${totals.receivedLines}/${rows.length} lines in`}
        />
      </KpiGrid>

      <div className="card-surface overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)]">
          <ClipboardList className="h-4 w-4 text-[var(--muted-foreground)]" />
          <span className="text-sm font-semibold">Line items</span>
          <span className="text-xs text-[var(--muted-foreground)]">{rows.length}</span>
        </div>
        <Table density="compact">
          <TableHeader sticky>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Reorder pt</TableHead>
              <TableHead className="w-36">Purchase unit</TableHead>
              <TableHead className="text-right w-24">Order qty</TableHead>
              <TableHead className="text-right w-24">Tentative</TableHead>
              <TableHead className="text-right w-24">Unit cost</TableHead>
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
                {/* Purchase unit */}
                <TableCell>
                  {received ? (
                    <span className="text-sm">
                      {r.purchase_uom_id
                        ? (r.purchase_uom_abbreviation ?? "—")
                        : <span className="text-[var(--muted-foreground)]">Stock{r.uom_abbreviation ? ` (${r.uom_abbreviation})` : ""}</span>}
                    </span>
                  ) : (
                    <Select
                      size="sm"
                      value={r.purchase_uom_id ?? ""}
                      onChange={(e) => setLineUom(r.id, e.target.value)}
                      className="w-36"
                      title="Purchase unit for this line (varies by vendor)"
                    >
                      <option value="">Stock{r.uom_abbreviation ? ` (${r.uom_abbreviation})` : ""}</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}{u.abbreviation ? ` (${u.abbreviation})` : ""}
                        </option>
                      ))}
                    </Select>
                  )}
                </TableCell>
                {/* Order qty */}
                <TableCell className="text-right">
                  {received ? (
                    <span className="font-medium tabular-nums">
                      {r.qty.toLocaleString()}
                      {(r.purchase_uom_id || r.uom_abbreviation) && (
                        <span className="ml-1 text-[11px] font-normal text-[var(--muted-foreground)]">
                          {r.purchase_uom_id ? r.purchase_uom_abbreviation : r.uom_abbreviation}
                        </span>
                      )}
                    </span>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        size="sm"
                        type="number"
                        min={0}
                        step={r.purchase_uom_id ? "any" : 1}
                        value={r.qty}
                        className="w-16 text-right ml-auto"
                        onChange={(e) =>
                          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, qty: Number(e.target.value) } : x)))
                        }
                        onBlur={() => {
                          // DB enforces qty > 0 — clamp so a cleared/0 field can't hit a raw error.
                          // Dual-UOM lines may be fractional (e.g. KG), so only floor at >0.
                          const q = r.purchase_uom_id
                            ? r.qty > 0 ? r.qty : 1
                            : r.qty >= 1 ? r.qty : 1;
                          if (q !== r.qty) setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, qty: q } : x)));
                          persistLine(r.id, { qty: q });
                        }}
                      />
                      <span className="w-7 text-[11px] text-[var(--muted-foreground)] truncate" title={r.purchase_uom_id ? (r.purchase_uom_abbreviation ?? "") : (r.uom_abbreviation ?? "")}>
                        {r.purchase_uom_id ? (r.purchase_uom_abbreviation ?? "") : (r.uom_abbreviation ?? "")}
                      </span>
                    </div>
                  )}
                </TableCell>
                {/* Tentative stock */}
                <TableCell className="text-right">
                  {r.purchase_uom_id ? (
                    received ? (
                      <span className="tabular-nums text-[var(--muted-foreground)]">
                        ≈ {(r.tentative_stock_qty ?? r.qty).toLocaleString()} {r.uom_abbreviation ?? ""}
                      </span>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          size="sm" type="number" min={0} step="any"
                          value={r.tentative_stock_qty ?? ""}
                          placeholder="≈"
                          className="w-16 text-right ml-auto"
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((x) =>
                                x.id === r.id
                                  ? { ...x, tentative_stock_qty: e.target.value === "" ? null : Number(e.target.value) }
                                  : x,
                              ),
                            )
                          }
                          onBlur={() => persistLine(r.id, { tentative_stock_qty: r.tentative_stock_qty })}
                        />
                        <span className="w-7 text-[11px] text-[var(--muted-foreground)] truncate" title={r.uom_abbreviation ?? ""}>{r.uom_abbreviation ?? ""}</span>
                      </div>
                    )
                  ) : (
                    <span className="text-[var(--muted-foreground)]">—</span>
                  )}
                </TableCell>
                {/* Unit cost */}
                <TableCell className="text-right">
                  {received ? (
                    <span className="tabular-nums">
                      {r.unit_cost != null ? (
                        <>
                          {rate(r.unit_cost)}
                          {r.purchase_uom_id && (
                            <span className="text-[11px] text-[var(--muted-foreground)]">/{r.purchase_uom_abbreviation}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">—</span>
                      )}
                    </span>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        size="sm"
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.unit_cost ?? ""}
                        placeholder="—"
                        className="w-16 text-right ml-auto"
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.id === r.id ? { ...x, unit_cost: e.target.value === "" ? null : Number(e.target.value) } : x,
                            ),
                          )
                        }
                        onBlur={() => persistLine(r.id, { unit_cost: r.unit_cost })}
                      />
                      <span className="w-7 text-[11px] text-[var(--muted-foreground)] truncate">{r.purchase_uom_id ? `/${r.purchase_uom_abbreviation}` : ""}</span>
                    </div>
                  )}
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
                  {r.purchase_uom_id && r.received_stock_qty != null && r.received_stock_qty > 0 && (
                    <div className="text-[10px] text-[var(--muted-foreground)]">
                      {r.received_stock_qty.toLocaleString()} {r.uom_abbreviation ?? ""} in
                    </div>
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
                <TableCell colSpan={11} className="text-center text-[var(--muted-foreground)] py-6">
                  No lines on this purchase order.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add item to this PO */}
      {!received && (
        <div className="card-surface p-3 mt-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Add item</span>
              <div className="mt-1">
                <ItemPicker value={newItem} onPick={setNewItem} />
              </div>
            </div>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Purchase unit</span>
              <Select
                size="sm"
                value={newPurchaseUom}
                onChange={(e) => setNewPurchaseUom(e.target.value)}
                className="mt-1 w-32"
                title="Purchase unit for this line (varies by vendor)"
              >
                <option value="">Stock{addStockAbbr ? ` (${addStockAbbr})` : ""}</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}{u.abbreviation ? ` (${u.abbreviation})` : ""}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                Qty{addOrderAbbr ? ` (${addOrderAbbr})` : ""}
              </span>
              <Input size="sm" type="number" min={0} step={addDual ? "any" : 1} value={newQty} onChange={(e) => setNewQty(e.target.value)} className="mt-1 w-20 text-right" />
            </label>
            {addDual && (
              <label className="block">
                <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  Tentative {addStockAbbr || "stock"}
                </span>
                <Input
                  size="sm" type="number" min={0} step="any" value={newTentative}
                  onChange={(e) => setNewTentative(e.target.value)}
                  placeholder="stock qty"
                  className="mt-1 w-24 text-right"
                  title="Tentative stock quantity (actual counted at receiving)"
                />
              </label>
            )}
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                Unit cost{addDual ? ` /${addOrderAbbr}` : ""}
              </span>
              <Input size="sm" type="number" min={0} step="0.01" value={newCost} onChange={(e) => setNewCost(e.target.value)} placeholder="—" className="mt-1 w-24 text-right" />
            </label>
            <Button size="sm" onClick={addItem} disabled={isPending || !newItem}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
              Add
            </Button>
          </div>
          {addDual && (
            <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
              Bought in <b className="text-[var(--foreground)]">{addOrderAbbr}</b>, stocked as {addStockAbbr || "—"} —
              the actual stock quantity is counted when goods are received.
            </p>
          )}
        </div>
      )}

      {/* Receipt history */}
      {receipts.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5">
            <Inbox className="h-4 w-4 text-[var(--muted-foreground)]" />
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

      {/* Change history (audit trail) */}
      <PoHistoryPanel entries={changeLog} />

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

  const totalStock = receipt.lines.reduce((a, l) => a + (l.stock_qty ?? l.qty), 0);
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
    <div className="card-surface p-3 flex gap-3">
      <span className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--success-bg)] text-[var(--success)]" aria-hidden="true">
        <Inbox className="h-4 w-4" />
      </span>
      <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{fmtDate(receipt.receipt_date)}</span>
          {receipt.invoice_number && (
            <span className="text-[var(--muted-foreground)]">Inv {receipt.invoice_number}</span>
          )}
          <span className="text-[var(--muted-foreground)]">
            · {receipt.lines.length} item{receipt.lines.length === 1 ? "" : "s"} · {totalStock.toLocaleString()} to stock
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
            {l.purchase_uom_abbreviation ? (
              <>
                {l.qty.toLocaleString()} {l.purchase_uom_abbreviation} →{" "}
                <span className="text-[var(--foreground)]">{(l.stock_qty ?? l.qty).toLocaleString()} {l.uom_abbreviation ?? ""}</span>
              </>
            ) : (
              <>{l.qty.toLocaleString()} {l.uom_abbreviation ?? ""}</>
            )}
            {l.unit_rate != null && (
              <span> @ {rate(l.unit_rate)}{l.purchase_uom_abbreviation ? `/${l.purchase_uom_abbreviation}` : ""}</span>
            )}
          </span>
        ))}
      </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PO PDF copy — attach / view / replace / remove (browser-direct).    */

function PoDocumentPanel({
  po,
  busy,
  onChanged,
}: {
  po: PurchaseOrder;
  busy: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const isPdf = !!po.po_pdf_filename && /\.pdf$/i.test(po.po_pdf_filename);

  const attach = async (file: File) => {
    if (file.size > PDF_MAX_BYTES) {
      toast.error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 50 MB.`);
      return;
    }
    if (!PDF_MIME.has(file.type)) {
      toast.error(`Unsupported file type "${file.type}". Use PDF, PNG, JPG, or WebP.`);
      return;
    }
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const path = `${po.id}/po-document/${Date.now()}-${safeName}`;
      const supabase = createClient();
      const { error } = await supabase.storage
        .from(PDF_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const res = await recordPoDocument({ poId: po.id, path, filename: file.name });
      if (!res.ok) throw new Error(res.error);
      toast.success("PO PDF attached.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setUploading(true);
    const res = await deletePoDocument(po.id);
    setUploading(false);
    if (!res.ok) toast.error(res.error);
    else {
      toast.success("PO PDF removed.");
      onChanged();
    }
  };

  return (
    <div className="card-surface p-3 mb-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
          <FileText className="h-4 w-4 text-[var(--muted-foreground)]" /> PO PDF copy
        </h3>
        <div className="flex items-center gap-1.5">
          {po.po_pdf_url && (
            <a href={po.po_pdf_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline">
              <FileText className="h-3.5 w-3.5" /> {po.po_pdf_filename ?? "Open"}
            </a>
          )}
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading || busy}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5 mr-1.5" />}
            {po.po_pdf_url ? "Replace" : "Attach"}
          </Button>
          {po.po_pdf_url && (
            <button type="button" onClick={remove} disabled={uploading || busy} title="Remove PO PDF" className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-bg)] cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = ""; }}
      />
      {po.po_pdf_url ? (
        isPdf ? (
          <iframe key={po.po_pdf_url} src={po.po_pdf_url} title={po.po_pdf_filename ?? "PO PDF"} className="mt-2 w-full h-[420px] rounded border border-[var(--border)] bg-white" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={po.po_pdf_url} src={po.po_pdf_url} alt={po.po_pdf_filename ?? "PO document"} className="mt-2 max-h-[420px] rounded border border-[var(--border)]" />
        )
      ) : (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          No PO copy attached. Attach the supplier&apos;s / printed PO (PDF or image, max 50 MB).
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Change history (audit trail) for the PO.                            */

const PO_ACTION_LABEL: Record<PoChangeLog["action"], string> = {
  create: "Created",
  update: "Edited",
  delete: "Deleted",
  audit: "Marked audited",
  unaudit: "Audit cleared",
};
const PO_ACTION_VARIANT: Record<PoChangeLog["action"], BadgeVariant> = {
  create: "blue",
  update: "neutral",
  delete: "red",
  audit: "green",
  unaudit: "amber",
};

function PoHistoryPanel({ entries }: { entries: PoChangeLog[] }) {
  if (!entries || entries.length === 0) return null;
  const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5">
        <History className="h-4 w-4 text-[var(--muted-foreground)]" /> Change history
        <span className="text-[var(--muted-foreground)] font-normal">({entries.length})</span>
      </h3>
      <div className="card-surface divide-y divide-[var(--border)]">
        {entries.map((e) => (
          <div key={e.id} className="px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={PO_ACTION_VARIANT[e.action] ?? "neutral"}>
                {PO_ACTION_LABEL[e.action] ?? e.action}
              </Badge>
              <span className="text-[var(--muted-foreground)] text-xs">
                {new Date(e.created_at).toLocaleString("en-IN")}
              </span>
              {e.note && <span className="text-xs italic text-[var(--muted-foreground)]">· {e.note}</span>}
            </div>
            {e.changes && e.changes.length > 0 && (
              <ul className="mt-1 ml-1 space-y-0.5">
                {e.changes.map((c, i) => (
                  <li key={i} className="text-xs text-[var(--muted-foreground)]">
                    <span className="text-[var(--foreground)]">{c.label ?? c.field}</span>:{" "}
                    <span className="line-through">{fmt(c.old)}</span> →{" "}
                    <span className="text-[var(--foreground)]">{fmt(c.new)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
