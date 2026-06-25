// Client-side PDF export for the Inventory list — mirrors the jsPDF +
// jspdf-autotable pattern used by stock-ledger-pdf.ts / partlist-pdf.ts.
// Landscape, one table over the full filtered (not just the visible page) set.

import type { InventoryRow } from "@/lib/actions/inventory";
import type { ItemType } from "@/lib/supabase/types";
import {
  inventoryTypeLabel,
  inventoryProcLabel,
  inventoryDemandLabel,
  inventoryStatusLabel,
} from "@/lib/export/inventory-export";

export interface InventoryPdfMeta {
  /** "All" | "Make" | "Trade" — the active tab. */
  scope: string;
  /** Human-readable summary of the active filters, e.g. "Type: Raw Material · In Stock". */
  filtersSummary?: string;
  /** Filename without extension. */
  filename: string;
}

function fmtDate(): string {
  return new Date().toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtNum(n: number): string {
  return Number(n).toLocaleString("en-IN");
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_") || "inventory";

// jsPDF's built-in Helvetica is WinAnsi-encoded and can't render the ₹ glyph,
// so the PDF uses "Rs." in the money header while the Excel export keeps ₹.
export async function downloadInventoryPdf(
  rows: InventoryRow[],
  meta: InventoryPdfMeta,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(`Inventory — ${meta.scope}`, margin, 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`${fmtNum(rows.length)} items`, margin, 20);
  doc.text(`Generated ${fmtDate()}`, pageW - margin, 14, { align: "right" });
  if (meta.filtersSummary) {
    doc.text(meta.filtersSummary, margin, 25);
  }
  doc.setTextColor(0);

  autoTable(doc, {
    startY: meta.filtersSummary ? 29 : 24,
    theme: "grid",
    styles: { fontSize: 7.5, cellPadding: 1.2, overflow: "linebreak" },
    headStyles: { fillColor: [34, 51, 68], textColor: 255 },
    head: [[
      "Code", "Name", "Type", "M/T", "Demand", "Category", "Stock", "Cost (Rs.)", "Status",
    ]],
    body: rows.map((r) => [
      r.code,
      r.name,
      inventoryTypeLabel(r.item_type as ItemType),
      inventoryProcLabel(r.effective_procurement_type),
      inventoryDemandLabel(r.demand_source),
      r.category_name ?? "",
      `${fmtNum(r.total_stock)}${r.uom_abbreviation ? ` ${r.uom_abbreviation}` : ""}`,
      r.cost_price > 0 ? fmtNum(r.cost_price) : "",
      inventoryStatusLabel(r),
    ]),
    columnStyles: {
      0: { cellWidth: 26, fontStyle: "bold" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "center" },
    },
    margin: { left: margin, right: margin },
  });

  doc.save(`${safe(meta.filename)}.pdf`);
}
