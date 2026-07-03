import type { DispatchHistory, DispatchSummaryLine, PhaseScope } from "@/lib/actions/dispatch";

/**
 * Dispatch paperwork — the two printouts of the job lifecycle:
 *  - DISPATCH LIST: what went out on one dated dispatch (printed each time the
 *    factory records a dispatch; also reprintable from the history).
 *  - BALANCE LIST: what is still left to send on the job (required − sent per
 *    line), grouped by phase — the sheet the team preps the next dispatch from.
 * jsPDF is imported dynamically so it stays out of the page bundle.
 */

const SCOPE_LABEL: Record<PhaseScope, string> = {
  first: "1st phase",
  second: "2nd phase",
  full: "Entire job",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const num = (n: number) => Number(n).toLocaleString("en-IN");
const safe = (s: string) => (s || "job").replace(/[^a-z0-9]+/gi, "_");

interface JobHeaderInfo {
  jobNumber: string | null;
  customerName?: string | null;
  location?: string | null;
}

/** Shared letterhead: title + job identity row. Returns the next y. */
function drawHeader(
  doc: import("jspdf").jsPDF,
  title: string,
  info: JobHeaderInfo,
  subtitle: string,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(title, pageW / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(subtitle, pageW / 2, y, { align: "center" });
  y += 7;

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`Job: ${info.jobNumber ?? "—"}`, margin, y);
  doc.setFont("helvetica", "normal");
  const right: string[] = [];
  if (info.customerName) right.push(info.customerName);
  if (info.location) right.push(info.location);
  if (right.length) doc.text(right.join("  ·  "), pageW - margin, y, { align: "right" });
  y += 3;
  doc.setDrawColor(180);
  doc.line(margin, y, pageW - margin, y);
  return y + 4;
}

/** Signature strip at a fixed distance below the table. */
function drawSignatures(doc: import("jspdf").jsPDF, startY: number): void {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const y = Math.min(startY + 18, doc.internal.pageSize.getHeight() - 18);
  const cols = ["Prepared by", "Checked by", "Vehicle / LR no.", "Received by"];
  const w = (pageW - margin * 2) / cols.length;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  cols.forEach((c, i) => {
    const x = margin + i * w;
    doc.setDrawColor(120);
    doc.line(x + 4, y, x + w - 8, y);
    doc.text(c, x + 4, y + 4.5);
  });
}

export interface DispatchNoteLine {
  code: string | null;
  name: string | null;
  category: string | null;
  qty: number;
  adhoc?: boolean;
}

/** One dated dispatch → the DISPATCH LIST that travels with the material. */
export async function downloadDispatchNotePdf(opts: {
  info: JobHeaderInfo;
  dispatchDate: string;
  phaseScope: PhaseScope;
  note?: string | null;
  lines: DispatchNoteLine[];
}): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const margin = 14;

  let y = drawHeader(
    doc,
    "DISPATCH LIST",
    opts.info,
    `${fmtDate(opts.dispatchDate)}  ·  ${SCOPE_LABEL[opts.phaseScope]}${opts.note ? `  ·  ${opts.note}` : ""}`,
  );

  const total = opts.lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["#", "Code", "Item", "Section", "Qty"]],
    body: opts.lines.map((l, i) => [
      String(i + 1),
      l.code ?? "",
      `${l.name ?? "(item)"}${l.adhoc ? "  (extra — not on the packing list)" : ""}`,
      l.category ?? "",
      num(Number(l.qty) || 0),
    ]),
    foot: [["", "", "", "Total", num(total)]],
    styles: { fontSize: 8.5, cellPadding: 1.6 },
    headStyles: { fillColor: [34, 51, 68], fontSize: 8.5 },
    footStyles: { fillColor: [240, 244, 248], textColor: 20, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 26 }, 3: { cellWidth: 34 }, 4: { cellWidth: 20, halign: "right" } },
  });

  const endY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
  drawSignatures(doc, endY);
  doc.save(`Dispatch_${safe(opts.info.jobNumber ?? "job")}_${opts.dispatchDate}.pdf`);
}

/** Reprint an already-recorded dispatch from the history. */
export async function downloadDispatchHistoryPdf(info: JobHeaderInfo, d: DispatchHistory): Promise<void> {
  await downloadDispatchNotePdf({
    info,
    dispatchDate: d.dispatch_date,
    phaseScope: d.phase_scope,
    note: d.note,
    lines: d.lines.map((l) => ({
      code: l.item_code,
      name: l.item_name ?? l.label,
      category: l.category,
      qty: l.qty,
      adhoc: l.adhoc,
    })),
  });
}

/** What's still LEFT to send on the job (required − sent), grouped by phase. */
export async function downloadBalancePdf(info: JobHeaderInfo, lines: DispatchSummaryLine[]): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const margin = 14;

  const pending = lines
    .filter((l) => l.remaining > 0)
    .sort((a, b) => a.phase.localeCompare(b.phase) || a.category.localeCompare(b.category) || (a.item_name ?? "").localeCompare(b.item_name ?? ""));

  let y = drawHeader(
    doc,
    "BALANCE TO DISPATCH",
    info,
    `Printed ${fmtDate(new Date().toISOString())}  ·  ${pending.length} item${pending.length === 1 ? "" : "s"} pending`,
  );

  if (pending.length === 0) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("All materials dispatched — nothing pending.", margin, y + 6);
  } else {
    for (const phase of ["first", "second"] as const) {
      const rows = pending.filter((l) => l.phase === phase);
      if (rows.length === 0) continue;
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(phase === "first" ? "1st phase" : "2nd phase", margin, y + 4);
      autoTable(doc, {
        startY: y + 6,
        margin: { left: margin, right: margin },
        head: [["Code", "Item", "Section", "Required", "Sent", "Left"]],
        body: rows.map((l) => [
          l.item_code ?? "",
          l.item_name ?? "(item)",
          l.category,
          num(l.required),
          num(l.dispatched),
          num(l.remaining),
        ]),
        styles: { fontSize: 8.5, cellPadding: 1.5 },
        headStyles: { fillColor: [34, 51, 68], fontSize: 8.5 },
        columnStyles: {
          0: { cellWidth: 26 },
          2: { cellWidth: 32 },
          3: { cellWidth: 20, halign: "right" },
          4: { cellWidth: 16, halign: "right" },
          5: { cellWidth: 16, halign: "right", fontStyle: "bold" },
        },
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 4;
    }
  }

  doc.save(`Balance_${safe(info.jobNumber ?? "job")}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
