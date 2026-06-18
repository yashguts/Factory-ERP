"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/ui/export-button";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ShoppingCart, Sparkles, Loader2, Package, Building2, ListOrdered, Plus, Wallet, CircleCheck } from "lucide-react";
import {
  generateDraftPosFromShortfall,
  type ProcurementData,
} from "@/lib/actions/procurement";
import {
  orderStatus,
  orderStatusKey,
  receiptStatus,
  receiptStatusKey,
} from "@/lib/procurement-status";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const qty = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : (Math.round(n * 100) / 100).toLocaleString());
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

type View = "orders" | "byitem" | "bysupplier";
type OrderTab = "all" | "draft" | "ordered" | "closed" | "cancelled";
type ReceiptTab = "all" | "pending" | "partial" | "received";

export function ProcurementClient({ data }: { data: ProcurementData }) {
  const { orders, byItem, bySupplier } = data;
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useState<View>("orders");
  const [orderTab, setOrderTab] = useState<OrderTab>("all");
  const [receiptTab, setReceiptTab] = useState<ReceiptTab>("all");

  const statusCounts = useMemo(() => {
    const c = { all: orders.length, draft: 0, ordered: 0, received: 0, cancelled: 0 };
    for (const o of orders) c[o.status] += 1;
    return c;
  }, [orders]);

  // The two orthogonal status axes, for the filter tabs.
  const orderCounts = useMemo(() => {
    const c = { draft: 0, ordered: 0, closed: 0, cancelled: 0 };
    for (const o of orders) c[orderStatusKey(o.status)] += 1;
    return c;
  }, [orders]);
  const receiptCounts = useMemo(() => {
    const c = { pending: 0, partial: 0, received: 0 };
    for (const o of orders) {
      const k = receiptStatusKey({ status: o.status, anyReceived: o.any_received });
      if (k !== "none") c[k] += 1;
    }
    return c;
  }, [orders]);

  const stats = useMemo(() => {
    let openPos = 0, onOrderCost = 0;
    for (const o of orders) {
      if (o.status === "draft" || o.status === "ordered") { openPos += 1; onOrderCost += o.total_cost; }
    }
    const onOrderUnits = byItem.reduce((s, i) => s + i.on_order, 0);
    return { openPos, onOrderCost, onOrderUnits };
  }, [orders, byItem]);

  const filteredOrders = useMemo(
    () =>
      orders.filter((o) => {
        if (orderTab !== "all" && orderStatusKey(o.status) !== orderTab) return false;
        if (
          receiptTab !== "all" &&
          receiptStatusKey({ status: o.status, anyReceived: o.any_received }) !== receiptTab
        )
          return false;
        return true;
      }),
    [orders, orderTab, receiptTab],
  );

  const handleGenerate = () => {
    startTransition(async () => {
      const res = await generateDraftPosFromShortfall();
      if (!res.ok) { toast.error(res.error); return; }
      if (res.orders === 0) {
        toast.info(
          res.skipped > 0
            ? `Nothing new to order — ${res.skipped} shortfall item${res.skipped === 1 ? "" : "s"} already on an open PO.`
            : "No Trade shortfall to order right now.",
        );
      } else {
        toast.success(`Created ${res.orders} draft PO${res.orders === 1 ? "" : "s"} (${res.lines} line${res.lines === 1 ? "" : "s"})` + (res.skipped > 0 ? ` · skipped ${res.skipped} already on an open PO` : ""));
      }
      router.refresh();
    });
  };

  return (
    <div>
      <PageHeader
        title="Procurement"
        icon={<ShoppingCart size={18} />}
        meta={`${orders.length} order${orders.length === 1 ? "" : "s"} · ${byItem.length} item${byItem.length === 1 ? "" : "s"} on order`}
        actions={
          <>
            {view === "orders" && (
              <ExportButton
                rows={filteredOrders}
                filename="purchase-orders"
                sheetName="POs"
                columns={[
                  { header: "PO #", field: (o) => o.po_number || o.note || "" },
                  { header: "Supplier", field: (o) => o.supplier_name || "Unassigned" },
                  { header: "Order", field: (o) => orderStatus(o.status).label },
                  {
                    header: "Receipt",
                    field: (o) =>
                      receiptStatus({
                        status: o.status,
                        lineCount: o.line_count,
                        receivedLines: o.received_lines,
                        anyReceived: o.any_received,
                      })?.label ?? "—",
                  },
                  { header: "Items", field: "line_count" },
                  { header: "Qty", field: "total_qty" },
                  { header: "Est. cost", field: "total_cost" },
                  { header: "Order date", field: "order_date" },
                  { header: "Expected", field: "expected_date" },
                ]}
              />
            )}
            {view === "byitem" && (
              <ExportButton
                rows={byItem}
                filename="procurement-on-order-by-item"
                sheetName="On order"
                columns={[
                  { header: "Code", field: "code" },
                  { header: "Item", field: "name" },
                  { header: "UOM", field: "uom" },
                  { header: "On order", field: "on_order" },
                  { header: "Received", field: "received" },
                  { header: "Ordered", field: "ordered" },
                  { header: "POs", field: "po_count" },
                  { header: "Suppliers", field: (r) => r.suppliers.join(", ") },
                ]}
              />
            )}
            {view === "bysupplier" && (
              <ExportButton
                rows={bySupplier}
                filename="procurement-by-supplier"
                sheetName="By supplier"
                columns={[
                  { header: "Supplier", field: "supplier" },
                  { header: "POs", field: "po_count" },
                  { header: "Lines", field: "line_count" },
                  { header: "On order", field: "on_order" },
                  { header: "Ordered qty", field: "ordered" },
                  { header: "Est. cost", field: "est_cost" },
                ]}
              />
            )}
            <Button size="sm" variant="secondary" onClick={() => router.push("/procurement/new")} title="Create a purchase order manually">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add PO
            </Button>
            <Button size="sm" onClick={handleGenerate} disabled={isPending} title="Create draft POs from the current Trade shortfall, grouped by supplier">
              {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              Generate from shortfall
            </Button>
          </>
        }
      />

      <KpiGrid className="mb-4">
        <KpiCard
          icon={<ShoppingCart size={18} />}
          tone="primary"
          label="Open POs"
          value={stats.openPos}
          sub={`${statusCounts.draft} draft · ${statusCounts.ordered} ordered`}
        />
        <KpiCard
          icon={<Package size={18} />}
          tone={stats.onOrderUnits > 0 ? "primary" : "default"}
          label="On order"
          value={qty(stats.onOrderUnits)}
          sub="units incoming"
        />
        <KpiCard
          icon={<Wallet size={18} />}
          tone={stats.onOrderCost > 0 ? "primary" : "default"}
          label="On-order value"
          value={inr(stats.onOrderCost)}
          sub="estimated"
        />
        <KpiCard
          icon={<CircleCheck size={18} />}
          tone="success"
          label="Received"
          value={statusCounts.received}
          sub={`of ${orders.length} order${orders.length === 1 ? "" : "s"}`}
        />
      </KpiGrid>

      <Tabs
        variant="segmented"
        className="mb-3"
        value={view}
        onChange={(v) => setView(v as View)}
        tabs={[
          { value: "orders", label: <span className="inline-flex items-center gap-1.5"><ListOrdered className="h-3.5 w-3.5" />Orders</span>, count: orders.length },
          { value: "byitem", label: <span className="inline-flex items-center gap-1.5"><Package className="h-3.5 w-3.5" />By item</span>, count: byItem.length },
          { value: "bysupplier", label: <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />By supplier</span>, count: bySupplier.length },
        ]}
      />

      {/* ── Orders view ── */}
      {view === "orders" && (
        orders.length === 0 ? (
          <div className="card-surface">
            <EmptyState
              icon={<ShoppingCart size={28} />}
              title="No purchase orders yet"
              description="Generate draft POs from your Trade shortfall to get started — they group automatically by supplier."
              action={<Button size="sm" variant="secondary" onClick={handleGenerate} disabled={isPending}><Sparkles className="h-3.5 w-3.5 mr-1.5" />Generate from shortfall</Button>}
            />
          </div>
        ) : (
          <>
            <div className="mb-3 space-y-1.5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] w-16 shrink-0">Order</span>
                <Tabs
                  variant="underline"
                  value={orderTab}
                  onChange={(v) => setOrderTab(v as OrderTab)}
                  tabs={[
                    { value: "all", label: "All", count: orders.length },
                    { value: "draft", label: "Draft", count: orderCounts.draft },
                    { value: "ordered", label: "Ordered", count: orderCounts.ordered },
                    { value: "closed", label: "Closed", count: orderCounts.closed },
                    { value: "cancelled", label: "Cancelled", count: orderCounts.cancelled },
                  ]}
                />
              </div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] w-16 shrink-0">Receipt</span>
                <Tabs
                  variant="underline"
                  value={receiptTab}
                  onChange={(v) => setReceiptTab(v as ReceiptTab)}
                  tabs={[
                    { value: "all", label: "All", count: orders.length },
                    { value: "pending", label: "Pending", count: receiptCounts.pending },
                    { value: "partial", label: "Partial", count: receiptCounts.partial },
                    { value: "received", label: "Received", count: receiptCounts.received },
                  ]}
                />
              </div>
            </div>
            <div className="card-surface overflow-hidden">
              <Table density="dense">
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>PO #</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Receipt</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Est. cost</TableHead>
                    <TableHead>Order date</TableHead>
                    <TableHead>Expected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((o) => {
                    const ord = orderStatus(o.status);
                    const rec = receiptStatus({
                      status: o.status,
                      lineCount: o.line_count,
                      receivedLines: o.received_lines,
                      anyReceived: o.any_received,
                    });
                    return (
                      <TableRow key={o.id} className="cursor-pointer" onClick={() => router.push(`/procurement/${o.id}`)}>
                        <TableCell className="font-mono text-xs">{o.po_number || o.note || "—"}</TableCell>
                        <TableCell className="font-medium">{o.supplier_name || "Unassigned"}</TableCell>
                        <TableCell><Badge variant={ord.variant}>{ord.label}</Badge></TableCell>
                        <TableCell>
                          {rec ? (
                            <Badge variant={rec.variant}>{rec.label}</Badge>
                          ) : (
                            <span className="text-[var(--muted-foreground)]">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{o.line_count}</TableCell>
                        <TableCell className="text-right">{o.total_qty.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{o.total_cost > 0 ? inr(o.total_cost) : "—"}</TableCell>
                        <TableCell className="text-[var(--muted-foreground)]">{fmtDate(o.order_date)}</TableCell>
                        <TableCell className={o.expected_date ? "" : "text-[var(--muted-foreground)]"}>{fmtDate(o.expected_date)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )
      )}

      {/* ── By item view ── */}
      {view === "byitem" && (
        byItem.length === 0 ? (
          <div className="card-surface"><EmptyState icon={<Package size={28} />} title="Nothing on order" /></div>
        ) : (
          <div className="card-surface overflow-hidden">
            <Table density="dense">
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">On order</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">POs</TableHead>
                  <TableHead>Supplier(s)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byItem.map((r) => (
                  <TableRow key={r.item_id}>
                    <TableCell>
                      <Link href={`/inventory/${r.item_id}`} className="font-mono text-xs text-[var(--primary)] hover:underline">{r.code}</Link>
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {r.on_order > 0 ? <span className="text-[var(--primary)]">{qty(r.on_order)}</span> : "—"}
                      {r.uom && r.on_order > 0 && <span className="text-[11px] text-[var(--muted-foreground)] ml-1">{r.uom}</span>}
                    </TableCell>
                    <TableCell className="text-right text-[var(--muted-foreground)]">{r.received > 0 ? qty(r.received) : "—"}</TableCell>
                    <TableCell className="text-right text-[var(--muted-foreground)]">{qty(r.ordered)}</TableCell>
                    <TableCell className="text-right text-[var(--muted-foreground)]">{r.po_count}</TableCell>
                    <TableCell className="text-[var(--muted-foreground)] truncate max-w-[260px]" title={r.suppliers.join(", ")}>
                      {r.suppliers.join(", ") || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}

      {/* ── By supplier view ── */}
      {view === "bysupplier" && (
        bySupplier.length === 0 ? (
          <div className="card-surface"><EmptyState icon={<Building2 size={28} />} title="No suppliers with orders" /></div>
        ) : (
          <div className="card-surface overflow-hidden">
            <Table density="dense">
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">POs</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">On order</TableHead>
                  <TableHead className="text-right">Ordered qty</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySupplier.map((s) => (
                  <TableRow key={s.supplier}>
                    <TableCell className="font-medium">{s.supplier}</TableCell>
                    <TableCell className="text-right">{s.po_count}</TableCell>
                    <TableCell className="text-right text-[var(--muted-foreground)]">{s.line_count}</TableCell>
                    <TableCell className="text-right font-semibold">{s.on_order > 0 ? <span className="text-[var(--primary)]">{qty(s.on_order)}</span> : "—"}</TableCell>
                    <TableCell className="text-right text-[var(--muted-foreground)]">{qty(s.ordered)}</TableCell>
                    <TableCell className="text-right">{s.est_cost > 0 ? inr(s.est_cost) : "—"}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        {s.ordered_n > 0 && <Badge variant="blue">{s.ordered_n} ordered</Badge>}
                        {s.draft > 0 && <Badge variant="neutral">{s.draft} draft</Badge>}
                        {s.received_n > 0 && <Badge variant="green">{s.received_n} recv</Badge>}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}
    </div>
  );
}
