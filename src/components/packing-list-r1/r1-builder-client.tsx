"use client";

import { Fragment, useRef, useState, useEffect, useMemo, useCallback, useTransition, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Save, FileSpreadsheet, FileText, CheckCircle2, RotateCcw, Trash2, FolderTree, Loader2 } from "lucide-react";
import { CategoryPickerModal } from "@/components/jobs/category-picker-modal";
import {
  saveR1List,
  itemsInCategory,
  type R1ListView,
  type R1Line,
  type R1Demand,
  type R1UnmappedItem,
  type R1SaveLine,
  type R1CabinPanels,
} from "@/lib/actions/packing-list-r1";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import { isStaleActionError } from "@/components/layout/stale-deploy-guard";
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

// per-line item search — autocomplete with an "All categories" toggle.
// Scoped by default (the line's category subtree, descendant-aware via
// itemsInCategory); tick "All categories" to search the whole catalog
// (searchItems). Mirrors the Job-Order ItemRow interaction (debounce +
// keyboard nav + results dropdown).
type RichPick = { id: string; code: string; name: string; uom: string | null };
function RichItemPicker({
  categoryId,
  placeholder,
  onPick,
}: {
  categoryId: string | null;
  placeholder: string;
  onPick: (i: RichPick) => void;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<RichPick[]>([]);
  const [open, setOpen] = useState(false);
  const [allCats, setAllCats] = useState(false);
  const [hi, setHi] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const run = useCallback(
    (query: string) => {
      if (deb.current) clearTimeout(deb.current);
      const delay = query ? 250 : 30;
      deb.current = setTimeout(async () => {
        const s = ++seq.current;
        if (allCats && query.trim().length < 2) {
          if (seq.current === s) {
            setRes([]);
            setLoading(false);
          }
          return;
        }
        setLoading(true);
        try {
          let out: RichPick[] = [];
          if (allCats) {
            const r = await searchItems(query.trim(), undefined, 40);
            out = r.map((i) => ({ id: i.id, code: i.code, name: i.name, uom: i.uom_abbreviation ?? null }));
          } else if (categoryId) {
            const r = await itemsInCategory(categoryId, query);
            out = r.map((i) => ({ id: i.id, code: i.code, name: i.name, uom: i.uom ?? null }));
          }
          if (seq.current === s) {
            setRes(out);
            setHi(0);
          }
        } catch (e) {
          // A stale tab's server-action call fails silently here — re-throw so
          // the global StaleDeployGuard catches it and prompts a reload instead
          // of the search just looking empty.
          if (isStaleActionError(e)) throw e;
          if (seq.current === s) setRes([]);
        } finally {
          if (seq.current === s) setLoading(false);
        }
      }, delay);
    },
    [allCats, categoryId],
  );

  useEffect(() => {
    if (open) run(q);
    return () => {
      if (deb.current) clearTimeout(deb.current);
    };
  }, [open, q, allCats, categoryId, run]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${hi}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const pick = (i: RichPick) => {
    onPick(i);
    setOpen(false);
    setQ("");
    setRes([]);
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, res.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (res[hi]) pick(res[hi]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (!categoryId)
    return <span className="text-xs text-amber-600">⚠ unmapped — fix in Template</span>;

  return (
    <div className="relative w-full" ref={ref}>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={allCats ? "search all items…" : `search ${placeholder}…`}
        className="w-full rounded border px-2 py-1 text-xs"
        style={{ borderColor: C.line }}
      />
      {open && (
        <div className="absolute z-30 mt-1 min-w-full w-[460px] max-w-[92vw] rounded-md border bg-white shadow-lg" style={{ borderColor: C.line }} ref={listRef}>
          <label className="flex items-center gap-1.5 px-2 py-1 border-b text-[10px] text-[#6b7280] cursor-pointer select-none" style={{ borderColor: C.line }}>
            <input
              type="checkbox"
              checked={allCats}
              onChange={(e) => {
                setAllCats(e.target.checked);
                setHi(0);
              }}
              className="h-3 w-3"
            />
            All categories
          </label>
          <div className="max-h-64 overflow-auto">
            {loading ? (
              <div className="px-2.5 py-2 text-xs text-[#6b7280]">Searching…</div>
            ) : res.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-[#6b7280]">
                {allCats ? "Type 2+ characters to search all items." : "No items."}
              </div>
            ) : (
              res.map((i, idx) => (
                <button
                  key={i.id}
                  data-idx={idx}
                  onMouseEnter={() => setHi(idx)}
                  onClick={() => pick(i)}
                  className={"flex w-full items-start gap-2 px-2.5 py-1.5 text-xs text-left " + (idx === hi ? "bg-[#f1f5f9]" : "hover:bg-[#f1f5f9]")}
                >
                  <span className="font-mono font-medium shrink-0">{i.code}</span>
                  <span className="text-[#6b7280] whitespace-normal break-words leading-snug">{i.name}</span>
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
      searchItems(q.trim(), undefined, 25)
        .then((r) => alive && setRes(r))
        // Surface a stale-deploy "Server Action not found" to the global guard
        // (a swallowed .catch would otherwise make the search look broken).
        .catch((e) => {
          if (isStaleActionError(e)) throw e;
        });
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
        className="w-72 rounded-md border px-2.5 py-1 text-xs"
        style={{ borderColor: C.line }}
      />
      {open && res.length > 0 && (
        <div className="absolute z-30 mt-1 w-[460px] max-w-[92vw] max-h-64 overflow-auto rounded-md border bg-white shadow-lg" style={{ borderColor: C.line }}>
          {res.map((i) => (
            <button
              key={i.id}
              onClick={() => {
                onPick(i);
                setQ("");
                setRes([]);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-[#f1f5f9]"
            >
              <span className="font-mono font-medium shrink-0">{i.code}</span>
              <span className="text-[#6b7280] whitespace-normal break-words leading-snug">{i.name}</span>
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
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-50 " +
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
  counts,
  cabinPanels,
  unmapped,
}: {
  list: R1ListView;
  categories: CategoryNode[];
  demand: R1Demand;
  counts: Record<string, number>;
  cabinPanels: R1CabinPanels;
  unmapped: R1UnmappedItem[];
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
  const [savingPart, setSavingPart] = useState<number | null>(null);
  const [savedPart, setSavedPart] = useState<number | null>(null);
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
  // "+ Add" / "+ Add hardware": clone a line right after it so the same
  // particular can carry multiple items (the Excel's {Add Multiple}).
  const addExtra = (pi: number, li: number) =>
    mut((d) => {
      const src = d[pi].lines[li];
      d[pi].lines.splice(li + 1, 0, {
        ...src,
        _k: nk(),
        id: nk(),
        template_line_id: null,
        item_id: null,
        item_code: null,
        item_name: null,
        uom: null,
        qty: 0,
        source: "manual",
      });
    });
  const addPart = () => {
    const t = newPart.trim();
    if (!t) return;
    setParts((p) => [...p, { title: t, lines: [] }]);
    setNewPart("");
    setDirty(true);
  };

  // Ad-hoc section: pick ANY inventory category (reuses CategoryPickerModal)
  // and add it as a new part with one category-scoped line ready to fill.
  const [showCatModal, setShowCatModal] = useState(false);
  const catIdByPath = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const m = new Map<string, string>();
    for (const c of categories) {
      const segs: string[] = [];
      let cur: CategoryNode | undefined = c;
      while (cur) {
        segs.unshift(cur.name);
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
      m.set(segs.join(" > "), c.id);
    }
    return m;
  }, [categories]);
  const addCategoryPart = (path: string, displayName: string) => {
    const catId = catIdByPath.get(path) ?? null;
    setParts((p) => [
      ...p,
      {
        title: displayName,
        lines: [
          {
            _k: nk(), id: nk(), part_title: displayName, template_line_id: null, kind: "category",
            category_id: catId, category_name: displayName, item_id: null, item_code: null, item_name: null,
            uom: null, label: displayName, spec: null, qty: 0, source: "manual", group: displayName, sort_order: 0,
          },
        ],
      },
    ]);
    setDirty(true);
    setShowCatModal(false);
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

  // Section save = persist the ENTIRE list (like Job Orders BOM). Clicking any
  // section's Save commits every section, so nothing filled elsewhere is lost;
  // the clicked section just shows the saving/saved indicator.
  const saveSection = (pi: number) => {
    if (savingPart !== null) return;
    setSavingPart(pi);
    setSavedPart(null);
    void (async () => {
      const r = await saveR1List(list.jobId, flat(), status);
      setSavingPart(null);
      if (r.ok) {
        setDirty(false);
        setSavedPart(pi);
        router.refresh();
        window.setTimeout(() => setSavedPart((cur) => (cur === pi ? null : cur)), 2000);
      } else alert(r.error ?? "Save failed");
    })();
  };

  // Cabin Job items (read-only mirror) — emitted under the Cabin part in exports.
  type ExportRow = {
    part: string; group: string; particular: string; code: string; item: string; qty: number | string; uom: string;
  };
  const cabinExportRows: ExportRow[] = cabinPanels.groups.flatMap((g): ExportRow[] =>
    g.lines.length
      ? g.lines.map((l) => ({ part: "Cabin", group: g.type, particular: "", code: l.code ?? "", item: l.name, qty: l.qty, uom: l.uom ?? "" }))
      : [{ part: "Cabin", group: g.type, particular: "", code: "", item: "", qty: "", uom: "" }],
  );
  const exportRows = parts.flatMap((p) => {
    const rows = p.lines.map((l) => ({
      part: p.title, group: l.group ?? "", particular: l.label ?? l.category_name ?? "",
      code: l.item_code ?? "", item: l.item_name ?? "", qty: l.qty as number | string, uom: l.uom ?? "",
    }));
    return p.title === "Cabin" ? [...cabinExportRows, ...rows] : rows;
  });
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
      // PDF lists ONLY packed items (positive qty) so it stays short — zero/empty
      // lines are dropped, and any part left with nothing is skipped below. The
      // Excel export (exportRows) is unaffected and still includes every line.
      const cabinBody =
        p.title === "Cabin"
          ? cabinPanels.groups.flatMap((g) =>
              g.lines
                .filter((l) => Number(l.qty) > 0)
                .map((l) => [g.type, "", l.code ?? "", l.name, String(l.qty)]),
            )
          : [];
      const lineBody = p.lines
        .filter((l) => Number(l.qty) > 0)
        .map((l) => [l.group ?? "", l.label ?? l.category_name ?? "", l.item_code ?? "", l.item_name ?? "", String(l.qty)]);
      const body = [...cabinBody, ...lineBody];
      if (body.length === 0) return;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`PART ${pi + 1}  ${p.title.toUpperCase()}`, 12, y);
      autoTable(doc, {
        startY: y + 2, theme: "grid", styles: { fontSize: 8, cellPadding: 1.2 },
        headStyles: { fillColor: [34, 51, 68] },
        head: [["Group", "Particular", "Code", "Item", "Qty"]],
        body,
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
    <div className="max-w-[920px] mx-auto">
      {/* Navy header + toolbar */}
      <header className="rounded-lg px-3.5 py-2 mb-2 flex items-center justify-between" style={{ background: C.navy, color: "#fff" }}>
        <div>
          <button onClick={() => router.push("/packing-list-r1")} className="text-[11px] opacity-80 hover:opacity-100">
            ← Packing Lists
          </button>
          <h1 className="text-[13px] font-semibold leading-tight">
            Packing List R1 · <span className="font-mono">{list.jobNumber ?? ""}</span>
          </h1>
          <p className="text-[10px] opacity-85 leading-tight">
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
      <div className="grid grid-cols-3 gap-2 mb-1">
        {[
          { l: "Demand items", v: demand.totals.items },
          { l: "Short of stock", v: demand.totals.shortfallItems, warn: demand.totals.shortfallItems > 0 },
          { l: "To buy (trade)", v: demand.trade.filter((r) => r.to_buy > 0).length },
        ].map((k) => (
          <div key={k.l} className="rounded-md border bg-white px-2.5 py-1.5 flex items-baseline justify-between" style={{ borderColor: C.line }}>
            <div className="text-[10px] uppercase tracking-wide text-[#6b7280]">{k.l}</div>
            <div className={"text-base font-semibold " + (k.warn ? "text-amber-600" : "")}>{k.v}</div>
          </div>
        ))}
      </div>
      {dirty && (
        <p className="text-[10px] text-amber-600 mb-2">Demand reflects the last saved state — Save to refresh.</p>
      )}

      {/* Parts */}
      <div className="mt-2 space-y-2">
        {parts.map((part, pi) => (
          <section key={part.title + pi} className="rounded-lg border bg-white overflow-hidden" style={{ borderColor: C.line }}>
            <h2 className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-semibold border-b" style={{ background: C.head, borderColor: C.line }}>
              <span className="rounded px-1 py-px text-[9px] tracking-wider text-white" style={{ background: C.navy }}>
                PART {pi + 1}
              </span>
              <span className="uppercase">{part.title}</span>
              <span className="ml-auto text-[10px] font-normal text-[#6b7280]">
                {part.lines.filter((l) => l.item_id).length}/{part.lines.length} filled
              </span>
              <button
                type="button"
                onClick={() => saveSection(pi)}
                disabled={savingPart !== null}
                title="Save just this section (other sections keep their last-saved state)"
                className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium hover:bg-[#f3f4f6] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderColor: C.line }}
              >
                {savingPart === pi ? (
                  <>
                    <Loader2 size={11} className="animate-spin" /> Saving…
                  </>
                ) : savedPart === pi ? (
                  <>
                    <CheckCircle2 size={11} className="text-emerald-600" /> Saved
                  </>
                ) : (
                  <>
                    <Save size={11} /> Save
                  </>
                )}
              </button>
            </h2>

            {part.title === "Cabin" && <CabinPanelsBlock data={cabinPanels} jobNumber={list.jobNumber} />}

            <div className="px-3 py-1.5">
              <table className="table-fixed w-full border-collapse text-xs">
                <colgroup>
                  <col style={{ width: "34%" }} />
                  <col style={{ width: "46%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "12%" }} />
                </colgroup>
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-[#9ca3af]">
                    <th className="font-medium pb-1">Particular</th>
                    <th className="font-medium pb-1">Item</th>
                    <th className="font-medium pb-1 text-right pr-2">Qty</th>
                    <th className="pb-1" />
                  </tr>
                </thead>
                <tbody>
                  {buckets(part.lines).map(([gname, glines]) => (
                    <Fragment key={gname}>
                      <tr>
                        <td colSpan={4} className="pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-[#6b7280]">
                          {gname}
                        </td>
                      </tr>
                      {glines.map(([li, l], gi) => {
                        const prev = gi > 0 ? glines[gi - 1][1] : null;
                        const isExtra =
                          !!prev && prev.label === l.label && prev.category_id === l.category_id && prev.kind === l.kind;
                        const canAdd = l.kind === "category" || l.kind === "hardware";
                        const pc = pickerCat(l);
                        return (
                          <tr key={l._k} className="border-b" style={{ borderColor: "#f1f5f9" }}>
                            <td className={"py-1 pr-2 align-top " + (isExtra ? "pl-4 font-normal text-[#6b7280]" : "font-medium")}>
                              {l.kind === "free" ? (
                                <input
                                  value={l.label ?? ""}
                                  onChange={(e) => setLine(pi, li, { label: e.target.value })}
                                  placeholder="free-text…"
                                  className="w-full rounded border px-2 py-1 text-xs"
                                  style={{ borderColor: C.line }}
                                />
                              ) : isExtra ? (
                                <span className="text-xs">↳ also</span>
                              ) : (
                                <span className="break-words">{l.label ?? l.category_name ?? "—"}</span>
                              )}
                              {!isExtra && l.kind === "hardware" && (
                                <span className="ml-1.5 text-[10px] italic" style={{ color: C.acc }}>+ Add hardware</span>
                              )}
                              {l.source === "auto" && <span className="ml-1.5 text-[10px] italic" style={{ color: C.acc }}>auto</span>}
                            </td>
                            <td className="py-1 px-2 align-top">
                              <div className="flex items-start gap-1.5">
                                <div className="flex-1 min-w-0">
                                  {l.item_id ? (
                                    <span className="inline-flex items-center flex-wrap gap-y-0.5">
                                      <span className="font-medium break-words">{l.item_name}</span>
                                      {l.item_code && <CodeChip code={l.item_code} />}
                                      {canAdd && (
                                        <button
                                          onClick={() => setLine(pi, li, { item_id: null, item_code: null, item_name: null, uom: null })}
                                          className="ml-1.5 text-[#6b7280] hover:text-red-600"
                                          title="clear"
                                        >
                                          ×
                                        </button>
                                      )}
                                    </span>
                                  ) : canAdd ? (
                                    <RichItemPicker
                                      categoryId={pc}
                                      placeholder={l.category_name ?? l.label ?? "category"}
                                      onPick={(i) => setLine(pi, li, { item_id: i.id, item_code: i.code, item_name: i.name, uom: i.uom, source: "manual" })}
                                    />
                                  ) : (
                                    <span className="text-xs text-[#6b7280]">—</span>
                                  )}
                                </div>
                                {canAdd && pc != null && (
                                  <span
                                    className={
                                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium " +
                                      ((counts[pc] ?? 0) === 0 ? "bg-red-100 text-red-700" : "bg-[#e0e7ff] text-[#3730a3]")
                                    }
                                    title="items available in this category"
                                  >
                                    {counts[pc] ?? 0}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-1 px-2 align-top">
                              <input
                                type="number"
                                min={0}
                                value={String(l.qty ?? 0)}
                                onChange={(e) => setLine(pi, li, { qty: Number(e.target.value) || 0 })}
                                placeholder="QTY"
                                className="w-full rounded border px-2 py-1 text-xs text-right"
                                style={{ borderColor: C.line }}
                              />
                            </td>
                            <td className="py-1 pl-1 align-top text-right whitespace-nowrap">
                              {canAdd && (
                                <button
                                  onClick={() => addExtra(pi, li)}
                                  className="mr-1 rounded border border-dashed px-1.5 py-0.5 text-[11px] font-semibold"
                                  style={{ borderColor: C.acc, color: C.acc }}
                                  title="add another item from this category"
                                >
                                  + Add
                                </button>
                              )}
                              <button onClick={() => delLine(pi, li)} className="p-1 rounded hover:bg-red-50 text-red-600" title="delete">
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 border-t border-dashed" style={{ borderColor: C.line }}>
              <GlobalItemPicker onPick={(i) => addItemLine(pi, i)} />
              <button onClick={() => addFreeLine(pi)} className="rounded-md border border-dashed px-2.5 py-1 text-xs" style={{ borderColor: C.acc, color: C.acc }}>
                + free line
              </button>
            </div>
          </section>
        ))}
      </div>

      {/* Add a part */}
      <div className="mt-2.5 flex items-center gap-2">
        <input
          value={newPart}
          onChange={(e) => setNewPart(e.target.value)}
          placeholder="New part…"
          className="w-44 rounded-md border px-2.5 py-1 text-xs"
          style={{ borderColor: C.line }}
          onKeyDown={(e) => e.key === "Enter" && addPart()}
        />
        <button onClick={addPart} disabled={!newPart.trim()} className="rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-50" style={{ borderColor: C.line }}>
          + Add Part
        </button>
        <button onClick={() => setShowCatModal(true)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: C.line }}>
          <FolderTree size={13} /> Add Section From Inventory
        </button>
      </div>

      {showCatModal && (
        <CategoryPickerModal
          existingPaths={[]}
          onPick={({ path, displayName }) => addCategoryPart(path, displayName)}
          onClose={() => setShowCatModal(false)}
        />
      )}

      {unmapped.length > 0 && (
        <div className="mt-5">
          <h2 className="text-sm font-semibold">
            Unmapped Items{" "}
            <span className="font-normal text-[#6b7280]">
              ({unmapped.length}) — on this job&apos;s BOM but not captured above
            </span>
          </h2>
          <div className="mt-1.5 rounded-lg border overflow-hidden" style={{ borderColor: C.line }}>
            <table className="w-full text-xs">
              <thead className="bg-[#f1f5f9] text-[#6b7280]">
                <tr>
                  <th className="text-left font-medium px-2 py-1">Code</th>
                  <th className="text-left font-medium px-2 py-1">Item</th>
                  <th className="text-left font-medium px-2 py-1">Category</th>
                  <th className="text-right font-medium px-2 py-1">BOM Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: C.line }}>
                {unmapped.map((u) => (
                  <tr key={u.item_id}>
                    <td className="px-2 py-1 font-mono">{u.code}</td>
                    <td className="px-2 py-1">{u.name}</td>
                    <td className="px-2 py-1 text-[#6b7280]">{u.category ?? "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {u.qty}
                      {u.uom ? ` ${u.uom}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-[#6b7280]">
            BOM items whose category isn&apos;t on the template (reflects the last saved list).
          </p>
        </div>
      )}

      <p className="text-[10px] text-center text-[#6b7280] my-4">
        Packing List R1 · seeded from the shared template + this job&apos;s BOM · pick an item per line, set QTY, Save.
      </p>
    </div>
  );
}

// Read-only cabin items mirrored from the job's Cabin Job — the 15 cabin-type
// headings, each with its items (or blank when the job has no Cabin Job).
function CabinPanelsBlock({ data, jobNumber }: { data: R1CabinPanels; jobNumber: string | null }) {
  const total = data.groups.reduce((s, g) => s + g.lines.length, 0);
  return (
    <div className="px-3 pt-1.5 pb-1 border-b" style={{ background: "#fafbfc", borderColor: C.line }}>
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#6b7280]">Cabin Panels</span>
        {data.hasCabinJob ? (
          <span className="text-[10px] text-[#6b7280]">
            from Cabin Job · {total} item{total === 1 ? "" : "s"} · read-only
          </span>
        ) : (
          <span className="text-[10px] text-amber-600">
            no Cabin Job for {jobNumber ?? "this job"} — add one in Cabin Jobs to fill these
          </span>
        )}
      </div>
      <table className="table-fixed w-full border-collapse text-xs">
        <colgroup>
          <col style={{ width: "34%" }} />
          <col style={{ width: "54%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <tbody>
          {data.groups.map((g) => (
            <Fragment key={g.type}>
              <tr>
                <td colSpan={3} className="pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-[#9ca3af]">
                  {g.type}
                </td>
              </tr>
              {g.lines.length === 0 ? (
                <tr className="border-b" style={{ borderColor: "#f1f5f9" }}>
                  <td className="py-1 pr-2 align-top text-[#cbd5e1]">—</td>
                  <td className="py-1 px-2 align-top italic text-[#cbd5e1]">blank</td>
                  <td className="py-1 px-2" />
                </tr>
              ) : (
                g.lines.map((l, i) => (
                  <tr key={i} className="border-b" style={{ borderColor: "#f1f5f9" }}>
                    <td className="py-1 pr-2" />
                    <td className="py-1 px-2 align-top">
                      <span className="font-medium text-[#374151]">{l.name}</span>
                      {l.code && <CodeChip code={l.code} />}
                    </td>
                    <td className="py-1 px-2 align-top text-right tabular-nums text-[#374151]">
                      {l.qty}
                      {l.uom ? ` ${l.uom}` : ""}
                    </td>
                  </tr>
                ))
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

