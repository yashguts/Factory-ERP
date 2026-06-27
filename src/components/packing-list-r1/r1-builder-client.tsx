"use client";

import { useRef, useState, useEffect, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Save, FileSpreadsheet, FileText, CheckCircle2, RotateCcw, Trash2 } from "lucide-react";
import {
  saveR1List,
  itemsInCategory,
  type R1ListView,
  type R1Line,
  type R1Demand,
  type R1CatItem,
  type R1SaveLine,
} from "@/lib/actions/packing-list-r1";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import { exportRowsToXlsx } from "@/lib/export/xlsx";
import type { CategoryNode } from "@/lib/actions/categories";
import type { PackingLineKind } from "@/lib/supabase/types";

type EditLine = R1Line & { _k: string };
interface EditPart {
  title: string;
  lines: EditLine[];
}

const C = {
  navy: "#223344",
  head: "#eef2f6",
  line: "#e5e7eb",
  acc: "#2563eb",
  mut: "#6b7280",
};

// select-styled trigger → scoped item picker (category / hardware lines)
function ScopedItemPicker({
  categoryId,
  placeholder,
  onPick,
}: {
  categoryId: string | null;
  placeholder: string;
  onPick: (i: R1CatItem) => void;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<R1CatItem[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => {
    if (!open || !categoryId) return;
    let alive = true;
    const t = setTimeout(() => {
      itemsInCategory(categoryId, q).then((r) => alive && setRes(r)).catch(() => {});
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open, categoryId]);
  if (!categoryId)
    return <span className="text-xs text-amber-600">⚠ unmapped — fix in Template</span>;
  return (
    <div className="relative max-w-[560px]" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left rounded-md border bg-white px-2.5 py-1.5 text-xs text-[#6b7280] hover:border-[#2563eb]"
        style={{ borderColor: C.line }}
      >
        — select from {placeholder} —
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[360px] rounded-md border bg-white shadow-lg" style={{ borderColor: C.line }}>
          <div className="p-1.5 border-b" style={{ borderColor: C.line }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filter…"
              className="w-full rounded border px-2 py-1 text-xs"
              style={{ borderColor: C.line }}
            />
          </div>
          <div className="max-h-56 overflow-auto">
            {res.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-[#6b7280]">No items.</div>
            ) : (
              res.map((i) => (
                <button
                  key={i.id}
                  onClick={() => {
                    onPick(i);
                    setOpen(false);
                    setQ("");
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-[#f1f5f9]"
                >
                  <span className="font-mono font-medium">{i.code}</span>
                  <span className="truncate text-[#6b7280]">{i.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// global item search (manual "add item")
function GlobalItemPicker({ onPick }: { onPick: (i: SearchableItem) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchableItem[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      searchItems(q.trim(), undefined, 25).then((r) => alive && setRes(r)).catch(() => {});
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="relative inline-block" ref={ref}>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="+ add item by code / name…"
        className="w-60 rounded-md border px-2.5 py-1.5 text-xs"
        style={{ borderColor: C.line }}
      />
      {open && res.length > 0 && (
        <div className="absolute z-30 mt-1 w-96 max-h-56 overflow-auto rounded-md border bg-white shadow-lg" style={{ borderColor: C.line }}>
          {res.map((i) => (
            <button
              key={i.id}
              onClick={() => {
                onPick(i);
                setQ("");
                setRes([]);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-[#f1f5f9]"
            >
              <span className="font-mono font-medium">{i.code}</span>
              <span className="truncate text-[#6b7280]">{i.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CodeChip = ({ code }: { code: string }) => (
  <span className="ml-1.5 rounded bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[10px] text-[#6b7280]">{code}</span>
);

function ToolbarBtn({
  onClick,
  primary,
  disabled,
  children,
}: {
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50 " +
        (primary
          ? "bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
          : "border border-white/25 bg-white/10 text-white hover:bg-white/20")
      }
    >
      {children}
    </button>
  );
}

export function R1BuilderClient({
  list,
  categories,
  demand,
}: {
  list: R1ListView;
  categories: CategoryNode[];
  demand: R1Demand;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const keyRef = useRef(0);
  const nk = () => `n${keyRef.current++}`;

  const [parts, setParts] = useState<EditPart[]>(() =>
    list.parts.map((p) => ({ title: p.title, lines: p.lines.map((l) => ({ ...l, _k: l.id })) })),
  );
  const [status, setStatus] = useState(list.status);
  const [dirty, setDirty] = useState(false);
  const [newPart, setNewPart] = useState("");

  const hw = categories.find((c) => c.name === "Hardware" && c.parent_id === null);
  const hwCat: Record<string, string | null> = {
    "Nut-Bolts": categories.find((c) => c.name === "Nut-Bolts" && c.parent_id === hw?.id)?.id ?? null,
    Screws: categories.find((c) => c.name === "Screws" && c.parent_id === hw?.id)?.id ?? null,
  };

  const mut = (fn: (d: EditPart[]) => void) => {
    setParts((prev) => {
      const next = prev.map((p) => ({ title: p.title, lines: p.lines.map((l) => ({ ...l })) }));
      fn(next);
      return next;
    });
    setDirty(true);
  };
  const setLine = (pi: number, li: number, patch: Partial<EditLine>) =>
    mut((d) => {
      d[pi].lines[li] = { ...d[pi].lines[li], ...patch };
    });
  const delLine = (pi: number, li: number) =>
    mut((d) => {
      d[pi].lines.splice(li, 1);
    });
  const addItemLine = (pi: number, i: SearchableItem) =>
    mut((d) => {
      d[pi].lines.push({
        _k: nk(), id: nk(), part_title: d[pi].title, template_line_id: null, kind: "item",
        category_id: null, category_name: null, item_id: i.id, item_code: i.code, item_name: i.name,
        uom: i.uom_abbreviation ?? null, label: i.name, spec: null, qty: 1, source: "manual",
        group: "Items", sort_order: d[pi].lines.length,
      });
    });
  const addFreeLine = (pi: number) =>
    mut((d) => {
      d[pi].lines.push({
        _k: nk(), id: nk(), part_title: d[pi].title, template_line_id: null, kind: "free",
        category_id: null, category_name: null, item_id: null, item_code: null, item_name: null,
        uom: null, label: "", spec: null, qty: 1, source: "manual", group: "Other",
        sort_order: d[pi].lines.length,
      });
    });
  const addPart = () => {
    const t = newPart.trim();
    if (!t) return;
    setParts((p) => [...p, { title: t, lines: [] }]);
    setNewPart("");
    setDirty(true);
  };
  const pickerCat = (l: EditLine) => (l.kind === "hardware" ? hwCat[l.label ?? ""] ?? null : l.category_id);

  const flat = (): R1SaveLine[] =>
    parts.flatMap((p) =>
      p.lines.map((l) => ({
        part_title: p.title, template_line_id: l.template_line_id, kind: l.kind as PackingLineKind,
        category_id: l.category_id, item_id: l.item_id, label: l.label, spec: l.spec, qty: l.qty, source: l.source,
      })),
    );
  const save = (newStatus?: "draft" | "final") =>
    startTransition(async () => {
      const st = newStatus ?? status;
      const r = await saveR1List(list.jobId, flat(), st);
      if (r.ok) {
        setStatus(st);
        setDirty(false);
        router.refresh();
      } else alert(r.error ?? "Save failed");
    });

  const exportRows = parts.flatMap((p) =>
    p.lines.map((l) => ({
      part: p.title, group: l.group ?? "", particular: l.label ?? l.category_name ?? "",
      code: l.item_code ?? "", item: l.item_name ?? "", qty: l.qty, uom: l.uom ?? "",
    })),
  );
  const exportExcel = () =>
    exportRowsToXlsx({
      rows: exportRows,
      columns: [
        { header: "Part", field: "part" }, { header: "Group", field: "group" },
        { header: "Particular", field: "particular" }, { header: "Item Code", field: "code" },
        { header: "Item", field: "item" }, { header: "Qty", field: "qty" }, { header: "UOM", field: "uom" },
      ],
      filename: `PackingList_R1_${list.jobNumber ?? list.jobId}`,
      sheetName: "Packing List R1",
    });
  const exportPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(`Packing List R1 - ${list.jobNumber ?? ""}`, 12, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Status: ${status}   |   ${new Date().toLocaleDateString()}`, 12, 22);
    let y = 28;
    parts.forEach((p, pi) => {
      if (p.lines.length === 0) return;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`PART ${pi + 1}  ${p.title.toUpperCase()}`, 12, y);
      autoTable(doc, {
        startY: y + 2, theme: "grid", styles: { fontSize: 8, cellPadding: 1.2 },
        headStyles: { fillColor: [34, 51, 68] },
        head: [["Group", "Particular", "Code", "Item", "Qty"]],
        body: p.lines.map((l) => [l.group ?? "", l.label ?? l.category_name ?? "", l.item_code ?? "", l.item_name ?? "", String(l.qty ?? "")]),
        margin: { left: 12, right: 12 },
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
      if (y > 270) {
        doc.addPage();
        y = 16;
      }
    });
    doc.save(`PackingList_R1_${list.jobNumber ?? list.jobId}.pdf`);
  };

  const filled = parts.reduce((s, p) => s + p.lines.filter((l) => l.item_id).length, 0);
  const totalLines = parts.reduce((s, p) => s + p.lines.length, 0);

  // bucket a part's lines by group, keeping each line's original index
  const buckets = (lines: EditLine[]): [string, [number, EditLine][]][] => {
    const order: string[] = [];
    const map = new Map<string, [number, EditLine][]>();
    lines.forEach((l, li) => {
      const g = l.group || "Other";
      if (!map.has(g)) {
        map.set(g, []);
        order.push(g);
      }
      map.get(g)!.push([li, l]);
    });
    return order.map((g) => [g, map.get(g)!]);
  };

  return (
    <div className="max-w-[1000px] mx-auto">
      {/* Navy header + toolbar */}
      <header className="rounded-[10px] px-5 py-3.5 mb-3 flex items-center justify-between" style={{ background: C.navy, color: "#fff" }}>
        <div>
          <button onClick={() => router.push("/packing-list-r1")} className="text-xs opacity-80 hover:opacity-100">
            ← Packing Lists
          </button>
          <h1 className="text-[17px] font-semibold mt-0.5">
            Packing List R1 · <span className="font-mono">{list.jobNumber ?? ""}</span>
          </h1>
          <p className="text-xs opacity-85 mt-0.5">
            {status}
            {dirty ? " • unsaved" : ""} · {filled}/{totalLines} lines filled
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToolbarBtn onClick={exportExcel}>
            <FileSpreadsheet size={14} /> Excel
          </ToolbarBtn>
          <ToolbarBtn onClick={exportPdf}>
            <FileText size={14} /> PDF
          </ToolbarBtn>
          {status === "draft" ? (
            <ToolbarBtn onClick={() => save("final")} disabled={pending}>
              <CheckCircle2 size={14} /> Mark Final
            </ToolbarBtn>
          ) : (
            <ToolbarBtn onClick={() => save("draft")} disabled={pending}>
              <RotateCcw size={14} /> Reopen
            </ToolbarBtn>
          )}
          <ToolbarBtn onClick={() => save()} primary disabled={pending}>
            <Save size={14} /> {pending ? "Saving…" : "Save"}
          </ToolbarBtn>
        </div>
      </header>

      {/* Demand summary strip */}
      <div className="grid grid-cols-3 gap-3 mb-1">
        {[
          { l: "Demand items", v: demand.totals.items },
          { l: "Short of stock", v: demand.totals.shortfallItems, warn: demand.totals.shortfallItems > 0 },
          { l: "To buy (trade)", v: demand.trade.filter((r) => r.to_buy > 0).length },
        ].map((k) => (
          <div key={k.l} className="rounded-lg border bg-white px-4 py-2.5" style={{ borderColor: C.line }}>
            <div className="text-[10px] uppercase tracking-wide text-[#6b7280]">{k.l}</div>
            <div className={"text-xl font-semibold " + (k.warn ? "text-amber-600" : "")}>{k.v}</div>
          </div>
        ))}
      </div>
      {dirty && (
        <p className="text-[11px] text-amber-600 mb-3">Demand reflects the last saved state — Save to refresh.</p>
      )}

      {/* Parts */}
      <div className="mt-3 space-y-3.5">
        {parts.map((part, pi) => (
          <section key={part.title + pi} className="rounded-[10px] border bg-white overflow-hidden" style={{ borderColor: C.line }}>
            <h2 className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold border-b" style={{ background: C.head, borderColor: C.line }}>
              <span className="rounded px-1.5 py-0.5 text-[10px] tracking-wider text-white" style={{ background: C.navy }}>
                PART {pi + 1}
              </span>
              <span className="uppercase">{part.title}</span>
              <span className="ml-auto text-[11px] font-normal text-[#6b7280]">
                {part.lines.filter((l) => l.item_id).length}/{part.lines.length} filled
              </span>
            </h2>

            {buckets(part.lines).map(([gname, glines]) => (
              <div key={gname} className="px-3.5 pt-1.5 pb-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#6b7280] mt-2 mb-1">{gname}</div>
                <table className="w-full border-collapse">
                  <tbody>
                    {glines.map(([li, l]) => (
                      <tr key={l._k} className="border-b" style={{ borderColor: "#f1f5f9" }}>
                        <td className="py-1 pr-2 align-middle w-[34%] font-medium">
                          {l.kind === "free" ? (
                            <input
                              value={l.label ?? ""}
                              onChange={(e) => setLine(pi, li, { label: e.target.value })}
                              placeholder="free-text…"
                              className="w-full rounded border px-2 py-1 text-xs"
                              style={{ borderColor: C.line }}
                            />
                          ) : (
                            <span>{l.label ?? l.category_name ?? "—"}</span>
                          )}
                          {l.source === "auto" && <span className="ml-1.5 text-[10px] italic" style={{ color: C.acc }}>auto</span>}
                        </td>
                        <td className="py-1 px-2 align-middle w-[48%]">
                          {l.item_id ? (
                            <span className="inline-flex items-center">
                              <span className="font-medium">{l.item_name}</span>
                              {l.item_code && <CodeChip code={l.item_code} />}
                              {(l.kind === "category" || l.kind === "hardware") && (
                                <button
                                  onClick={() => setLine(pi, li, { item_id: null, item_code: null, item_name: null, uom: null })}
                                  className="ml-1.5 text-[#6b7280] hover:text-red-600"
                                  title="clear"
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          ) : l.kind === "category" || l.kind === "hardware" ? (
                            <ScopedItemPicker
                              categoryId={pickerCat(l)}
                              placeholder={l.category_name ?? l.label ?? "category"}
                              onPick={(i) => setLine(pi, li, { item_id: i.id, item_code: i.code, item_name: i.name, uom: i.uom, source: "manual" })}
                            />
                          ) : (
                            <span className="text-xs text-[#6b7280]">—</span>
                          )}
                        </td>
                        <td className="py-1 px-2 align-middle w-[12%]">
                          <input
                            type="number"
                            min={0}
                            value={String(l.qty ?? 0)}
                            onChange={(e) => setLine(pi, li, { qty: Number(e.target.value) || 0 })}
                            placeholder="QTY"
                            className="w-full max-w-[90px] rounded border px-2 py-1 text-xs text-right"
                            style={{ borderColor: C.line }}
                          />
                        </td>
                        <td className="py-1 pl-2 align-middle w-[6%] text-right">
                          <button onClick={() => delLine(pi, li)} className="p-1 rounded hover:bg-red-50 text-red-600" title="delete">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            <div className="flex items-center gap-2 px-3.5 py-2 border-t border-dashed" style={{ borderColor: C.line }}>
              <GlobalItemPicker onPick={(i) => addItemLine(pi, i)} />
              <button onClick={() => addFreeLine(pi)} className="rounded-md border border-dashed px-2.5 py-1.5 text-xs" style={{ borderColor: C.acc, color: C.acc }}>
                + free line
              </button>
            </div>
          </section>
        ))}
      </div>

      {/* Add a part */}
      <div className="mt-3 flex items-center gap-2">
        <input
          value={newPart}
          onChange={(e) => setNewPart(e.target.value)}
          placeholder="New part…"
          className="w-44 rounded-md border px-2.5 py-1.5 text-xs"
          style={{ borderColor: C.line }}
          onKeyDown={(e) => e.key === "Enter" && addPart()}
        />
        <button onClick={addPart} disabled={!newPart.trim()} className="rounded-md border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: C.line }}>
          + Add Part
        </button>
      </div>

      <DemandTables demand={demand} />

      <p className="text-[11px] text-center text-[#6b7280] my-6">
        Packing List R1 · seeded from the shared template + this job&apos;s BOM · pick an item per line, set QTY, Save.
      </p>
    </div>
  );
}

function DemandTables({ demand }: { demand: R1Demand }) {
  const block = (title: string, rows: R1Demand["make"]) =>
    rows.length === 0 ? null : (
      <div className="mt-5">
        <div className="text-sm font-medium mb-2">
          {title} <span className="text-[#6b7280]">({rows.length})</span>
        </div>
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "#e5e7eb" }}>
          <table className="w-full text-xs">
            <thead className="bg-[#f1f5f9] text-[#6b7280]">
              <tr>
                <th className="text-left font-medium px-2 py-1.5">Code</th>
                <th className="text-left font-medium px-2 py-1.5">Item</th>
                <th className="text-right font-medium px-2 py-1.5">Required</th>
                <th className="text-right font-medium px-2 py-1.5">In stock</th>
                <th className="text-right font-medium px-2 py-1.5">On order</th>
                <th className="text-right font-medium px-2 py-1.5">Shortfall</th>
                <th className="text-right font-medium px-2 py-1.5">To buy</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "#e5e7eb" }}>
              {rows.map((r) => (
                <tr key={r.item_id} className={r.shortfall > 0 ? "bg-amber-50/40" : ""}>
                  <td className="px-2 py-1 font-mono">{r.code}</td>
                  <td className="px-2 py-1 truncate max-w-[260px]">{r.name}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.required}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.on_hand}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.on_order}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-medium">{r.shortfall > 0 ? r.shortfall : "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-medium" style={{ color: "#2563eb" }}>
                    {r.to_buy > 0 ? r.to_buy : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  return (
    <div className="mt-7">
      <h2 className="text-base font-semibold">Demand list (vs current stock)</h2>
      {demand.totals.items === 0 ? (
        <p className="text-sm text-[#6b7280] mt-2">No items with quantities yet — fill some lines and Save.</p>
      ) : (
        <>
          {block("Trade (to procure)", demand.trade)}
          {block("Make (to produce)", demand.make)}
          {block("Unclassified", demand.unclassified)}
        </>
      )}
    </div>
  );
}
