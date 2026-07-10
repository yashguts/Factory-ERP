"use client";

import { Fragment, useRef, useState, useEffect, useMemo, useCallback, useTransition, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Save, FileText, CheckCircle2, RotateCcw, Trash2, FolderTree, Loader2, X, Copy } from "lucide-react";
import { CategoryPickerModal } from "@/components/jobs/category-picker-modal";
import {
  saveR1List,
  itemsInCategory,
  getR1CloneSources,
  cloneR1List,
  type R1ListView,
  type R1Line,
  type R1Demand,
  type R1UnmappedItem,
  type R1SaveLine,
  type R1CabinPanels,
  type R1CloneSource,
} from "@/lib/actions/packing-list-r1";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import { dismissUnmappedItem } from "@/lib/actions/packing-list-r1-unmapped";
import { syncR1ToBom, getR1JobPanel, setR1Audited, getR1DispatchView, type R1JobPanel } from "@/lib/actions/r1-bom-sync";
import { useOperator } from "@/lib/jobs/use-operator";
import { isStaleActionError } from "@/components/layout/stale-deploy-guard";
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

// Curated hardware quick-adds shown at the end of every section. `cat` MUST be
// the exact Hardware sub-category name (it drives the scoped item picker via
// hwCat); `display` is the button label.
const HW_TYPES: { display: string; cat: string }[] = [
  { display: "Stud Anchor", cat: "Stud Anchor" },
  { display: "Brick", cat: "Brick Dasfastner" },
  { display: "Screws", cat: "Screws" },
  { display: "Nut-Bolts", cat: "Nut-Bolts" },
  { display: "Bull Dog Clips", cat: "Bull Dog Clips" },
  { display: "Rag Bolt", cat: "Rag Bolt" },
  { display: "Rail Clip", cat: "Rail Clip" },
];

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
  // True when the section-scoped search found nothing and we broadened to a
  // global search (so the results shown are from other categories).
  const [broadened, setBroadened] = useState(false);
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
        let broadenedNow = false;
        try {
          let out: RichPick[] = [];
          if (allCats) {
            const r = await searchItems(query.trim(), undefined, 40);
            out = r.map((i) => ({ id: i.id, code: i.code, name: i.name, uom: i.uom_abbreviation ?? null }));
          } else if (categoryId) {
            const r = await itemsInCategory(categoryId, query);
            out = r.map((i) => ({ id: i.id, code: i.code, name: i.name, uom: i.uom ?? null }));
            // Nothing in this section's category — broaden to a global search so
            // a code/name that lives elsewhere (e.g. a Screw in Hardware) still
            // turns up instead of looking like "no results".
            if (out.length === 0 && query.trim().length >= 2) {
              const g = await searchItems(query.trim(), undefined, 40);
              out = g.map((i) => ({ id: i.id, code: i.code, name: i.name, uom: i.uom_abbreviation ?? null }));
              broadenedNow = out.length > 0;
            }
          }
          if (seq.current === s) {
            setRes(out);
            setBroadened(broadenedNow);
            setHi(0);
          }
        } catch (e) {
          // A stale tab's server-action call fails silently here — re-throw so
          // the global StaleDeployGuard catches it and prompts a reload instead
          // of the search just looking empty.
          if (isStaleActionError(e)) throw e;
          if (seq.current === s) {
            setRes([]);
            setBroadened(false);
          }
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
          {broadened && !allCats && (
            <div
              className="px-2 py-1 text-[10px] text-amber-700 bg-amber-50 border-b"
              style={{ borderColor: C.line }}
            >
              Not in this category — showing matches from all items
            </div>
          )}
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
  context = "r1",
}: {
  list: R1ListView;
  categories: CategoryNode[];
  demand: R1Demand;
  counts: Record<string, number>;
  cabinPanels: R1CabinPanels;
  unmapped: R1UnmappedItem[];
  /** "jobs" = rendered natively inside Job Orders (/jobs/[id]/items) — the
   *  back-link stays in the job's context. "r1" = the standalone section. */
  context?: "r1" | "jobs";
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
  // Job-side header: GAD drawing pointer + audit state (this list runs the job).
  const { operator, ensureOperator } = useOperator();
  const [jobPanel, setJobPanel] = useState<R1JobPanel | null>(null);
  // All-time dispatched qty per item — powers the per-line "sent · left" chip so
  // the list shows dispatch progress without changing the quantities themselves.
  const [sentByItem, setSentByItem] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    getR1JobPanel(list.jobId)
      .then((p) => {
        if (alive) setJobPanel(p);
      })
      .catch(() => {});
    getR1DispatchView(list.jobId)
      .then((v) => {
        if (alive) setSentByItem(v.dispatchedByItem);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [list.jobId]);
  // Unmapped items — local optimistic copy: a cross-off disappears INSTANTLY
  // and the server work (line cleanup + snapshot + cache revalidation) runs in
  // the background. The row only comes back if the server refuses.
  const [umRows, setUmRows] = useState(unmapped);
  useEffect(() => setUmRows(unmapped), [unmapped]);
  const dismissUm = (u: R1UnmappedItem) => {
    setUmRows((rows) => rows.filter((r) => r.item_id !== u.item_id));
    dismissUnmappedItem(list.jobId, u.item_id)
      .then((res) => {
        if (!res.ok) {
          setUmRows((rows) => [...rows, u]);
          alert(`Could not cross off ${u.code}: ${res.error}`);
        }
      })
      .catch(() => {
        setUmRows((rows) => [...rows, u]);
        alert(`Could not cross off ${u.code} — network error. Try again.`);
      });
  };

  const toggleAudited = () => {
    const name = operator ?? ensureOperator();
    startTransition(async () => {
      const next = !jobPanel?.auditedAt;
      const r = await setR1Audited(list.jobId, next, name ?? undefined);
      if (r.ok) {
        setJobPanel((p) =>
          p ? { ...p, auditedAt: next ? new Date().toISOString() : null, auditedBy: next ? (name ?? null) : null } : p,
        );
        router.refresh();
      } else alert(r.error);
    });
  };
  const [newPart, setNewPart] = useState("");

  const hw = categories.find((c) => c.name === "Hardware" && c.parent_id === null);
  // Every Hardware sub-category name → its id, so any hardware line (the
  // quick-add buttons below, or existing template hardware lines) resolves to
  // its scoped item picker.
  const hwCat: Record<string, string | null> = {};
  for (const c of categories) if (hw && c.parent_id === hw.id) hwCat[c.name] = c.id;

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
  // Hardware quick-add: append a hardware line scoped to a Hardware sub-category.
  // The user then picks the exact item + qty in the line's scoped picker
  // (pickerCat resolves hwCat[label]).
  const addHardwareLine = (pi: number, catName: string) =>
    mut((d) => {
      d[pi].lines.push({
        _k: nk(), id: nk(), part_title: d[pi].title, template_line_id: null, kind: "hardware",
        category_id: null, category_name: catName, item_id: null, item_code: null, item_name: null,
        uom: null, label: catName, spec: null, qty: 1, source: "manual", group: "Hardware",
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
        // This list IS the job's BOM now — mirror it into job_bom_lines so
        // MRP / dispatch / the job page see the same items immediately.
        const sync = await syncR1ToBom(list.jobId);
        if (!sync.ok) alert(`Saved, but updating the job's item data failed: ${sync.error}`);
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
      if (r.ok) {
        // Mirror into job_bom_lines (see save() above).
        const sync = await syncR1ToBom(list.jobId);
        if (!sync.ok) alert(`Saved, but updating the job's item data failed: ${sync.error}`);
      }
      setSavingPart(null);
      if (r.ok) {
        setDirty(false);
        setSavedPart(pi);
        router.refresh();
        window.setTimeout(() => setSavedPart((cur) => (cur === pi ? null : cur)), 2000);
      } else alert(r.error ?? "Save failed");
    })();
  };

  // Clone from another job — copy an already-filled identical job's whole list.
  const [showClone, setShowClone] = useState(false);
  const [cloneSources, setCloneSources] = useState<R1CloneSource[]>([]);
  const [cloneLoading, setCloneLoading] = useState(false);
  const [cloneQuery, setCloneQuery] = useState("");
  const [cloning, setCloning] = useState(false);
  const openClone = () => {
    setShowClone(true);
    setCloneQuery("");
    setCloneLoading(true);
    getR1CloneSources(list.jobId)
      .then((rows) => setCloneSources(rows))
      .catch(() => setCloneSources([]))
      .finally(() => setCloneLoading(false));
  };
  const filteredSources = useMemo(() => {
    const toks = cloneQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return cloneSources;
    return cloneSources.filter((s) => {
      const hay = `${s.jobNumber ?? ""} ${s.customerName ?? ""}`.toLowerCase();
      return toks.every((t) => hay.includes(t));
    });
  }, [cloneSources, cloneQuery]);
  const doClone = (s: R1CloneSource) => {
    if (
      !window.confirm(
        `Replace ${list.jobNumber ?? "this job"}'s packing list with a copy of ${s.jobNumber ?? "the selected job"}?\n\nThis overwrites the current list. The copy lands as DRAFT for you to review, then Mark Final.`,
      )
    )
      return;
    setCloning(true);
    startTransition(async () => {
      const res = await cloneR1List(list.jobId, s.jobId);
      if (!res.ok) {
        setCloning(false);
        alert(res.error ?? "Clone failed");
        return;
      }
      // Swap the builder's local state to the cloned list in one shot — a bare
      // router.refresh() wouldn't re-seed the parts useState.
      setParts(res.list.parts.map((p) => ({ title: p.title, lines: p.lines.map((l) => ({ ...l, _k: l.id })) })));
      setStatus("draft");
      setDirty(false);
      // Mirror into job_bom_lines like save() does, so MRP / dispatch see it.
      const sync = await syncR1ToBom(list.jobId);
      if (!sync.ok) alert(`Cloned, but updating the job's item data failed: ${sync.error}`);
      setCloning(false);
      setShowClone(false);
      router.refresh();
    });
  };

  // "PDF Export" opens the SCRATCH print tab: everything there (section/item
  // selection, quantities) is temporary and never writes back to the job.
  // Confirming the print saves a snapshot (packing_r1_prints) that dispatches
  // are cross-checked against for 72 hours. Live data changes only through
  // Mark Dispatched on the job page.
  const openPrintTab = () => {
    window.open(`/print/packing-list/${list.jobId}`, "_blank");
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
          {context === "jobs" ? (
            <button
              onClick={() => router.push(`/jobs/${list.jobId}`)}
              className="text-[11px] opacity-80 hover:opacity-100"
              title="Back to the job — status, dispatch, drawing, alerts"
            >
              ← Job {list.jobNumber ?? ""}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => router.push("/packing-list-r1")} className="text-[11px] opacity-80 hover:opacity-100">
                ← Packing Lists
              </button>
              <span className="text-[11px] opacity-40">|</span>
              <button
                onClick={() => router.push(`/jobs/${list.jobId}`)}
                className="text-[11px] opacity-80 hover:opacity-100"
                title="Status, dispatch, drawing and alerts for this job"
              >
                Job page →
              </button>
            </div>
          )}
          <h1 className="text-[13px] font-semibold leading-tight">
            Packing List R1 · <span className="font-mono">{list.jobNumber ?? ""}</span>
          </h1>
          <p className="text-[10px] opacity-85 leading-tight">
            {status}
            {jobPanel?.auditedAt ? ` • audited${jobPanel.auditedBy ? ` by ${jobPanel.auditedBy}` : ""}` : ""}
            {dirty ? " • unsaved" : ""} · {filled}/{totalLines} lines filled · this list is the job&apos;s item data
          </p>
        </div>
        <div className="flex items-center gap-2">
          {jobPanel?.gadUrl && (
            <ToolbarBtn onClick={() => window.open(jobPanel.gadUrl!, "_blank", "noopener")}>
              <FileText size={14} /> Drawing
            </ToolbarBtn>
          )}
          <ToolbarBtn onClick={toggleAudited} disabled={pending}>
            <CheckCircle2 size={14} /> {jobPanel?.auditedAt ? "Un-audit" : "Mark Audited"}
          </ToolbarBtn>
          <ToolbarBtn onClick={openClone} disabled={pending || cloning}>
            <Copy size={14} /> Clone from job
          </ToolbarBtn>
          <ToolbarBtn onClick={openPrintTab}>
            <FileText size={14} /> PDF Export
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
                              {(() => {
                                // The QTY box shows what's LEFT TO SEND (owner rule:
                                // a fully-dispatched item reads 0, not its total —
                                // non-zero counts on sent items confuse the floor).
                                // Storage stays the TOTAL (qty = left + sent), which
                                // is what mirrors to the job/MRP; editing the box
                                // means "this much still to send".
                                const sent = l.item_id ? (sentByItem[l.item_id] ?? 0) : 0;
                                const total = Number(l.qty) || 0;
                                const left = sent > 0 ? Math.max(0, total - sent) : total;
                                return (
                                  <>
                                    <input
                                      type="number"
                                      min={0}
                                      value={String(left)}
                                      onChange={(e) => {
                                        const v = Number(e.target.value) || 0;
                                        setLine(pi, li, { qty: sent > 0 ? v + sent : v });
                                      }}
                                      placeholder="QTY"
                                      title={sent > 0 ? `Still to send. ${sent} sent earlier — total required ${total}` : undefined}
                                      className="w-full rounded border px-2 py-1 text-xs text-right"
                                      style={{ borderColor: C.line }}
                                    />
                                    {sent > 0 && (
                                      <div
                                        className={
                                          "mt-0.5 text-right text-[9px] leading-tight whitespace-nowrap " +
                                          (left === 0 ? "text-emerald-600" : "text-amber-600")
                                        }
                                        title={`Dispatched so far (from the job's dispatch records) — total required ${total}`}
                                      >
                                        sent {sent} earlier · total {total}
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
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

            {/* Hardware quick-adds — same set at the end of every section */}
            <div
              className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-t border-dashed"
              style={{ borderColor: C.line }}
            >
              <span className="text-[11px] font-semibold" style={{ color: C.mut }}>
                Hardware:
              </span>
              {HW_TYPES.map((t) => {
                const ok = !!hwCat[t.cat];
                return (
                  <button
                    key={t.cat}
                    onClick={() => addHardwareLine(pi, t.cat)}
                    disabled={!ok}
                    title={ok ? `Add a ${t.display} line` : `“${t.cat}” category not found`}
                    className="rounded-md border px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
                    style={{ borderColor: C.acc, color: C.acc }}
                  >
                    + {t.display}
                  </button>
                );
              })}
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

      {showClone && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]"
          onClick={() => !cloning && setShowClone(false)}
        >
          <div
            className="w-full max-w-lg rounded-lg bg-white shadow-xl"
            style={{ border: `1px solid ${C.line}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: C.line }}>
              <h3 className="text-sm font-semibold">Clone packing list from another job</h3>
              <button
                onClick={() => !cloning && setShowClone(false)}
                className="text-[#6b7280] hover:text-black disabled:opacity-40"
                disabled={cloning}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-3">
              <p className="mb-2 text-[11px] text-[#6b7280]">
                Copies every line from the chosen job into{" "}
                <b className="font-mono">{list.jobNumber ?? "this job"}</b>, replacing its current list. The copy
                lands as <b>draft</b> — review it, then Mark Final.
              </p>
              <input
                autoFocus
                placeholder="Search job # or customer…"
                value={cloneQuery}
                onChange={(e) => setCloneQuery(e.target.value)}
                className="mb-2 w-full rounded border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/30"
                style={{ borderColor: C.line }}
              />
              <div className="max-h-[46vh] overflow-y-auto rounded border" style={{ borderColor: C.line }}>
                {cloneLoading ? (
                  <div className="p-4 text-center text-xs text-[#6b7280]">
                    <Loader2 size={14} className="mr-1 inline animate-spin" /> Loading…
                  </div>
                ) : filteredSources.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#6b7280]">
                    {cloneSources.length === 0
                      ? "No other job has a filled-in packing list yet."
                      : "No job matches your search."}
                  </div>
                ) : (
                  filteredSources.map((s) => (
                    <button
                      key={s.jobId}
                      type="button"
                      disabled={cloning}
                      onClick={() => doClone(s)}
                      className="flex w-full items-center gap-2 border-b px-3 py-2 text-left last:border-b-0 hover:bg-[#f3f4f6] disabled:opacity-50"
                      style={{ borderColor: C.line }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[13px] font-medium">{s.jobNumber ?? "—"}</div>
                        <div className="truncate text-[11px] text-[#6b7280]">{s.customerName ?? "—"}</div>
                      </div>
                      <span
                        className={
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                          (s.status === "final" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")
                        }
                      >
                        {s.status}
                      </span>
                      <span className="w-16 text-right text-[11px] tabular-nums text-[#6b7280]">
                        {s.filledLines} items
                      </span>
                    </button>
                  ))
                )}
              </div>
              {cloning && (
                <p className="mt-2 text-[11px] text-[#2563eb]">
                  <Loader2 size={12} className="mr-1 inline animate-spin" /> Cloning…
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {umRows.length > 0 && (
        <div className="mt-5">
          <h2 className="text-sm font-semibold">
            Unmapped Items{" "}
            <span className="font-normal text-[#6b7280]">
              ({umRows.length}) — on this job&apos;s BOM but not captured above
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
                  <th className="px-2 py-1 w-8" title="Cross off carry-overs you don't want on R1"></th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: C.line }}>
                {umRows.map((u) => (
                  <tr key={u.item_id}>
                    <td className="px-2 py-1 font-mono">{u.code}</td>
                    <td className="px-2 py-1">{u.name}</td>
                    <td className="px-2 py-1 text-[#6b7280]">{u.category ?? "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {u.qty}
                      {u.uom ? ` ${u.uom}` : ""}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => dismissUm(u)}
                        title="Cross off — this job doesn't need this item; its demand is removed (recoverable)."
                        className="inline-flex items-center justify-center rounded p-0.5 text-[#9ca3af] hover:text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-[#6b7280]">
            BOM items whose category isn&apos;t on the template (reflects the last saved list).
            Cross one off (✕) to hide a carry-over you don&apos;t need — it only hides the reminder, never changes the BOM.
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

