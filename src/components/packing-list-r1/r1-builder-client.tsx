"use client";

import { useMemo, useRef, useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import {
  Save,
  FileSpreadsheet,
  FileText,
  Plus,
  Trash2,
  Search,
  PackageCheck,
  CheckCircle2,
  RotateCcw,
  Boxes,
  AlertTriangle,
  ShoppingCart,
} from "lucide-react";
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

// --- a picker scoped to a category (category/hardware lines) ----------------
function ScopedItemPicker({
  categoryId,
  onPick,
}: {
  categoryId: string | null;
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
      itemsInCategory(categoryId, q)
        .then((r) => alive && setRes(r))
        .catch(() => {});
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open, categoryId]);
  if (!categoryId)
    return <span className="text-xs text-amber-600">unmapped — fix in template</span>;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded border border-dashed border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
      >
        <Search size={12} /> pick item
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-96 rounded-md border border-[var(--border)] bg-[var(--background)] shadow-lg">
          <div className="p-1.5 border-b border-[var(--border)]">
            <Input
              size="sm"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter items in this category…"
            />
          </div>
          <div className="max-h-56 overflow-auto">
            {res.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-[var(--muted-foreground)]">No items.</div>
            ) : (
              res.map((i) => (
                <button
                  key={i.id}
                  onClick={() => {
                    onPick(i);
                    setOpen(false);
                    setQ("");
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-[var(--muted)]"
                >
                  <span className="font-mono font-medium">{i.code}</span>
                  <span className="truncate text-[var(--muted-foreground)]">{i.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- a global item search (manual "add item") -------------------------------
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
      searchItems(q.trim(), undefined, 25)
        .then((r) => alive && setRes(r))
        .catch(() => {});
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="relative inline-block" ref={ref}>
      <Input
        size="sm"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="add item by code / name…"
        className="w-56"
      />
      {open && res.length > 0 && (
        <div className="absolute z-30 mt-1 w-96 max-h-56 overflow-auto rounded-md border border-[var(--border)] bg-[var(--background)] shadow-lg">
          {res.map((i) => (
            <button
              key={i.id}
              onClick={() => {
                onPick(i);
                setQ("");
                setRes([]);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-[var(--muted)]"
            >
              <span className="font-mono font-medium">{i.code}</span>
              <span className="truncate text-[var(--muted-foreground)]">{i.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
    list.parts.map((p) => ({
      title: p.title,
      lines: p.lines.map((l) => ({ ...l, _k: l.id })),
    })),
  );
  const [status, setStatus] = useState(list.status);
  const [dirty, setDirty] = useState(false);
  const [newPart, setNewPart] = useState("");

  // Nut-Bolts / Screws category ids (for hardware-line pickers)
  const hwCat = useMemo(() => {
    const hw = categories.find((c) => c.name === "Hardware" && c.parent_id === null);
    const find = (n: string) =>
      categories.find((c) => c.name === n && c.parent_id === hw?.id)?.id ?? null;
    return { "Nut-Bolts": find("Nut-Bolts"), Screws: find("Screws") } as Record<string, string | null>;
  }, [categories]);

  const mut = (fn: (draft: EditPart[]) => void) => {
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
        _k: nk(),
        id: nk(),
        part_title: d[pi].title,
        template_line_id: null,
        kind: "item",
        category_id: null,
        category_name: null,
        item_id: i.id,
        item_code: i.code,
        item_name: i.name,
        uom: i.uom_abbreviation ?? null,
        label: i.name,
        spec: null,
        qty: 1,
        source: "manual",
        sort_order: d[pi].lines.length,
      });
    });
  const addFreeLine = (pi: number) =>
    mut((d) => {
      d[pi].lines.push({
        _k: nk(),
        id: nk(),
        part_title: d[pi].title,
        template_line_id: null,
        kind: "free",
        category_id: null,
        category_name: null,
        item_id: null,
        item_code: null,
        item_name: null,
        uom: null,
        label: "",
        spec: null,
        qty: 1,
        source: "manual",
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

  const pickerCategoryId = (l: EditLine): string | null =>
    l.kind === "hardware" ? hwCat[l.label ?? ""] ?? null : l.category_id;

  const flat = (): R1SaveLine[] =>
    parts.flatMap((p) =>
      p.lines.map((l) => ({
        part_title: p.title,
        template_line_id: l.template_line_id,
        kind: l.kind as PackingLineKind,
        category_id: l.category_id,
        item_id: l.item_id,
        label: l.label,
        spec: l.spec,
        qty: l.qty,
        source: l.source,
      })),
    );

  const save = (newStatus?: "draft" | "final") =>
    startTransition(async () => {
      const st = newStatus ?? status;
      const r = await saveR1List(list.jobId, flat(), st);
      if (r.ok) {
        setStatus(st);
        setDirty(false);
        router.refresh(); // re-load fresh ids + recomputed demand
      } else {
        alert(r.error ?? "Save failed");
      }
    });

  // ---- export rows ----
  const exportRows = parts.flatMap((p) =>
    p.lines.map((l) => ({
      part: p.title,
      particular: l.kind === "item" || l.kind === "free" ? l.label ?? "" : l.label ?? l.category_name ?? "",
      code: l.item_code ?? "",
      item: l.item_name ?? "",
      spec: l.spec ?? "",
      qty: l.qty,
      uom: l.uom ?? "",
    })),
  );
  const exportExcel = () =>
    exportRowsToXlsx({
      rows: exportRows,
      columns: [
        { header: "Part", field: "part" },
        { header: "Particular", field: "particular" },
        { header: "Item Code", field: "code" },
        { header: "Item", field: "item" },
        { header: "Spec", field: "spec" },
        { header: "Qty", field: "qty" },
        { header: "UOM", field: "uom" },
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
    for (const p of parts) {
      if (p.lines.length === 0) continue;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(p.title, 12, y);
      autoTable(doc, {
        startY: y + 2,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 1.2 },
        headStyles: { fillColor: [31, 78, 120] },
        head: [["Particular", "Code", "Item", "Spec", "Qty"]],
        body: p.lines.map((l) => [
          l.label ?? l.category_name ?? "",
          l.item_code ?? "",
          l.item_name ?? "",
          l.spec ?? "",
          String(l.qty ?? ""),
        ]),
        margin: { left: 12, right: 12 },
      });
      y =
        ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
      if (y > 270) {
        doc.addPage();
        y = 16;
      }
    }
    doc.save(`PackingList_R1_${list.jobNumber ?? list.jobId}.pdf`);
  };

  const filledItems = parts.reduce(
    (s, p) => s + p.lines.filter((l) => l.item_id).length,
    0,
  );

  return (
    <>
      <PageHeader
        title={
          <span>
            Packing List R1{" "}
            <span className="font-mono text-[var(--primary)]">{list.jobNumber ?? ""}</span>
          </span>
        }
        meta={`${filledItems} items`}
        icon={<PackageCheck size={18} />}
        onBack={() => router.push("/packing-list-r1")}
        actions={
          <div className="flex items-center gap-2">
            <span
              className={
                "rounded px-1.5 py-0.5 text-[11px] font-medium " +
                (status === "final" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")
              }
            >
              {status}
              {dirty ? " • unsaved" : ""}
            </span>
            <Button size="sm" variant="secondary" onClick={exportExcel}>
              <FileSpreadsheet size={15} /> Excel
            </Button>
            <Button size="sm" variant="secondary" onClick={exportPdf}>
              <FileText size={15} /> PDF
            </Button>
            {status === "draft" ? (
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => save("final")}>
                <CheckCircle2 size={15} /> Mark Final
              </Button>
            ) : (
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => save("draft")}>
                <RotateCcw size={15} /> Reopen
              </Button>
            )}
            <Button size="sm" disabled={pending} onClick={() => save()}>
              <Save size={15} /> {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      />

      {/* Demand summary (from last saved state) */}
      <KpiGrid>
        <KpiCard icon={<Boxes size={16} />} label="Demand items" value={demand.totals.items} tone="default" />
        <KpiCard
          icon={<AlertTriangle size={16} />}
          label="Short of stock"
          value={demand.totals.shortfallItems}
          tone={demand.totals.shortfallItems > 0 ? "warning" : "success"}
        />
        <KpiCard
          icon={<ShoppingCart size={16} />}
          label="To buy (trade)"
          value={demand.trade.filter((r) => r.to_buy > 0).length}
          tone="default"
        />
      </KpiGrid>
      {dirty && (
        <p className="text-xs text-amber-600 mb-3">
          Demand below reflects the last <strong>saved</strong> state — save to refresh it.
        </p>
      )}

      {/* Builder */}
      <div className="space-y-3 mt-4">
        {parts.map((part, pi) => (
          <div key={part.title + pi} className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/40">
              <span className="text-sm font-semibold">{part.title}</span>
              <span className="text-[11px] text-[var(--muted-foreground)]">
                {part.lines.filter((l) => l.item_id).length}/{part.lines.length} filled
              </span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {part.lines.map((l, li) => {
                  const catId = pickerCategoryId(l);
                  return (
                    <tr key={l._k} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="px-3 py-1.5 align-top w-64">
                        <div className="font-medium">
                          {l.kind === "free" ? (
                            <Input
                              size="sm"
                              value={l.label ?? ""}
                              onChange={(e) => setLine(pi, li, { label: e.target.value })}
                              placeholder="free-text…"
                            />
                          ) : (
                            <span>{l.label ?? l.category_name ?? "—"}</span>
                          )}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          {l.kind}
                          {l.source === "auto" ? " · auto" : ""}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 align-top">
                        {l.item_id ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="font-mono text-xs">{l.item_code}</span>
                            <span className="text-[var(--muted-foreground)] text-xs">{l.item_name}</span>
                            {(l.kind === "category" || l.kind === "hardware") && (
                              <button
                                onClick={() =>
                                  setLine(pi, li, { item_id: null, item_code: null, item_name: null, uom: null })
                                }
                                className="text-[var(--muted-foreground)] hover:text-red-600"
                                title="clear"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ) : l.kind === "category" || l.kind === "hardware" ? (
                          <ScopedItemPicker
                            categoryId={catId}
                            onPick={(i) =>
                              setLine(pi, li, {
                                item_id: i.id,
                                item_code: i.code,
                                item_name: i.name,
                                uom: i.uom,
                                source: "manual",
                              })
                            }
                          />
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top w-20">
                        <Input
                          size="sm"
                          type="number"
                          value={String(l.qty ?? 0)}
                          onChange={(e) => setLine(pi, li, { qty: Number(e.target.value) || 0 })}
                          className="text-right"
                        />
                      </td>
                      <td className="px-2 py-1.5 align-top w-8 text-right">
                        <button
                          onClick={() => delLine(pi, li)}
                          className="p-1 rounded hover:bg-red-50 text-red-600"
                          title="delete line"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center gap-2 px-3 py-1.5 border-t border-dashed border-[var(--border)]">
              <Plus size={13} className="text-[var(--muted-foreground)]" />
              <GlobalItemPicker onPick={(i) => addItemLine(pi, i)} />
              <Button size="sm" variant="ghost" onClick={() => addFreeLine(pi)}>
                + free line
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Add a part */}
      <div className="mt-3 flex items-center gap-2">
        <Input
          size="sm"
          value={newPart}
          onChange={(e) => setNewPart(e.target.value)}
          placeholder="New part…"
          className="w-44"
          onKeyDown={(e) => e.key === "Enter" && addPart()}
        />
        <Button size="sm" variant="secondary" onClick={addPart} disabled={!newPart.trim()}>
          <Plus size={15} /> Add Part
        </Button>
      </div>

      {/* Demand detail */}
      <DemandTables demand={demand} />
    </>
  );
}

function DemandTables({ demand }: { demand: R1Demand }) {
  const block = (title: string, rows: R1Demand["make"]) =>
    rows.length === 0 ? null : (
      <div className="mt-5">
        <div className="text-sm font-medium mb-2">
          {title} <span className="text-[var(--muted-foreground)]">({rows.length})</span>
        </div>
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--muted)] text-[var(--muted-foreground)]">
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
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r) => (
                <tr key={r.item_id} className={r.shortfall > 0 ? "bg-amber-50/40" : ""}>
                  <td className="px-2 py-1 font-mono">{r.code}</td>
                  <td className="px-2 py-1 truncate max-w-[260px]">{r.name}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.required}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.on_hand}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.on_order}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-medium">
                    {r.shortfall > 0 ? r.shortfall : "—"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums font-medium text-[var(--primary)]">
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
    <div className="mt-6">
      <h2 className="text-base font-semibold">Demand list (vs current stock)</h2>
      {demand.totals.items === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)] mt-2">
          No items with quantities yet — fill some lines and Save.
        </p>
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
