"use client";

import { useMemo, useState, useEffect, useRef, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Map as MapIcon,
  Search,
  Plus,
  FolderPlus,
  ChevronRight,
  CornerDownRight,
  Printer,
  X,
  MoveRight,
  PackageOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
  RotateCcw,
  SlidersHorizontal,
  AlertTriangle,
  Folder,
  Check,
  Cpu,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  moveItemsToCategory,
  createCategory,
  renameCategory,
  deleteCategory,
  bulkUpdateItems,
} from "@/lib/actions/inventory-atlas";
import { createItem } from "@/lib/actions/inventory";
import type { AtlasCat, AtlasItem, AtlasUnit, Proc } from "./page";

// Small worded "R1" pill — the tree's ONLY R1 signal (never a dot), so it can
// never be confused with the item-level dot in the list.
function R1Pill() {
  return (
    <span
      className="rounded px-1 py-px text-[10px] font-semibold leading-none bg-emerald-50 text-emerald-700 border border-emerald-200"
      title="On the R1 packing list"
    >
      R1
    </span>
  );
}

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "raw_material", label: "Raw material" },
  { value: "sub_assembly", label: "Sub-assembly" },
  { value: "finished_good", label: "Finished good" },
  { value: "mechanical_finished_stock", label: "Mechanical finished stock" },
  { value: "door_panel", label: "Door panel" },
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.map((t) => [t.value, t.label]),
);
const TYPE_ABBR: Record<string, string> = {
  raw_material: "RM",
  sub_assembly: "SA",
  finished_good: "FG",
  mechanical_finished_stock: "MFS",
  door_panel: "DP",
};

// One undone batch — items move back to wherever each came from.
type UndoEntry = { entries: { id: string; from: string }[]; targetName: string };

// Group items by their (exact) category id.
function groupByCat(items: AtlasItem[]): Map<string, AtlasItem[]> {
  const m = new Map<string, AtlasItem[]>();
  for (const it of items) {
    const arr = m.get(it.category_id) ?? [];
    arr.push(it);
    m.set(it.category_id, arr);
  }
  return m;
}

// Aggregate {total, r1} over each category's whole subtree.
function subtreeStats(
  byCat: Map<string, AtlasItem[]>,
  childrenByParent: Map<string | null, AtlasCat[]>,
  roots: AtlasCat[],
): Map<string, { total: number; r1: number }> {
  const out = new Map<string, { total: number; r1: number }>();
  const walk = (id: string): { total: number; r1: number } => {
    let total = 0,
      r1 = 0;
    for (const it of byCat.get(id) ?? []) {
      total++;
      if (it.in_r1) r1++;
    }
    for (const ch of childrenByParent.get(id) ?? []) {
      const s = walk(ch.id);
      total += s.total;
      r1 += s.r1;
    }
    out.set(id, { total, r1 });
    return { total, r1 };
  };
  for (const r of roots) walk(r.id);
  return out;
}

interface Props {
  categories: AtlasCat[];
  items: AtlasItem[];
  units: AtlasUnit[];
  /** Category ids referenced by any R1 line's category dropdown. */
  r1TouchedCats: string[];
}

