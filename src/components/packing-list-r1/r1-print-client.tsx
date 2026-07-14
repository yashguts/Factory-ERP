"use client";

import { useMemo, useState, useTransition } from "react";
import { Printer, Loader2, Info } from "lucide-react";
import { savePackingPrint, type PrintedLine } from "@/lib/actions/packing-print";
import { readOperator } from "@/lib/jobs/use-operator";
import type { R1ListView, R1CabinPanels } from "@/lib/actions/packing-list-r1";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * SCRATCH print view for a job's Packing List R1 ("PDF Export" tab).
 *
 * Everything here is TEMPORARY: unticking a section/item or changing a
 * quantity affects only this printout — the job's live packing list, BOM,
 * MRP and stock are untouched. On Print the user confirms this is the
 * material actually going out; the exact printed list is then saved as a
 * snapshot (packing_r1_prints) which the dispatch modal cross-checks for
 * the next 72 hours. Live data changes only through Mark Dispatched.
 * ------------------------------------------------------------------ */

interface PrintRow {
  key: string;
  /** null for cabin-panel lines (print-only — cabin never dispatches). */
  item_id: string | null;
  code: string | null;
  name: string;
  uom: string | null;
  qty: number;
  checked: boolean;
}
interface PrintSection {
  title: string;
  rows: PrintRow[];
}

