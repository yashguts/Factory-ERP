"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, Download, FileText } from "lucide-react";
import { getItemLedger, type ItemLedger } from "@/lib/actions/inventory";
import { TXN_LABELS } from "@/lib/inventory/transactions";
import { downloadStockLedgerPdf } from "@/lib/export/stock-ledger-pdf";
import { useAnchoredPosition } from "@/components/ui/use-anchored-position";

const PANEL_WIDTH = 460;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const num = (n: number) => Number(n).toLocaleString("en-IN");

/**
 * Hover popover showing the full stock ledger for an item (every movement with
 * a running balance) plus a "Download PDF" button. Lazy-fetches on first open.
 * Rendered in a viewport-fixed layer (useAnchoredPosition) so the inventory
 * table's overflow wrappers don't clip it.
 */
export function StockLedgerPopover({
  itemId,
  children,
}: {
  itemId: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [ledger, setLedger] = useState<ItemLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const fetched = useRef(false);
  const pos = useAnchoredPosition(triggerRef, open, PANEL_WIDTH, 320);

  const load = useCallback(async () => {
    if (fetched.current) return;
    fetched.current = true;
    setLoading(true);
    try {
      setLedger(await getItemLedger(itemId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
    void load();
  };
  const leave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const onDownload = async () => {
    if (!ledger) return;
    setDownloading(true);
    try {
      await downloadStockLedgerPdf(ledger);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <span
      ref={triggerRef}
      className="relative inline-block"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
    >
      {children}
      {open && (
        <div
          className="fixed z-[200] rounded-md border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-lg)] text-left"
          style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
          onMouseEnter={enter}
          onMouseLeave={leave}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border)]">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                Stock ledger
              </div>
              <div className="text-sm font-medium truncate" title={ledger?.item_name ?? ""}>
                {ledger ? `${ledger.item_code} — ${ledger.item_name}` : "Loading…"}
              </div>
            </div>
            {ledger && (
              <div className="text-right shrink-0">
                <div className="text-[10px] text-[var(--muted-foreground)]">Balance</div>
                <div className="text-sm font-semibold tabular-nums">
                  {num(ledger.closing)} {ledger.uom ?? ""}
                </div>
              </div>
            )}
          </div>

          {/* Body */}
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-[var(--muted-foreground)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading ledger…
              </div>
            ) : error ? (
              <div className="px-3 py-4 text-xs text-[var(--destructive)]">{error}</div>
            ) : ledger && ledger.rows.length > 0 ? (
              <table className="w-full text-xs">
                <thead className="bg-[var(--muted)]/40 sticky top-0">
                  <tr className="text-[var(--muted-foreground)]">
                    <th className="text-left font-medium px-3 py-1.5">Date</th>
                    <th className="text-left font-medium px-2 py-1.5">Type</th>
                    <th className="text-left font-medium px-2 py-1.5">Warehouse</th>
                    <th className="text-left font-medium px-2 py-1.5">User</th>
                    <th className="text-right font-medium px-2 py-1.5">Qty</th>
                    <th className="text-right font-medium px-3 py-1.5">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.map((r) => (
                    <tr key={r.id} className="border-t border-[var(--border)] align-top">
                      <td className="px-3 py-1.5 whitespace-nowrap text-[var(--muted-foreground)]">
                        {fmtDate(r.created_at)}
                      </td>
                      <td className="px-2 py-1.5">
                        {TXN_LABELS[r.transaction_type] ?? r.transaction_type}
                        {(r.po_number || r.note) && (
                          <span className="block text-[10px] text-[var(--muted-foreground)] truncate max-w-[120px]">
                            {r.po_number ? `PO ${r.po_number}` : r.note}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-[var(--muted-foreground)]">
                        {r.warehouse_name ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-[var(--muted-foreground)]">
                        {r.created_by_name || "—"}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right tabular-nums font-medium ${
                          r.signed_qty < 0 ? "text-[var(--destructive)]" : "text-emerald-600"
                        }`}
                      >
                        {r.signed_qty > 0 ? "+" : ""}
                        {num(r.signed_qty)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                        {num(r.running_balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-[var(--muted-foreground)]">
                <FileText className="h-3.5 w-3.5" /> No stock movements yet.
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-[var(--border)]">
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {ledger ? `${ledger.rows.length} movement${ledger.rows.length === 1 ? "" : "s"}` : ""}
            </span>
            <button
              type="button"
              onClick={onDownload}
              disabled={!ledger || ledger.rows.length === 0 || downloading}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--muted)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              Download PDF
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
