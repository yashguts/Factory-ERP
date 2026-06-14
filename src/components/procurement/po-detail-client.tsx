"use client";

import { useMemo, useState, useTransition } from "react";
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
import { PackageCheck, Trash2, Loader2 } from "lucide-react";
import {
  updatePurchaseOrder,
  updatePoLine,
  deletePoLine,
  deletePurchaseOrder,
  receivePurchaseOrder,
  type PoLineDetail,
} from "@/lib/actions/procurement";
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

export function PoDetailClient({ po, lines }: { po: PurchaseOrder; lines: PoLineDetail[] }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const received = po.status === "received";
  const [rows, setRows] = useState<PoLineDetail[]>(lines);
  const [supplier, setSupplier] = useState(po.supplier_name ?? "");
  const [orderDate, setOrderDate] = useState(po.order_date ?? "");
  const [expectedDate, setExpectedDate] = useState(po.expected_date ?? "");
  const [note, setNote] = useState(po.note ?? "");
  const [confirmReceive, setConfirmReceive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const totals = useMemo(() => {
    let qty = 0;
    let cost = 0;
    let unreceived = 0;
    for (const r of rows) {
      qty += r.qty;
      cost += r.qty * (r.unit_cost ?? 0);
      unreceived += Math.max(0, r.qty - r.received_qty);
    }
    return { qty, cost, unreceived };
  }, [rows]);

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

  const doReceive = () => {
    startTransition(async () => {
      const res = await receivePurchaseOrder(po.id);
      setConfirmReceive(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Received — added ${res.posted} line${res.posted === 1 ? "" : "s"} to stock.`);
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
              onClick={() => setConfirmReceive(true)}
              disabled={isPending || received || totals.unreceived <= 0}
              title="Add the ordered quantities to stock"
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
                    <Badge variant="green">✓</Badge>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">{r.received_qty.toLocaleString()}</span>
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

      {confirmReceive && (
        <ConfirmDialog
          title="Receive purchase order?"
          message={
            <>
              This adds <span className="font-semibold">{totals.unreceived.toLocaleString()}</span> units across{" "}
              {rows.filter((r) => r.qty - r.received_qty > 0).length} line
              {rows.filter((r) => r.qty - r.received_qty > 0).length === 1 ? "" : "s"} to Main Store stock and marks the
              PO received. This posts an inventory receipt (purchase-in).
            </>
          }
          confirmLabel="Receive"
          busy={isPending}
          onConfirm={doReceive}
          onCancel={() => setConfirmReceive(false)}
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
