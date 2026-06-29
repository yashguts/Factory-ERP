"use client";

import { useMemo, useState, useEffect, useRef, useTransition } from "react";
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
  Layers,
  PackageOpen,
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
} from "@/lib/actions/inventory-atlas";
import { createItem } from "@/lib/actions/inventory";
import type { AtlasCat, AtlasItem, AtlasUnit } from "./page";

// ── Coverage tiers (light-theme palette) ──────────────────────────────────────
function covColor(pct: number) {
  if (pct === 0) return "#94a3b8"; // slate-400
  if (pct < 20) return "#ef4444"; // red-500
  if (pct < 40) return "#f97316"; // orange-500
  if (pct < 60) return "#eab308"; // yellow-500
  if (pct < 80) return "#3b82f6"; // blue-500
  return "#22c55e"; // green-500
}
function covLabel(pct: number) {
  if (pct === 0) return "Unmapped";
  if (pct < 20) return "Sparse";
  if (pct < 40) return "Partial";
  if (pct < 60) return "Moderate";
  if (pct < 80) return "Good";
  return "Excellent";
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

interface Props {
  categories: AtlasCat[];
  items: AtlasItem[];
  units: AtlasUnit[];
}

export default function AtlasClient({ categories: catProp, items: itemProp, units }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  // Local mirrors of server state — kept in sync when props change after a
  // router.refresh(), so optimistic edits resolve to truth seamlessly.
  const [cats, setCats] = useState<AtlasCat[]>(catProp);
  const [items, setItems] = useState<AtlasItem[]>(itemProp);
  useEffect(() => setCats(catProp), [catProp]);
  useEffect(() => setItems(itemProp), [itemProp]);

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

  const itemsByCat = useMemo(() => {
    const m = new Map<string, AtlasItem[]>();
    for (const it of items) {
      const arr = m.get(it.category_id) ?? [];
      arr.push(it);
      m.set(it.category_id, arr);
    }
    return m;
  }, [items]);

  // Subtree {total, r1} aggregated per category id.
  const stats = useMemo(() => {
    const out = new Map<string, { total: number; r1: number }>();
    const walk = (id: string): { total: number; r1: number } => {
      let total = 0,
        r1 = 0;
      for (const it of itemsByCat.get(id) ?? []) {
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
  }, [itemsByCat, childrenByParent, roots]);

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

  // Roots sorted by size for default selection / display.
  const rootsBySize = useMemo(
    () => [...roots].sort((a, b) => (stats.get(b.id)?.total ?? 0) - (stats.get(a.id)?.total ?? 0)),
    [roots, stats],
  );

  // ── Selection / navigation state ─────────────────────────────────────────
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [dropCat, setDropCat] = useState<string | null>(null);
  const dragIds = useRef<string[]>([]);

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
      const tokens = q.split(/\s+/);
      list = items.filter((it) => {
        const hay = `${it.code} ${it.name}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    } else {
      list = selectedCat ? subtreeItems(selectedCat) : [];
    }
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, items, selectedCat, itemsByCat, childrenByParent]);

  const shownIds = useMemo(() => rightItems.map((i) => i.id), [rightItems]);
  const allShownChecked = shownIds.length > 0 && shownIds.every((id) => checked.has(id));

  // ── Mutations ───────────────────────────────────────────────────────────
  function doMove(ids: string[], targetId: string) {
    if (!ids.length || !targetId) return;
    const targetName = pathLabel(targetId);
    // Optimistic recategorise.
    setItems((prev) =>
      prev.map((it) => (ids.includes(it.id) ? { ...it, category_id: targetId } : it)),
    );
    setChecked(new Set());
    setMoveTarget("");
    startTransition(async () => {
      const r = await moveItemsToCategory(ids, targetId);
      if (!r.ok) {
        toast.error(r.error);
        router.refresh(); // revert to server truth
      } else {
        toast.success(`Moved ${r.moved} item${r.moved > 1 ? "s" : ""} → ${targetName}`);
        router.refresh();
      }
    });
  }

  const [showNewCat, setShowNewCat] = useState(false);
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

  // ── Tree rendering ────────────────────────────────────────────────────────
  function TreeNode({ cat, depth }: { cat: AtlasCat; depth: number }) {
    const children = childrenByParent.get(cat.id) ?? [];
    const hasChildren = children.length > 0;
    const isOpen = expanded.has(cat.id);
    const isSel = selectedCat === cat.id && !q;
    const st = stats.get(cat.id) ?? { total: 0, r1: 0 };
    const pct = st.total > 0 ? Math.round((st.r1 * 100) / st.total) : 0;
    const isDrop = dropCat === cat.id;

    return (
      <div>
        <div
          onClick={() => {
            setSelectedCat(cat.id);
            setSearch("");
            if (hasChildren)
              setExpanded((prev) => {
                const next = new Set(prev);
                next.has(cat.id) ? next.delete(cat.id) : next.add(cat.id);
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
            "group flex items-center gap-1.5 pr-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors select-none",
            isSel
              ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-medium"
              : "hover:bg-[var(--muted)]",
            isDrop && "ring-2 ring-[var(--primary)] ring-inset bg-[var(--accent)]",
          )}
        >
          <span className="shrink-0 w-4 flex items-center justify-center text-[var(--muted-foreground)]">
            {hasChildren ? (
              <ChevronRight
                size={14}
                className={cn("transition-transform", isOpen && "rotate-90")}
              />
            ) : (
              depth > 0 && <CornerDownRight size={12} className="opacity-40" />
            )}
          </span>
          <span className="flex-1 truncate">{cat.name}</span>
          {/* coverage mini-bar */}
          <span
            className="shrink-0 w-9 h-1.5 rounded-full overflow-hidden bg-[var(--muted)]"
            title={`${st.r1}/${st.total} in R1 — ${pct}% (${covLabel(pct)})`}
          >
            <span
              className="block h-full rounded-full"
              style={{ width: `${pct}%`, background: covColor(pct) }}
            />
          </span>
          <span className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)] w-9 text-right">
            {st.total.toLocaleString()}
          </span>
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

  const totalR1 = useMemo(() => items.filter((i) => i.in_r1).length, [items]);
  const overallPct = items.length ? Math.round((totalR1 * 100) / items.length) : 0;

  const selectedName = q
    ? `Search: "${search.trim()}"`
    : selectedCat
      ? pathLabel(selectedCat)
      : "Select a category";
  const selStat = selectedCat ? stats.get(selectedCat) : undefined;

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
          <>
            {items.length.toLocaleString()} items · {rootsBySize.length} categories ·{" "}
            <span style={{ color: covColor(overallPct), fontWeight: 600 }}>
              {totalR1} in R1 ({overallPct}%)
            </span>
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowNewCat(true)}>
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

      {/* Legend */}
      <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-xs text-[var(--muted-foreground)]">
        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--foreground)]">
          <Layers size={13} /> R1 coverage
        </span>
        {[0, 10, 30, 50, 70, 90].map((p) => (
          <span key={p} className="inline-flex items-center gap-1">
            <span style={{ background: covColor(p), width: 8, height: 8, borderRadius: 9999, display: "inline-block" }} />
            {covLabel(p)}
          </span>
        ))}
        <span className="ml-2 inline-flex items-center gap-1">
          <span className="text-emerald-500 font-bold">●</span> in R1
          <span className="text-slate-300 font-bold ml-2">○</span> not in R1
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
          <MoveRight size={13} /> Tip: drag selected items onto a category, or use “Move to”.
        </span>
      </div>

      {/* Two-pane workbench */}
      <div className="atlas-panes flex gap-3" style={{ height: "calc(100vh - 168px)" }}>
        {/* LEFT: category tree */}
        <aside className="atlas-tree card-surface flex flex-col overflow-hidden shrink-0 w-[340px]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/30">
            <span className="text-sm font-semibold">Categories</span>
            <span className="text-xs text-[var(--muted-foreground)]">{rootsBySize.length} top-level</span>
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
          <div className="atlas-toolbar flex items-center gap-3 px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/30">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{selectedName}</div>
              {selStat && !q && (
                <div className="text-xs text-[var(--muted-foreground)]">
                  {selStat.total.toLocaleString()} items · {selStat.r1} in R1 ·{" "}
                  {selStat.total ? Math.round((selStat.r1 * 100) / selStat.total) : 0}%
                </div>
              )}
              {q && (
                <div className="text-xs text-[var(--muted-foreground)]">
                  {rightItems.length} match{rightItems.length === 1 ? "" : "es"} across all categories
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
            <div className="atlas-toolbar flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={allShownChecked}
                onChange={toggleCheckAll}
                className="cursor-pointer accent-[var(--primary)]"
                title="Select all shown"
              />
              <span className="w-5 text-center">R1</span>
              <span className="w-28">Code</span>
              <span className="flex-1">Item</span>
              <span className="w-56 text-right pr-1">Category</span>
            </div>
          )}

          {/* Item list */}
          <div className="atlas-items overflow-y-auto flex-1">
            {rightItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-[var(--muted-foreground)] gap-2 py-16">
                <PackageOpen size={28} className="opacity-40" />
                <p className="text-sm">
                  {q ? "No items match your search." : "No items in this category yet."}
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
                      "item-row flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] text-sm cursor-pointer transition-colors",
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
                      className={cn(
                        "w-5 text-center font-bold leading-none",
                        it.in_r1 ? "text-emerald-500" : "text-slate-300",
                      )}
                      title={it.in_r1 ? "In R1 packing list" : "Not in R1"}
                    >
                      {it.in_r1 ? "●" : "○"}
                    </span>
                    <span className="w-28 shrink-0 font-mono text-xs text-[var(--muted-foreground)] truncate">
                      {it.code}
                    </span>
                    <span className="flex-1 truncate" title={it.name}>
                      {it.name}
                    </span>
                    <span
                      className="w-56 shrink-0 text-right text-xs text-[var(--muted-foreground)] truncate pr-1"
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
              <span className="text-sm text-[var(--muted-foreground)]">Move to</span>
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
          defaultParent={selectedCat}
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
    </>
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
    onCreated({ id: r.id, name: r.name, parent_id: r.parent_id });
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
