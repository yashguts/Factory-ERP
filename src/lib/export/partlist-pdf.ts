// Client-side PDF export for a job's Part List — mirrors the jsPDF + jspdf-autotable
// pattern used by stock-ledger-pdf.ts. One section header + table per checklist group.

export interface PartlistExportRow {
  group: string;
  particular: string;
  item: string;
  spec: string;
  qty: number;
  packed: string;
}

export interface PartlistExportMeta {
  jobNumber: string;
  customerName: string | null;
  status: string;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_") || "part_list";

export async function downloadPartlistPdf(
  meta: PartlistExportMeta,
  rows: PartlistExportRow[],
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const margin = 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(`Part List - ${meta.jobNumber}`, margin, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const sub = [meta.customerName, `Status: ${meta.status}`, new Date().toLocaleDateString()]
    .filter(Boolean)
    .join("   |   ");
  doc.text(sub, margin, 22);

  // Group the flat rows in encounter order (already in GROUP_ORDER from the caller).
  const byGroup: Record<string, PartlistExportRow[]> = {};
  const order: string[] = [];
  for (const r of rows) {
    if (!byGroup[r.group]) {
      byGroup[r.group] = [];
      order.push(r.group);
    }
    byGroup[r.group].push(r);
  }

  let cursorY = 30;
  for (const g of order) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(g, margin, cursorY);
    autoTable(doc, {
      startY: cursorY + 2,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1.5, overflow: "linebreak" },
      headStyles: { fillColor: [34, 51, 68], textColor: 255 },
      head: [["Particular", "Item", "Spec", "Qty", "Packed"]],
      body: byGroup[g].map((r) => [
        r.particular,
        r.item,
        r.spec,
        r.qty ? String(r.qty) : "",
        r.packed,
      ]),
      columnStyles: {
        3: { halign: "right", cellWidth: 14 },
        4: { halign: "center", cellWidth: 16 },
      },
      margin: { left: margin, right: margin },
    });
    cursorY =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (order.length === 0) {
    doc.setFontSize(10);
    doc.text("No applicable items yet — generate the part list first.", margin, cursorY);
  }

  doc.save(`Part_List_${safe(meta.jobNumber)}.pdf`);
}