export default function AtlasClient({
  categories: catProp,
  items: itemProp,
  units,
  r1TouchedCats,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  // Local mirrors of server state — kept in sync when props change after a
  // router.refresh(), so optimistic edits resolve to truth seamlessly.
  const [cats, setCats] = useState<AtlasCat[]>(catProp);
  const [items, setItems] = useState<AtlasItem[]>(itemProp);
  useEffect(() => setCats(catProp), [catProp]);
  useEffect(() => setItems(itemProp), [itemProp]);

  // Active lenses ("" = all). Both slice the tree counts + item list (ANDed).
  const [typeFilter, setTypeFilter] = useState("");
  const [procFilter, setProcFilter] = useState<"" | "make" | "trade" | "none">("");

  // ── Derived tree structures ─────────────────────────────────────────────
  const { byId, childrenByParent, roots } = useMemo(() => {
    const byId = new Map<string, AtlasCat>();
    const childrenByParent = new Map<string | null, AtlasCat[]>();
    for (const c of cats) {
      byId.set(c.id, c);
      const arr = childrenByParent.get(c.parent_id) ?? [];
      arr.push(c);
      childrenByParent.set(c.parent_id, arr);
    }
    for (const arr of childrenByParent.values())
      arr.sort((a, b) => a.name.localeCompare(b.name));
    const roots = childrenByParent.get(null) ?? [];
    return { byId, childrenByParent, roots };
  }, [cats]);

  // Per-type totals for the filter chips (always the full, unfiltered counts).
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.item_type, (m.get(it.item_type) ?? 0) + 1);
    return m;
  }, [items]);

  // Effective Make/Trade — matches mrp.ts EXACTLY: the item's own override, else
  // its DIRECT category's procurement_type. No walk to root (so items under a
  // null sub-category resolve to null even if the top-level is set). This keeps
  // Atlas counts identical to MRP / the inventory list.
  const effectiveProc = useCallback(
    (it: AtlasItem): Proc => it.procurement_type ?? (byId.get(it.category_id)?.procurement_type ?? null),
    [byId],
  );
  const procBucket = useCallback(
    (it: AtlasItem): "make" | "trade" | "none" => effectiveProc(it) ?? "none",
    [effectiveProc],
  );

  // Make/Trade chip totals (full, unfiltered).
  const procCounts = useMemo(() => {
    const m = { make: 0, trade: 0, none: 0 };
    for (const it of items) m[procBucket(it)]++;
    return m;
  }, [items, procBucket]);

  // Items visible under BOTH active lenses (Type AND Make/Trade). Flows into the
  // tree counts, the right pane, and search.
  const visibleItems = useMemo(
    () =>
      items.filter(
        (i) =>
          (!typeFilter || i.item_type === typeFilter) &&
          (!procFilter || procBucket(i) === procFilter),
      ),
    [items, typeFilter, procFilter, procBucket],
  );

  // itemsByCat / stats reflect the Type filter (drive the tree counts + right
  // pane). statsAll is unfiltered — used only for STABLE tree ordering so
  // categories don't reshuffle when you pick a type.
  const itemsByCatAll = useMemo(() => groupByCat(items), [items]);
  const itemsByCat = useMemo(() => groupByCat(visibleItems), [visibleItems]);
  const stats = useMemo(
    () => subtreeStats(itemsByCat, childrenByParent, roots),
    [itemsByCat, childrenByParent, roots],
  );
  const statsAll = useMemo(
    () => subtreeStats(itemsByCatAll, childrenByParent, roots),
    [itemsByCatAll, childrenByParent, roots],
  );

  // ── R1 "touched" model (type-independent) ─────────────────────────────────
  // A category is touched if R1 references it directly (its category dropdown)
  // OR any item filed under it is in R1. Rolled up the tree: per node we track
  // whether it's self-touched and how many of its descendant sub-categories
  // are touched.
  const r1CatSet = useMemo(() => new Set(r1TouchedCats), [r1TouchedCats]);
  const touch = useMemo(() => {
    const itemTouched = new Set<string>();
    for (const [catId, list] of itemsByCatAll)
      if (list.some((i) => i.in_r1)) itemTouched.add(catId);

    const out = new Map<
      string,
      { self: boolean; subTouched: number; subTotal: number; anyTouched: boolean }
    >();
    const walk = (id: string) => {
      const self = r1CatSet.has(id) || itemTouched.has(id);
      let subTouched = 0,
        subTotal = 0;
      for (const ch of childrenByParent.get(id) ?? []) {
        const c = walk(ch.id);
        subTotal += 1 + c.subTotal;
        subTouched += (c.self ? 1 : 0) + c.subTouched;
      }
      const rec = { self, subTouched, subTotal, anyTouched: self || subTouched > 0 };
      out.set(id, rec);
      return rec;
    };
    for (const r of roots) walk(r.id);
    return out;
  }, [itemsByCatAll, childrenByParent, roots, r1CatSet]);

  // Sub-categories (depth ≥ 1) touched, for the header rollup.
  const subTouchedTotal = useMemo(() => {
    let touched = 0,
      total = 0;
    for (const c of cats) {
      if (!c.parent_id) continue; // sub-categories only
      total++;
      if (touch.get(c.id)?.self) touched++;
    }
    return { touched, total };
  }, [cats, touch]);

  // Full path label for a category id ("Hardware › Bull Dog Clips").
  const pathLabel = useMemo(() => {
    const cache = new Map<string, string>();
    const build = (id: string): string => {
      if (cache.has(id)) return cache.get(id)!;
      const c = byId.get(id);
      if (!c) return "";
      const label = c.parent_id ? `${build(c.parent_id)} › ${c.name}` : c.name;
      cache.set(id, label);
      return label;
    };
    return build;
  }, [byId]);

  // Category options for dropdowns, ordered by path.
  const catOptions = useMemo(
    () =>
      cats
        .map((c) => ({ id: c.id, label: pathLabel(c.id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [cats, pathLabel],
  );

  // Roots sorted by (unfiltered) size — stable, so picking a Type doesn't
  // reshuffle the tree.
  const rootsBySize = useMemo(
    () => [...roots].sort((a, b) => (statsAll.get(b.id)?.total ?? 0) - (statsAll.get(a.id)?.total ?? 0)),
    [roots, statsAll],
  );

  // ── Selection / navigation state ─────────────────────────────────────────
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [dropCat, setDropCat] = useState<string | null>(null);
  const dragIds = useRef<string[]>([]);

  // Category-management state
  const [renamingCat, setRenamingCat] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // Inline Make/Trade editor popover (per item).
  const [procMenuFor, setProcMenuFor] = useState<string | null>(null);
  const [procMenuPos, setProcMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [deleteTarget, setDeleteTarget] = useState<AtlasCat | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);

  // Default to the biggest category on first load.
  useEffect(() => {
    if (!selectedCat && rootsBySize.length) {
      setSelectedCat(rootsBySize[0].id);
      setExpanded(new Set([rootsBySize[0].id]));
    }
  }, [rootsBySize, selectedCat]);

  // Items shown in the right pane: search across ALL when querying, else the
  // selected category's whole subtree.
  const subtreeItems = (id: string): AtlasItem[] => {
    const out: AtlasItem[] = [];
    const stack = [id];
    while (stack.length) {
      const c = stack.pop()!;
      out.push(...(itemsByCat.get(c) ?? []));
      for (const ch of childrenByParent.get(c) ?? []) stack.push(ch.id);
    }
    return out;
  };

  const q = search.trim().toLowerCase();
  const rightItems = useMemo(() => {
    let list: AtlasItem[];
    if (q) {
      // Search respects the Type filter too.
      const tokens = q.split(/\s+/);
      list = visibleItems.filter((it) => {
        const hay = `${it.code} ${it.name}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    } else {
      list = selectedCat ? subtreeItems(selectedCat) : [];
    }
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, visibleItems, selectedCat, itemsByCat, childrenByParent]);

  // Clear any selection when a lens changes (selected rows may hide).
  useEffect(() => setChecked(new Set()), [typeFilter, procFilter]);

  const shownIds = useMemo(() => rightItems.map((i) => i.id), [rightItems]);
  const allShownChecked = shownIds.length > 0 && shownIds.every((id) => checked.has(id));

  // ── Mutations ───────────────────────────────────────────────────────────
  // `recordUndo`: when true (a fresh user move), capture where each item came
  // from so it can be reverted. Undo itself passes false (no undo-of-undo).
  function doMove(ids: string[], targetId: string, recordUndo = true) {
    if (!ids.length || !targetId) return;
    const targetName = pathLabel(targetId);
    const fromById = new Map(items.map((i) => [i.id, i.category_id]));
    // Don't record items already in the target (no-op move).
    const before = ids
      .filter((id) => fromById.get(id) !== targetId)
      .map((id) => ({ id, from: fromById.get(id)! }));
    if (before.length === 0) return;
    const moveIds = before.map((b) => b.id);

    // Optimistic recategorise.
    setItems((prev) =>
      prev.map((it) => (moveIds.includes(it.id) ? { ...it, category_id: targetId } : it)),
    );
    setChecked(new Set());
    setMoveTarget("");
    startTransition(async () => {
      const r = await moveItemsToCategory(moveIds, targetId);
      if (!r.ok) {
        toast.error(r.error);
        router.refresh(); // revert to server truth
      } else {
        if (recordUndo)
          setUndoStack((s) => [...s.slice(-9), { entries: before, targetName }]);
        toast.success(`Moved ${r.moved} item${r.moved > 1 ? "s" : ""} → ${targetName}`);
        router.refresh();
      }
    });
  }

  function undoLastMove() {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setUndoStack((s) => s.slice(0, -1));
    // Items may have come from several source categories — revert per group.
    const bySource = new Map<string, string[]>();
    for (const e of entry.entries) {
      (bySource.get(e.from) ?? bySource.set(e.from, []).get(e.from)!).push(e.id);
    }
    // Optimistic revert.
    const target = new Map(entry.entries.map((e) => [e.id, e.from]));
    setItems((prev) =>
      prev.map((it) => (target.has(it.id) ? { ...it, category_id: target.get(it.id)! } : it)),
    );
    startTransition(async () => {
      const results = await Promise.all(
        [...bySource.entries()].map(([from, ids]) => moveItemsToCategory(ids, from)),
      );
      const failed = results.some((r) => !r.ok);
      if (failed) toast.error("Some items could not be reverted.");
      else toast.success(`Reverted ${entry.entries.length} item${entry.entries.length > 1 ? "s" : ""}`);
      router.refresh();
    });
  }

  function saveRename(cat: AtlasCat) {
    const clean = renameValue.trim();
    setRenamingCat(null);
    if (!clean || clean === cat.name) return;
    setCats((prev) => prev.map((c) => (c.id === cat.id ? { ...c, name: clean } : c)));
    startTransition(async () => {
      const r = await renameCategory(cat.id, clean);
      if (!r.ok) {
        toast.error(r.error);
        router.refresh();
      } else {
        toast.success(`Renamed to “${r.name}”`);
        router.refresh();
      }
    });
  }

  function requestDelete(cat: AtlasCat) {
    // Use statsAll (UNFILTERED active count), not stats — stats is lens-filtered,
    // so with a Type/Make-Trade filter active it could hide real active items and
    // the server would then refuse the delete with a contradictory message.
    const st = statsAll.get(cat.id) ?? { total: 0, r1: 0 };
    if (st.total > 0) {
      toast.error(
        `“${cat.name}” still has ${st.total} active item${st.total > 1 ? "s" : ""} in it (or its sub-categories). Move them out first.`,
      );
      return;
    }
    setDeleteTarget(cat);
  }

  function confirmDelete() {
    const cat = deleteTarget;
    if (!cat) return;
    setDeleteTarget(null);
    startTransition(async () => {
      const r = await deleteCategory(cat.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.itemsBlocking > 0) {
        toast.error(`“${cat.name}” still has ${r.itemsBlocking} active item(s). Move them out first.`);
        router.refresh();
        return;
      }
      const removed = new Set(r.deletedIds);
      setCats((prev) => prev.filter((c) => !removed.has(c.id)));
      if (selectedCat && removed.has(selectedCat)) setSelectedCat(null);
      const subNote =
        r.deletedIds.length > 1
          ? ` + ${r.deletedIds.length - 1} empty sub-categor${r.deletedIds.length - 1 > 1 ? "ies" : "y"}`
          : "";
      const inactiveNote =
        r.inactiveCleared > 0
          ? ` · uncategorised ${r.inactiveCleared} deleted item${r.inactiveCleared > 1 ? "s" : ""}`
          : "";
      toast.success(`Deleted “${cat.name}”${subNote}${inactiveNote}`);
      router.refresh();
    });
  }

  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatParent, setNewCatParent] = useState<string | null>(null);
  const [showNewItem, setShowNewItem] = useState(false);

  function toggleCheck(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleCheckAll() {
    setChecked((prev) => {
      if (allShownChecked) {
        const next = new Set(prev);
        shownIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...shownIds]);
    });
  }

  // Inline single-item Make/Trade change (value null = inherit from category).
  function setItemProc(id: string, value: Proc) {
    setProcMenuFor(null);
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, procurement_type: value } : it)),
    );
    startTransition(async () => {
      const r = await bulkUpdateItems([id], { procurement_type: value });
      if (!r.ok) {
        toast.error(r.error);
        router.refresh();
      } else {
        toast.success(
          value === null ? "Set to inherit from category" : `Set to ${value === "make" ? "Make" : "Trade"}`,
        );
        router.refresh();
      }
    });
  }

  // ── Tree rendering ────────────────────────────────────────────────────────
  function TreeNode({ cat, depth }: { cat: AtlasCat; depth: number }) {
    const children = childrenByParent.get(cat.id) ?? [];
    const hasChildren = children.length > 0;
    const isOpen = expanded.has(cat.id);
    const isSel = selectedCat === cat.id && !q;
    const st = stats.get(cat.id) ?? { total: 0, r1: 0 };
    const t = touch.get(cat.id) ?? { self: false, subTouched: 0, subTotal: 0, anyTouched: false };
    const isDrop = dropCat === cat.id;

    return (
      <div>
        <div
          onClick={() => {
            setSelectedCat(cat.id);
            setSearch("");
            // Selecting loads the category and reveals its children, but a row
            // click never COLLAPSES (that surprised people). Collapse is the
            // chevron's job.
            if (hasChildren && !isOpen)
              setExpanded((prev) => {
                const next = new Set(prev);
                next.add(cat.id);
                return next;
              });
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDropCat(cat.id);
          }}
          onDragLeave={() => setDropCat((d) => (d === cat.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            const ids = dragIds.current;
            setDropCat(null);
            if (ids.length) doMove(ids, cat.id);
          }}
          style={{ paddingLeft: 8 + depth * 14 }}
          className={cn(
            "group flex items-center gap-1.5 pr-2 py-1 rounded-md cursor-pointer text-[13px] transition-colors select-none",
            isSel
              ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-medium"
              : "hover:bg-[var(--muted)]",
            isDrop && "ring-2 ring-[var(--primary)] ring-inset bg-[var(--accent)]",
            (typeFilter || procFilter) && st.total === 0 && !isSel && "opacity-40",
          )}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((prev) => {
                  const next = new Set(prev);
                  next.has(cat.id) ? next.delete(cat.id) : next.add(cat.id);
                  return next;
                });
              }}
              className="shrink-0 w-4 flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
              aria-label={isOpen ? "Collapse" : "Expand"}
            >
              <ChevronRight
                size={13}
                className={cn("transition-transform", isOpen && "rotate-90")}
              />
            </button>
          ) : (
            <span className="shrink-0 w-4 flex items-center justify-center text-[var(--muted-foreground)]">
              {depth > 0 && <CornerDownRight size={12} className="opacity-40" />}
            </span>
          )}

          {renamingCat === cat.id ? (
            <input
              autoFocus
              value={renameValue}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => saveRename(cat)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename(cat);
                else if (e.key === "Escape") setRenamingCat(null);
              }}
              className="flex-1 min-w-0 h-6 px-1.5 rounded border border-[var(--primary)] bg-[var(--background)] text-[13px] focus:outline-none"
            />
          ) : (
            <>
              {depth === 0 && (
                <Folder size={13} className="shrink-0 text-[var(--muted-foreground)]" />
              )}
              <span className={cn("flex-1 truncate", depth === 0 && "font-medium")}>
                {cat.name}
              </span>
              {/* hover menu (rename / new sub / delete) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setMenuPos({ x: r.right, y: r.bottom });
                  setMenuFor((m) => (m === cat.id ? null : cat.id));
                }}
                className={cn(
                  "shrink-0 p-0.5 rounded hover:bg-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer transition-opacity",
                  menuFor === cat.id ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                aria-label="Category actions"
                title="Rename, add sub-category, delete"
              >
                <MoreHorizontal size={14} />
              </button>
              {/* R1 indicator — words, never a dot: an "R1" pill on a
                  sub-category that's on the R1 list; a plain n/m fraction on a
                  parent (no rainbow, no covColor). */}
              {hasChildren ? (
                <span
                  className="shrink-0 w-14 flex items-center justify-end gap-1"
                  title={`${t.subTouched} of ${t.subTotal} sub-categories on the R1 list`}
                >
                  {t.self && <R1Pill />}
                  <span
                    className={cn(
                      "text-[10px] tabular-nums",
                      t.subTouched === t.subTotal && t.subTotal > 0
                        ? "text-emerald-600 font-medium"
                        : "text-[var(--muted-foreground)]",
                    )}
                  >
                    {t.subTouched}/{t.subTotal}
                  </span>
                </span>
              ) : (
                <span className="shrink-0 w-14 flex items-center justify-end">
                  {t.self && <R1Pill />}
                </span>
              )}
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted-foreground)] w-7 text-right">
                {st.total.toLocaleString()}
              </span>
            </>
          )}
        </div>
        {hasChildren && isOpen && (
          <div>
            {children.map((ch) => (
              <TreeNode key={ch.id} cat={ch} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const selectedName = q
    ? `Search: "${search.trim()}"`
    : selectedCat
      ? pathLabel(selectedCat)
      : "Select a category";
  const selStat = selectedCat ? stats.get(selectedCat) : undefined;
  const selTouch = selectedCat ? touch.get(selectedCat) : undefined;
  const selHasChildren = selectedCat
    ? (childrenByParent.get(selectedCat)?.length ?? 0) > 0
    : false;

  return (
    <>
      <style>{`
        @media print {
          aside.atlas-tree, .atlas-toolbar, .no-print, button { display: none !important; }
          .atlas-panes { display: block !important; height: auto !important; }
          .atlas-items { height: auto !important; overflow: visible !important; }
          .item-row { break-inside: avoid; }
        }
      `}</style>

      <PageHeader
        title="Inventory Atlas"
        icon={<MapIcon size={18} />}
        meta={
          <span title="On the R1 list = referenced by the R1 packing list, via an item or a line's category.">
            {items.length.toLocaleString()} items · {rootsBySize.length} categories ·{" "}
            <span className="font-medium text-[var(--foreground)]">
              {subTouchedTotal.touched}/{subTouchedTotal.total}
            </span>{" "}
            sub-categories on the R1 list
          </span>
        }
        actions={
          <>
            {undoStack.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={undoLastMove}
                title={`Undo: ${undoStack[undoStack.length - 1].entries.length} item(s) → ${undoStack[undoStack.length - 1].targetName}`}
              >
                <RotateCcw size={15} className="mr-1.5" />
                Undo
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setNewCatParent(selectedCat);
                setShowNewCat(true);
              }}
            >
              <FolderPlus size={15} className="mr-1.5" />
              New Category
            </Button>
            <Button size="sm" onClick={() => setShowNewItem(true)}>
              <Plus size={15} className="mr-1.5" />
              New Item
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()} title="Print the current view">
              <Printer size={15} />
            </Button>
          </>
        }
      />

      {/* Type filter — compact segmented control; slices tree counts + list.
          (The old wordy legend is gone: the tree's "R1" pill, the list's "R1"
          column, and the plain n/m fraction are self-explanatory.) */}
      <div className="no-print flex flex-wrap items-center gap-1 mb-2">
        <span className="text-[10px] font-semibold text-[var(--muted-foreground)] mr-1 uppercase tracking-wide">
          Type
        </span>
        <TypeChip label="All" count={items.length} active={!typeFilter} onClick={() => setTypeFilter("")} />
        {TYPE_OPTIONS.map((t) => (
          <TypeChip
            key={t.value}
            label={TYPE_ABBR[t.value] ?? t.label}
            title={t.label}
            count={typeCounts.get(t.value) ?? 0}
            active={typeFilter === t.value}
            onClick={() => setTypeFilter(typeFilter === t.value ? "" : t.value)}
          />
        ))}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <MoveRight size={13} /> Tip: drag items onto a category, or use “Move to”.
        </span>
      </div>

      {/* Make/Trade filter — ANDs with the Type lens */}
      <div className="no-print flex flex-wrap items-center gap-1 mb-2">
        <span className="text-[10px] font-semibold text-[var(--muted-foreground)] mr-1 uppercase tracking-wide">
          Make / Trade
        </span>
        <TypeChip label="All" count={items.length} active={!procFilter} onClick={() => setProcFilter("")} />
        <TypeChip
          label="Make"
          count={procCounts.make}
          active={procFilter === "make"}
          onClick={() => setProcFilter(procFilter === "make" ? "" : "make")}
        />
        <TypeChip
          label="Trade"
          count={procCounts.trade}
          active={procFilter === "trade"}
          onClick={() => setProcFilter(procFilter === "trade" ? "" : "trade")}
        />
        <TypeChip
          label="Unset"
          title="No Make/Trade — neither the item nor its category is set"
          count={procCounts.none}
          active={procFilter === "none"}
          onClick={() => setProcFilter(procFilter === "none" ? "" : "none")}
        />
      </div>

      {/* Two-pane workbench */}
      <div className="atlas-panes flex gap-2" style={{ height: "calc(100vh - 204px)" }}>
        {/* LEFT: category tree */}
        <aside className="atlas-tree card-surface flex flex-col overflow-hidden shrink-0 w-[340px]">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)] bg-[var(--muted)]/30">
            <span className="text-[13px] font-semibold">Category › Sub-category</span>
            <span className="text-[11px] text-[var(--muted-foreground)]">
              {rootsBySize.length} · {cats.length - rootsBySize.length} sub
            </span>
          </div>
          <div className="overflow-y-auto flex-1 p-1.5">
            {rootsBySize.map((r) => (
              <TreeNode key={r.id} cat={r} depth={0} />
            ))}
          </div>
        </aside>

        {/* RIGHT: items in selected category / search */}
        <section className="card-surface flex flex-col overflow-hidden flex-1 min-w-0">
          {/* Pane header */}
          <div className="atlas-toolbar flex items-center gap-3 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--muted)]/30">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0 text-[13px]">
                {q ? (
                  <span className="font-semibold truncate">{selectedName}</span>
                ) : (
                  <Breadcrumb path={selectedName} />
                )}
                {!q && selectedCat && (
                  <Badge variant={byId.get(selectedCat)?.parent_id ? "neutral" : "blue"}>
                    {byId.get(selectedCat)?.parent_id ? "Sub-category" : "Category"}
                  </Badge>
                )}
                {typeFilter && (
                  <Badge variant="purple">{TYPE_LABEL[typeFilter]} only</Badge>
                )}
                {procFilter && (
                  <Badge variant={procFilter === "make" ? "blue" : procFilter === "trade" ? "amber" : "neutral"}>
                    {procFilter === "make" ? "Make" : procFilter === "trade" ? "Trade" : "Unset"} only
                  </Badge>
                )}
              </div>
              {selStat && !q && (
                <div className="text-[11px] text-[var(--muted-foreground)]">
                  {selStat.total.toLocaleString()} items
                  {selHasChildren
                    ? ` · ${selTouch?.subTouched ?? 0}/${selTouch?.subTotal ?? 0} sub-categories on R1`
                    : selTouch?.self
                      ? " · on R1"
                      : " · not on R1"}
                </div>
              )}
              {q && (
                <div className="text-[11px] text-[var(--muted-foreground)]">
                  {rightItems.length} match{rightItems.length === 1 ? "" : "es"}
                  {typeFilter ? ` in ${TYPE_LABEL[typeFilter]}` : " across all categories"}
                </div>
              )}
            </div>
            <div className="relative ml-auto w-64">
              <Search
                size={15}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none"
              />
              <Input
                size="sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search all items…"
                className="pl-8"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Column header */}
          {rightItems.length > 0 && (
            <div className="atlas-toolbar flex items-center gap-2 px-3 py-1 border-b border-[var(--border)] text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={allShownChecked}
                onChange={toggleCheckAll}
                className="cursor-pointer accent-[var(--primary)]"
                title="Select all shown"
              />
              <span className="w-5 text-center" title="On the R1 packing list">R1</span>
              <span className="w-24">Code</span>
              <span className="flex-1">Item</span>
              <span className="w-12 text-center">Type</span>
              <span className="w-7 text-center" title="Make / Trade — click a cell to change">M/T</span>
              <span className="w-12 text-right" title="On-hand stock">Stock</span>
              <span className="w-32 text-right pr-1">Category</span>
            </div>
          )}

          {/* Item list */}
          <div className="atlas-items overflow-y-auto flex-1">
            {rightItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-[var(--muted-foreground)] gap-2 py-16">
                <PackageOpen size={28} className="opacity-40" />
                <p className="text-sm">
                  {q
                    ? "No items match your search."
                    : typeFilter
                      ? `No ${TYPE_LABEL[typeFilter]} items here.`
                      : "No items in this category yet."}
                </p>
                {!q && selectedCat && (
                  <Button variant="secondary" size="sm" onClick={() => setShowNewItem(true)}>
                    <Plus size={14} className="mr-1.5" />
                    Add an item here
                  </Button>
                )}
              </div>
            ) : (
              rightItems.map((it) => {
                const isChecked = checked.has(it.id);
                return (
                  <div
                    key={it.id}
                    draggable
                    onDragStart={(e) => {
                      const ids = checked.has(it.id) ? [...checked] : [it.id];
                      dragIds.current = ids;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", ids.join(","));
                    }}
                    onDragEnd={() => (dragIds.current = [])}
                    onClick={() => toggleCheck(it.id)}
                    className={cn(
                      "item-row flex items-center gap-2 px-3 py-1 border-b border-[var(--border)] text-[13px] cursor-pointer transition-colors",
                      isChecked ? "bg-[var(--accent)]" : "hover:bg-[var(--muted)]/60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleCheck(it.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="cursor-pointer accent-[var(--primary)]"
                    />
                    <span
                      className="w-5 text-center text-emerald-500 leading-none"
                      title={it.in_r1 ? "On the R1 packing list" : ""}
                    >
                      {it.in_r1 ? "●" : ""}
                    </span>
                    <span className="w-24 shrink-0 font-mono text-[12px] text-[var(--foreground)] truncate">
                      {it.code}
                    </span>
                    <span className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="truncate" title={it.name}>
                        {it.name}
                      </span>
                      {it.programmed && (
                        <Badge
                          variant="green"
                          className="shrink-0 gap-0.5 px-1 py-0 text-[9px] leading-tight"
                          title="Produced by an audited program"
                        >
                          <Cpu size={9} /> Programmed
                        </Badge>
                      )}
                      {it.bom_item && (
                        <Badge
                          variant="green"
                          className="shrink-0 gap-0.5 px-1 py-0 text-[9px] leading-tight"
                          title="BOM item — selectable in a Packing List R1 part"
                        >
                          <Check size={9} /> BOM Item
                        </Badge>
                      )}
                    </span>
                    <span
                      className="w-12 shrink-0 text-center text-[10px] font-semibold text-[var(--muted-foreground)]"
                      title={TYPE_LABEL[it.item_type] ?? it.item_type}
                    >
                      {TYPE_ABBR[it.item_type] ?? "?"}
                    </span>
                    {/* Make/Trade — effective value, click to change */}
                    {(() => {
                      const eff = effectiveProc(it);
                      const overridden = it.procurement_type !== null;
                      const tip = `${eff ? (eff === "make" ? "Make" : "Trade") : "Unset"} · ${overridden ? "set on this item" : "inherited from category"} — click to change`;
                      return (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setProcMenuPos({ x: r.right, y: r.bottom });
                            setProcMenuFor((m) => (m === it.id ? null : it.id));
                          }}
                          className="w-7 shrink-0 flex items-center justify-center cursor-pointer"
                          title={tip}
                        >
                          {eff === "make" ? (
                            <Badge variant="blue" className={cn("text-[10px] px-1.5", !overridden && "opacity-60")}>M</Badge>
                          ) : eff === "trade" ? (
                            <Badge variant="amber" className={cn("text-[10px] px-1.5", !overridden && "opacity-60")}>T</Badge>
                          ) : (
                            <span className="text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">—</span>
                          )}
                        </button>
                      );
                    })()}
                    <span
                      className={cn(
                        "w-12 shrink-0 text-right text-[11px] tabular-nums pr-1",
                        it.stock > 0 ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
                      )}
                      title="On-hand stock"
                    >
                      {it.stock.toLocaleString()}
                    </span>
                    <span
                      className="w-32 shrink-0 text-right text-[11px] text-[var(--muted-foreground)] truncate pr-1"
                      title={pathLabel(it.category_id)}
                    >
                      {byId.get(it.category_id)?.name ?? "—"}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Selection action bar */}
          {checked.size > 0 && (
            <div className="no-print flex items-center gap-2 px-3 py-2 border-t border-[var(--border)] bg-[var(--background)] animate-slide-up">
              <Badge variant="blue">{checked.size} selected</Badge>
              <span className="text-[11px] text-[var(--muted-foreground)]">Move to</span>
              <Select
                size="sm"
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
                className="max-w-xs"
              >
                <option value="">Choose category…</option>
                {catOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={!moveTarget}
                onClick={() => doMove([...checked], moveTarget)}
              >
                <MoveRight size={15} className="mr-1.5" />
                Move
              </Button>
              <div className="w-px h-6 bg-[var(--border)] mx-1" />
              <Button variant="secondary" size="sm" onClick={() => setShowBulkEdit(true)}>
                <SlidersHorizontal size={15} className="mr-1.5" />
                Edit fields
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setChecked(new Set())}>
                Clear
              </Button>
            </div>
          )}
        </section>
      </div>

      {showNewCat && (
        <NewCategoryModal
          catOptions={catOptions}
          defaultParent={newCatParent}
          onClose={() => setShowNewCat(false)}
          onCreated={(c) => {
            setCats((prev) => [...prev, c]);
            setSelectedCat(c.id);
            if (c.parent_id) setExpanded((prev) => new Set([...prev, c.parent_id!]));
            setShowNewCat(false);
            router.refresh();
          }}
        />
      )}

      {showNewItem && (
        <NewItemModal
          units={units}
          catOptions={catOptions}
          defaultCat={selectedCat}
          onClose={() => setShowNewItem(false)}
          onCreated={(it) => {
            setItems((prev) => [...prev, it]);
            setShowNewItem(false);
            router.refresh();
          }}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          count={checked.size}
          units={units}
          onClose={() => setShowBulkEdit(false)}
          onApply={(patch) => {
            const ids = [...checked];
            // Optimistic: only item_type is visible in the table.
            if (patch.item_type !== undefined) {
              setItems((prev) =>
                prev.map((it) =>
                  ids.includes(it.id) ? { ...it, item_type: patch.item_type! } : it,
                ),
              );
            }
            setShowBulkEdit(false);
            setChecked(new Set());
            startTransition(async () => {
              const r = await bulkUpdateItems(ids, patch);
              if (!r.ok) toast.error(r.error);
              else toast.success(`Updated ${r.updated} item${r.updated > 1 ? "s" : ""}`);
              router.refresh();
            });
          }}
        />
      )}

      {/* Category action menu (rename / new sub / delete) */}
      {menuFor && byId.get(menuFor) && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
          <div
            className="fixed z-50 min-w-[184px] rounded-md border border-[var(--border)] bg-[var(--popover)] shadow-[var(--shadow-lg)] py-1 animate-scale-in"
            style={{ top: menuPos.y + 4, left: Math.max(8, menuPos.x - 184) }}
          >
            {(() => {
              const cat = byId.get(menuFor)!;
              const menuItem =
                "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left cursor-pointer hover:bg-[var(--muted)]";
              return (
                <>
                  <button
                    className={menuItem}
                    onClick={() => {
                      setRenameValue(cat.name);
                      setRenamingCat(cat.id);
                      setMenuFor(null);
                    }}
                  >
                    <Pencil size={14} /> Rename
                  </button>
                  <button
                    className={menuItem}
                    onClick={() => {
                      setNewCatParent(cat.id);
                      setShowNewCat(true);
                      setMenuFor(null);
                    }}
                  >
                    <FolderPlus size={14} /> New sub-category
                  </button>
                  <div className="my-1 border-t border-[var(--border)]" />
                  <button
                    className={cn(menuItem, "text-[var(--destructive)] hover:bg-[var(--destructive-bg)]")}
                    onClick={() => {
                      setMenuFor(null);
                      requestDelete(cat);
                    }}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* Inline Make/Trade editor (per item) */}
      {procMenuFor &&
        (() => {
          const it = items.find((x) => x.id === procMenuFor);
          if (!it) return null;
          const own = it.procurement_type; // explicit override (null = inherit)
          const catProc = byId.get(it.category_id)?.procurement_type ?? null;
          const inheritHint = catProc ? (catProc === "make" ? "Make" : "Trade") : "unset";
          const rows: { val: Proc; label: string }[] = [
            { val: "make", label: "Make" },
            { val: "trade", label: "Trade" },
            { val: null, label: `Inherit (→ ${inheritHint})` },
          ];
          const menuItem =
            "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-sm text-left cursor-pointer hover:bg-[var(--muted)]";
          return (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setProcMenuFor(null)} />
              <div
                className="fixed z-50 min-w-[184px] rounded-md border border-[var(--border)] bg-[var(--popover)] shadow-[var(--shadow-lg)] py-1 animate-scale-in"
                style={{ top: procMenuPos.y + 4, left: Math.max(8, procMenuPos.x - 184) }}
              >
                <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)] border-b border-[var(--border)] mb-1 truncate">
                  Make / Trade · {it.code}
                </div>
                {rows.map((r) => (
                  <button
                    key={r.label}
                    className={menuItem}
                    onClick={(e) => {
                      e.stopPropagation();
                      setItemProc(it.id, r.val);
                    }}
                  >
                    <span>{r.label}</span>
                    {own === r.val && <Check size={14} className="text-[var(--primary)]" />}
                  </button>
                ))}
              </div>
            </>
          );
        })()}

      {/* Delete confirmation */}
      {deleteTarget && (
        <Modal title="Delete category" onClose={() => setDeleteTarget(null)} size="sm">
          {(() => {
            const subs: AtlasCat[] = [];
            const queue = [deleteTarget.id];
            while (queue.length) {
              const c = queue.shift()!;
              for (const ch of childrenByParent.get(c) ?? []) {
                subs.push(ch);
                queue.push(ch.id);
              }
            }
            return (
              <div className="space-y-4">
                <div className="flex gap-3">
                  <AlertTriangle size={20} className="text-[var(--warning)] shrink-0 mt-0.5" />
                  <div className="text-sm">
                    Delete <strong>“{deleteTarget.name}”</strong>
                    {subs.length > 0 && (
                      <>
                        {" "}and its <strong>{subs.length}</strong> empty sub-categor
                        {subs.length > 1 ? "ies" : "y"}
                      </>
                    )}
                    ? It has no active items. Any soft-deleted (inactive) items
                    under it will simply be uncategorised. This can’t be undone.
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm" onClick={confirmDelete}>
                    <Trash2 size={15} className="mr-1.5" />
                    Delete
                  </Button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}
    </>
  );
}

// ── Type filter chip ──────────────────────────────────────────────────────────

function TypeChip({
  label,
  count,
  active,
  onClick,
  title,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium cursor-pointer transition-colors",
        active
          ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
          : "bg-[var(--background)] border-[var(--border)] hover:bg-[var(--muted)] hover:border-[var(--border-strong)]",
      )}
    >
      {label}
      <span className={cn("tabular-nums", active ? "opacity-80" : "text-[var(--muted-foreground)]")}>
        {count.toLocaleString()}
      </span>
    </button>
  );
}

// Path rendered as "A › B › C" with the last segment emphasised — the single
// clear "what am I looking at" statement in the right pane.
function Breadcrumb({ path }: { path: string }) {
  const segs = path.split("›").map((s) => s.trim()).filter(Boolean);
  if (segs.length <= 1) return <span className="font-semibold">{path}</span>;
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      {segs.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1 min-w-0">
          {i > 0 && <ChevronRight size={11} className="shrink-0 text-[var(--muted-foreground)]" />}
          <span className={cn("truncate", i === segs.length - 1 ? "font-semibold" : "text-[var(--muted-foreground)]")}>
            {s}
          </span>
        </span>
      ))}
    </span>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────

function NewCategoryModal({
  catOptions,
  defaultParent,
  onClose,
  onCreated,
}: {
  catOptions: { id: string; label: string }[];
  defaultParent: string | null;
  onClose: () => void;
  onCreated: (c: AtlasCat) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [parent, setParent] = useState(defaultParent ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const r = await createCategory(name, parent || null);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(`Category “${r.name}” created`);
    onCreated({ id: r.id, name: r.name, parent_id: r.parent_id, procurement_type: null });
  }

  return (
    <Modal title="New category" onClose={onClose} size="sm">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Door Hardware"
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Parent</label>
          <Select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— Top level —</option>
            {catOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">
            Make/Trade is inherited from the parent.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Creating…" : "Create category"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function NewItemModal({
  units,
  catOptions,
  defaultCat,
  onClose,
  onCreated,
}: {
  units: AtlasUnit[];
  catOptions: { id: string; label: string }[];
  defaultCat: string | null;
  onClose: () => void;
  onCreated: (it: AtlasItem) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState("sub_assembly");
  const [uom, setUom] = useState(units[0]?.id ?? "");
  const [cat, setCat] = useState(defaultCat ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || !cat || !uom) return;
    setSaving(true);
    const r = await createItem({
      code: code.trim(),
      name: name.trim(),
      item_type: type as any,
      category_id: cat,
      uom_id: uom,
      minimum_stock: 0,
      reorder_point: 0,
      lead_time_days: 0,
      cost_price: 0,
    });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(`Item “${name.trim()}” created (${r.code})`);
    onCreated({
      id: r.id,
      code: r.code ?? code.trim(),
      name: name.trim(),
      item_type: type,
      category_id: cat,
      in_r1: false,
      procurement_type: null,
      stock: 0,
      programmed: false,
      bom_item: false,
    });
  }

  return (
    <Modal title="New item" onClose={onClose} size="md">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item display name"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">
              Code <span className="text-[var(--muted-foreground)] font-normal">(optional)</span>
            </label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="auto-generated"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Unit</label>
            <Select value={uom} onChange={(e) => setUom(e.target.value)}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <Select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Choose…</option>
              {catOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          Stock levels and cost can be set later on the item’s detail page. Make/Trade
          is inherited from the category.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !name.trim() || !cat || !uom}>
            {saving ? "Creating…" : "Create item"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BulkEditModal({
  count,
  units,
  onClose,
  onApply,
}: {
  count: number;
  units: AtlasUnit[];
  onClose: () => void;
  onApply: (patch: {
    item_type?: string;
    procurement_type?: "make" | "trade" | null;
    uom_id?: string;
  }) => void;
}) {
  const [type, setType] = useState(""); // "" = leave unchanged
  const [proc, setProc] = useState(""); // "" | make | trade | inherit
  const [uom, setUom] = useState(""); // "" = leave unchanged
  const nothing = !type && !proc && !uom;

  function apply() {
    if (nothing) return;
    const patch: {
      item_type?: string;
      procurement_type?: "make" | "trade" | null;
      uom_id?: string;
    } = {};
    if (type) patch.item_type = type;
    if (uom) patch.uom_id = uom;
    if (proc) patch.procurement_type = proc === "inherit" ? null : (proc as "make" | "trade");
    onApply(patch);
  }

  const labelCls = "block text-sm font-medium mb-1";

  return (
    <Modal title={`Edit ${count} item${count > 1 ? "s" : ""}`} onClose={onClose} size="md">
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-foreground)]">
          Only the fields you set will change — leave the rest on “unchanged”. Applies to
          all {count} selected item{count > 1 ? "s" : ""}.
        </p>
        <div>
          <label className={labelCls}>Item type</label>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">— Leave unchanged —</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className={labelCls}>Make / Trade</label>
          <Select value={proc} onChange={(e) => setProc(e.target.value)}>
            <option value="">— Leave unchanged —</option>
            <option value="make">Make</option>
            <option value="trade">Trade</option>
            <option value="inherit">Inherit from category</option>
          </Select>
          {proc === "make" && (
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              Suppliers will be cleared (Make items have no suppliers).
            </p>
          )}
        </div>
        <div>
          <label className={labelCls}>Unit</label>
          <Select value={uom} onChange={(e) => setUom(e.target.value)}>
            <option value="">— Leave unchanged —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={apply} disabled={nothing}>
            Apply to {count} item{count > 1 ? "s" : ""}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
