import { TXN_LABELS } from "@/lib/inventory/transactions";
import type { ItemLedger } from "@/lib/actions/inventory";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtQty(n: number): string {
  return Number(n).toLocaleString("en-IN");
}

function safeName(s: string): string {
  return (s || "item").replace(/[^a-z0-9]+/gi, "_");
}

const REF_PREFIX: Record<"po" | "job" | "program" | "cabin", string> = {
  po: "PO ",
  job: "Job ",
  program: "Prog ",
  cabin: "Cabin ",
};

/** "PO 123 (Supplier)" / "Job RNLCHA-0057 (Customer)" / the note, for the Ref column. */
function refText(r: ItemLedger["rows"][number]): string {
  if (r.reference) {
    const base = `${REF_PREFIX[r.reference.kind]}${r.reference.label}`;
    return r.reference.sublabel ? `${base} (${r.reference.sublabel})` : base;
  }
  return r.note ?? "";
}

/**
 * Build + download a one-item stock ledger PDF. jsPDF is imported dynamically
 * so it stays out of the inventory list bundle (only loaded when a user clicks
 * "Download PDF"). Rows are printed oldest→newest so the running balance reads
 * naturally top-to-bottom.
 */
export async function downloadStockLedgerPdf(ledger: ItemLedger): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text("Stock Ledger", margin, y);
  y += 7;

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`${ledger.item_code} — ${ledger.item_name}`, margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Generated ${fmtDateTime(new Date().toISOString())}`, margin, y);
  doc.text(
    `Closing balance: ${fmtQty(ledger.closing)} ${ledger.uom ?? ""}`.trim(),
    pageW - margin,
    y,
    { align: "right" },
  );
  doc.setTextColor(0);
  y += 3;

  // Oldest-first for a natural running-balance read.
  const asc = ledger.rows.slice().reverse();
  autoTable(doc, {
    startY: y + 2,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [34, 51, 68], textColor: 255 },
    head: [["Date", "Type", "Warehouse", "User", "In", "Out", "Balance", "Note / Ref"]],
    body: asc.map((r) => [
      fmtDateTime(r.created_at),
      TXN_LABELS[r.transaction_type] ?? r.transaction_type,
      r.warehouse_name ?? "—",
      r.actor_name || "—",
      r.signed_qty > 0 ? fmtQty(r.signed_qty) : "",
      r.signed_qty < 0 ? fmtQty(Math.abs(r.signed_qty)) : "",
      fmtQty(r.running_balance),
      refText(r),
    ]),
    columnStyles: {
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right", fontStyle: "bold" },
    },
  });

  doc.save(`Stock_Ledger_${safeName(ledger.item_code)}.pdf`);
}
