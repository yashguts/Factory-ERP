"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { StatStrip, StatTile } from "@/components/ui/stat-strip";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ShoppingCart, Sparkles, Loader2 } from "lucide-react";
import { generateDraftPosFromShortfall, type PoListRow } from "@/lib/actions/procurement";
import type { PurchaseOrderStatus } from "@/lib/supabase/types";

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
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

type Tab = "all" | PurchaseOrderStatus;

export function ProcurementClient({ orders }: { orders: PoListRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("all");

  const counts = useMemo(() => {
    const c = { all: orders.length, draft: 0, ordered: 0, received: 0, cancelled: 0 };
    for (const o of orders) c[o.status] += 1;
    return c;
  }, [orders]);

  const stats = useMemo(() => {
    let open = 0;
    let onOrderCost = 0;
    for (const o of orders) {
      if (o.status === "draft" || o.status === "ordered") {
        open += 1;
        onOrderCost += o.total_cost;
      }
    }
    return { open, onOrderCost };
  }, [orders]);

  const filtered = useMemo(
    () => (tab === "all" ? orders : orders.filter((o) => o.status === tab)),
    [orders, tab],
  );

  const handleGenerate = () => {
    startTransition(async () => {
      const res = await generateDraftPosFromShortfall();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.orders === 0) {
        toast.info(
          res.skipped > 0
            ? `Nothing new to order — ${res.skipped} shortfall item${res.skipped === 1 ? "" : "s"} already on an open PO.`
            : "No Trade shortfall to order right now.",
        );
      } else {
        toast.success(
          `Created ${res.orders} draft PO${res.orders === 1 ? "" : "s"} (${res.lines} line${res.lines === 1 ? "" : "s"})` +
            (res.skipped > 0 ? ` · skipped ${res.skipped} already on an open PO` : ""),
        );
      }
      router.refresh();
    });
  };

  return (
    <div>
      <PageHeader
        title="Procurement"
        icon={<ShoppingCart size={18} />}
        meta={`${orders.length} purchase order${orders.length === 1 ? "" : "s"}`}
        actions={
          <Button size="sm" onClick={handleGenerate} disabled={isPending} title="Create draft POs from the current Trade shortfall, grouped by supplier">
            {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            Generate from shortfall
          </Button>
        }
      />

      <StatStrip className="mb-3">
        <StatTile label="Open POs" value={stats.open} />
        <StatTile label="On order (est.)" value={inr(stats.onOrderCost)} tone={stats.onOrderCost > 0 ? "primary" : "default"} />
        <StatTile label="Draft" value={counts.draft} tone={counts.draft > 0 ? "warn" : "default"} />
        <StatTile label="Received" value={counts.received} tone="ok" />
      </StatStrip>

      <div className="mb-3">
        <Tabs
          variant="underline"
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          tabs={[
            { value: "all", label: "All", count: counts.all },
            { value: "draft", label: "Draft", count: counts.draft },
            { value: "ordered", label: "Ordered", count: counts.ordered },
            { value: "received", label: "Received", count: counts.received },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={<ShoppingCart size={28} />}
            title={orders.length === 0 ? "No purchase orders yet" : "No purchase orders in this view"}
            description={
              orders.length === 0
                ? "Generate draft POs from your Trade shortfall to get started — they group automatically by supplier."
                : undefined
            }
            action={
              orders.length === 0 ? (
                <Button size="sm" variant="secondary" onClick={handleGenerate} disabled={isPending}>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  Generate from shortfall
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <Table density="compact">
            <TableHeader sticky>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
                <TableHead>Order date</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow
                  key={o.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/procurement/${o.id}`)}
                >
                  <TableCell className="font-medium">{o.supplier_name || "Unassigned"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {o.received_lines > 0 && o.received_lines < o.line_count ? (
                      <span className="text-[var(--muted-foreground)]">{o.received_lines}/{o.line_count}</span>
                    ) : (
                      o.line_count
                    )}
                  </TableCell>
                  <TableCell className="text-right">{o.total_qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{o.total_cost > 0 ? inr(o.total_cost) : "—"}</TableCell>
                  <TableCell className="text-[var(--muted-foreground)]">{fmtDate(o.order_date)}</TableCell>
                  <TableCell className="text-[var(--muted-foreground)]">{fmtDate(o.expected_date)}</TableCell>
                  <TableCell className="text-[var(--muted-foreground)]">{fmtDate(o.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