export function R1PrintClient({
  list,
  cabinPanels,
}: {
  list: R1ListView;
  cabinPanels: R1CabinPanels;
}) {
  // Sections seeded from the live list ONCE — from here on it's scratch state.
  // Only picked lines with a positive quantity are printable (same rule as the
  // old PDF export); the Cabin part shows the Cabin Job mirror.
  const [sections, setSections] = useState<PrintSection[]>(() => {
    const out: PrintSection[] = [];
    for (const p of list.parts) {
      const rows: PrintRow[] = [];
      if (p.title === "Cabin" && cabinPanels.hasCabinJob) {
        for (const g of cabinPanels.groups) {
          for (const l of g.lines) {
            if (l.qty > 0)
              rows.push({
                key: `cab-${g.type}-${l.code ?? l.name}`,
                item_id: null,
                code: l.code,
                name: l.name,
                uom: l.uom,
                qty: l.qty,
                checked: true,
              });
          }
        }
      }
      for (const l of p.lines) {
        // Anything with a positive qty prints — including label-only lines with
        // no inventory item: free-text fixtures (Fish Plate, GI Wire, Cotton
        // Wire…), hardware (Nut-Bolts/Screws) and category lines where only a
        // qty was typed. Same rule as the old PDF export. Label-only rows have
        // no item_id, so they print but stay out of the 72h dispatch-diff
        // snapshot (the diff keys on inventory items).
        const name = l.item_name ?? l.label ?? l.category_name;
        if (name && l.qty > 0)
          rows.push({
            key: l.id,
            item_id: l.item_id,
            code: l.item_code,
            name,
            uom: l.uom,
            qty: l.qty,
            checked: true,
          });
      }
      if (rows.length) out.push({ title: p.title, rows });
    }
    return out;
  });
  const [saving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const setRow = (si: number, key: string, fn: (r: PrintRow) => PrintRow) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === si ? { ...s, rows: s.rows.map((r) => (r.key === key ? fn(r) : r)) } : s,
      ),
    );
  const toggleSection = (si: number, checked: boolean) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === si ? { ...s, rows: s.rows.map((r) => ({ ...r, checked })) } : s,
      ),
    );

  const selected = useMemo(
    () => sections.flatMap((s) => s.rows.filter((r) => r.checked && r.qty > 0).map((r) => ({ ...r, part: s.title }))),
    [sections],
  );
  const totalQty = selected.reduce((a, r) => a + r.qty, 0);

  const onPrint = () => {
    setError(null);
    if (selected.length === 0) {
      setError("Nothing selected — tick at least one item to print.");
      return;
    }
    if (
      !window.confirm(
        "Are you sure this is the packing list of material you are going to dispatch?",
      )
    )
      return;
    startTransition(async () => {
      // Snapshot only real inventory items (cabin panels are print-only — they
      // are never dispatch lines, so they'd only add noise to the 72h check).
      const lines: PrintedLine[] = selected
        .filter((r) => r.item_id)
        .map((r) => ({
          item_id: r.item_id as string,
          code: r.code,
          name: r.name,
          part: r.part,
          qty: r.qty,
        }));
      const res = await savePackingPrint(list.jobId, lines, readOperator());
      if (!res.ok) {
        setError(res.error + " — nothing was printed.");
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      // Give React a paint to hide the controls, then open the print dialog.
      setTimeout(() => window.print(), 50);
    });
  };

  let sr = 0;

  return (
    <div className="mx-auto max-w-4xl p-6 print:p-0 print:max-w-none">
      {/* Screen-only toolbar */}
      <div className="print:hidden mb-4 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
            <Info size={14} className="shrink-0" />
            Temporary print view — untick sections/items or change quantities freely;
            <strong className="text-[var(--foreground)]"> nothing here changes the job&rsquo;s live data</strong>.
          </span>
          <span className="ml-auto text-sm tabular-nums text-[var(--muted-foreground)]">
            {selected.length} item{selected.length === 1 ? "" : "s"} · {totalQty.toLocaleString()} qty
          </span>
          <button
            type="button"
            onClick={onPrint}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 cursor-pointer disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            Print
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded bg-[var(--destructive-bg)] px-2 py-1 text-xs text-[var(--destructive)]">
            {error}
          </div>
        )}
        {savedAt && !error && (
          <div className="mt-2 text-xs text-[var(--success)]">
            Printed list saved at {savedAt} — dispatches in the next 72 hours will be checked against it.
          </div>
        )}
      </div>

      {/* Letterhead */}
      <div className="mb-4 border-b-2 border-black pb-2">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">PACKING LIST</h1>
            <p className="text-sm">
              Job No: <strong>{list.jobNumber ?? "—"}</strong>
              {list.customerName && <> · {list.customerName}</>}
            </p>
            {list.address && <p className="text-xs text-[var(--muted-foreground)] print:text-black">{list.address}</p>}
          </div>
          <p className="text-xs">
            Date: {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </p>
        </div>
      </div>

      {/* Sections */}
      {sections.map((s, si) => {
        const allOn = s.rows.every((r) => r.checked);
        const anyOn = s.rows.some((r) => r.checked);
        // A fully-unticked section vanishes from the printout entirely.
        return (
          <div key={s.title} className={cn("mb-3", !anyOn && "print:hidden")}>
            <div className="flex items-center gap-2 border-b border-black bg-[var(--muted)]/60 px-2 py-1 print:bg-transparent">
              <input
                type="checkbox"
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = !allOn && anyOn;
                }}
                onChange={(e) => toggleSection(si, e.target.checked)}
                title={allOn ? "Untick the whole section" : "Tick the whole section"}
                className="print:hidden h-4 w-4 cursor-pointer"
              />
              <h2 className="text-sm font-bold uppercase tracking-wide">{s.title}</h2>
            </div>
            <table className="w-full border-collapse text-sm">
              <tbody>
                {s.rows.map((r) => {
                  const rowSr = r.checked ? ++sr : null;
                  return (
                    <tr
                      key={r.key}
                      className={cn(
                        "border-b border-[var(--border)] print:border-gray-300",
                        !r.checked && "opacity-40 print:hidden",
                      )}
                    >
                      <td className="w-8 py-1 pl-2 print:hidden">
                        <input
                          type="checkbox"
                          checked={r.checked}
                          onChange={(e) => setRow(si, r.key, (x) => ({ ...x, checked: e.target.checked }))}
                          className="h-4 w-4 cursor-pointer"
                        />
                      </td>
                      <td className="w-10 py-1 pl-1 text-right tabular-nums text-[var(--muted-foreground)] print:text-black">
                        {rowSr ?? ""}
                      </td>
                      <td className="w-28 py-1 pl-2 font-mono text-xs">{r.code ?? ""}</td>
                      <td className="py-1 pl-2">{r.name}</td>
                      <td className="w-24 py-1 pr-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={r.qty || ""}
                          disabled={!r.checked}
                          onChange={(e) =>
                            setRow(si, r.key, (x) => ({ ...x, qty: e.target.value ? Number(e.target.value) : 0 }))
                          }
                          className="print:hidden w-20 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-right disabled:opacity-40"
                        />
                        <span className="hidden print:inline font-medium tabular-nums">
                          {r.qty.toLocaleString()}
                        </span>
                      </td>
                      <td className="w-12 py-1 pl-1 text-xs text-[var(--muted-foreground)] print:text-black">
                        {r.uom ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Print footer */}
      <div className="mt-8 hidden print:flex justify-between text-xs">
        <span>Prepared by: ______________________</span>
        <span>Checked by: ______________________</span>
        <span>Received by: ______________________</span>
      </div>
    </div>
  );
}
