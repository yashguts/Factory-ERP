"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Layers,
  Package,
  Wrench,
  Type as TypeIcon,
  FolderTree,
} from "lucide-react";
import {
  upsertTemplatePart,
  deleteTemplatePart,
  reorderTemplateParts,
  upsertTemplateLine,
  deleteTemplateLine,
  reorderTemplateLines,
  type R1TemplatePart,
  type R1TemplateLine,
} from "@/lib/actions/packing-list-r1";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import type { CategoryNode } from "@/lib/actions/categories";
import type { PackingLineKind } from "@/lib/supabase/types";

// reorder helper → returns the new id order (or null if out of bounds)
function moved<T extends { id: string }>(arr: T[], idx: number, dir: -1 | 1): string[] | null {
  const j = idx + dir;
  if (j < 0 || j >= arr.length) return null;
  const ids = arr.map((x) => x.id);
  [ids[idx], ids[j]] = [ids[j], ids[idx]];
  return ids;
}

const KIND_ICON: Record<PackingLineKind, ReactNode> = {
  category: <FolderTree size={13} />,
  item: <Package size={13} />,
  hardware: <Wrench size={13} />,
  free: <TypeIcon size={13} />,
};

// --- Category picker (filterable) ------------------------------------------
function CategoryPicker({
  categories,
  catPath,
  onPick,
}: {
  categories: CategoryNode[];
  catPath: Map<string, string>;
  onPick: (c: CategoryNode) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return categories
      .filter((c) => (catPath.get(c.id) ?? c.name).toLowerCase().includes(s))
      .slice(0, 40);
  }, [q, categories, catPath]);
  return (
    <div className="relative" ref={ref}>
      <Input
        size="sm"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search category / sub-category…"
        className="w-72"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-80 max-h-64 overflow-auto rounded-md border border-[var(--border)] bg-[var(--background)] shadow-lg">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onPick(c);
                setQ("");
                setOpen(false);
              }}
              className="block w-full text-left px-2.5 py-1.5 text-xs hover:bg-[var(--muted)]"
            >
              {catPath.get(c.id) ?? c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Item picker (server search) -------------------------------------------
function ItemPicker({ onPick }: { onPick: (i: SearchableItem) => void }) {
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
    const s = q.trim();
    if (s.length < 2) {
      setRes([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      searchItems(s, undefined, 25)
        .then((r) => alive && setRes(r))
        .catch(() => {});
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="relative" ref={ref}>
      <Input
        size="sm"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search item by code / name…"
        className="w-72"
      />
      {open && res.length > 0 && (
        <div className="absolute z-30 mt-1 w-96 max-h-64 overflow-auto rounded-md border border-[var(--border)] bg-[var(--background)] shadow-lg">
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

// --- Add-a-line row ---------------------------------------------------------
function AddLine({
  partId,
  nextSort,
  categories,
  catPath,
  onDone,
}: {
  partId: string;
  nextSort: number;
  categories: CategoryNode[];
  catPath: Map<string, string>;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<PackingLineKind>("category");
  const [free, setFree] = useState("");
  const add = async (extra: Partial<R1TemplateLine> & { label?: string | null }) => {
    await upsertTemplateLine({ part_id: partId, kind, sort_order: nextSort, ...extra });
    onDone();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 pl-7 pr-2 py-1.5 border-t border-dashed border-[var(--border)]">
      <Plus size={13} className="text-[var(--muted-foreground)]" />
      <Select
        size="sm"
        value={kind}
        onChange={(e) => setKind(e.target.value as PackingLineKind)}
        className="w-32"
      >
        <option value="category">Category</option>
        <option value="item">Item</option>
        <option value="hardware">Hardware</option>
        <option value="free">Free text</option>
      </Select>
      {kind === "category" && (
        <CategoryPicker
          categories={categories}
          catPath={catPath}
          onPick={(c) => add({ category_id: c.id, label: c.name })}
        />
      )}
      {kind === "item" && (
        <ItemPicker onPick={(i) => add({ item_id: i.id, label: i.name })} />
      )}
      {kind === "hardware" && (
        <Select
          size="sm"
          className="w-40"
          defaultValue=""
          onChange={(e) => e.target.value && add({ label: e.target.value })}
        >
          <option value="">Pick hardware…</option>
          <option value="Nut-Bolts">Nut-Bolts</option>
          <option value="Screws">Screws</option>
        </Select>
      )}
      {kind === "free" && (
        <>
          <Input
            size="sm"
            value={free}
            onChange={(e) => setFree(e.target.value)}
            placeholder="Free-text line…"
            className="w-60"
            onKeyDown={(e) => {
              if (e.key === "Enter" && free.trim()) add({ label: free.trim() });
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!free.trim()}
            onClick={() => free.trim() && add({ label: free.trim() })}
          >
            Add
          </Button>
        </>
      )}
    </div>
  );
}

// --- Main editor ------------------------------------------------------------
export function TemplateEditorClient({
  template,
  categories,
}: {
  template: R1TemplatePart[];
  categories: CategoryNode[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [newPart, setNewPart] = useState("");

  const catPath = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const m = new Map<string, string>();
    for (const c of categories) {
      const parts: string[] = [];
      let cur: CategoryNode | undefined = c;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        parts.unshift(cur.name);
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
      m.set(c.id, parts.join(" › "));
    }
    return m;
  }, [categories]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const totalLines = template.reduce((s, p) => s + p.lines.length, 0);

  return (
    <>
      <PageHeader
        title="Packing List R1 — Template"
        meta={`${template.length} parts · ${totalLines} lines`}
        icon={<Layers size={18} />}
        onBack={() => router.push("/packing-list-r1")}
        actions={
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              value={newPart}
              onChange={(e) => setNewPart(e.target.value)}
              placeholder="New part title…"
              className="w-44"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPart.trim()) {
                  const title = newPart.trim();
                  setNewPart("");
                  act(() => upsertTemplatePart({ title, sort_order: template.length }));
                }
              }}
            />
            <Button
              size="sm"
              disabled={!newPart.trim() || busy}
              onClick={() => {
                const title = newPart.trim();
                setNewPart("");
                act(() => upsertTemplatePart({ title, sort_order: template.length }));
              }}
            >
              <Plus size={15} /> Add Part
            </Button>
          </div>
        }
      />

      <p className="text-xs text-[var(--muted-foreground)] mb-4">
        This shared template seeds every job&apos;s packing list. Edits here apply to{" "}
        <strong>future</strong> job lists; already-saved job lists are untouched.
      </p>

      <div className="space-y-3">
        {template.map((part, pi) => (
          <div key={part.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
              <span className="text-[11px] font-mono text-[var(--muted-foreground)] w-6">
                {pi + 1}
              </span>
              <input
                key={part.id + part.title}
                defaultValue={part.title}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== part.title)
                    act(() => upsertTemplatePart({ id: part.id, title: v }));
                }}
                className="flex-1 bg-transparent text-sm font-semibold outline-none focus:bg-[var(--muted)] rounded px-1 py-0.5"
              />
              <span className="text-[11px] text-[var(--muted-foreground)]">
                {part.lines.length} lines
              </span>
              <button
                title="Move up"
                disabled={pi === 0 || busy}
                onClick={() => {
                  const ids = moved(template, pi, -1);
                  if (ids) act(() => reorderTemplateParts(ids));
                }}
                className="p-1 rounded hover:bg-[var(--muted)] disabled:opacity-30"
              >
                <ChevronUp size={14} />
              </button>
              <button
                title="Move down"
                disabled={pi === template.length - 1 || busy}
                onClick={() => {
                  const ids = moved(template, pi, 1);
                  if (ids) act(() => reorderTemplateParts(ids));
                }}
                className="p-1 rounded hover:bg-[var(--muted)] disabled:opacity-30"
              >
                <ChevronDown size={14} />
              </button>
              <button
                title="Delete part"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Delete part "${part.title}" and its ${part.lines.length} lines?`))
                    act(() => deleteTemplatePart(part.id));
                }}
                className="p-1 rounded hover:bg-red-50 text-red-600"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div>
              {part.lines.map((l, li) => (
                <div
                  key={l.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border-b border-[var(--border)] last:border-b-0"
                >
                  <span className="text-[var(--muted-foreground)]" title={l.kind}>
                    {KIND_ICON[l.kind]}
                  </span>
                  <span className="flex-1 truncate">
                    {l.kind === "item" ? (
                      <>
                        <span className="font-mono text-xs">{l.item_code}</span>{" "}
                        <span className="text-[var(--muted-foreground)]">{l.item_name}</span>
                      </>
                    ) : l.kind === "category" ? (
                      <>
                        {l.category_id ? (
                          <span>{l.category_name ?? l.label}</span>
                        ) : (
                          <span className="text-amber-600" title="No matching category — fix the name or re-pick">
                            {l.label} ⚠
                          </span>
                        )}
                      </>
                    ) : (
                      <span>{l.label}</span>
                    )}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    {l.kind}
                  </span>
                  <button
                    disabled={li === 0 || busy}
                    onClick={() => {
                      const ids = moved(part.lines, li, -1);
                      if (ids) act(() => reorderTemplateLines(ids));
                    }}
                    className="p-0.5 rounded hover:bg-[var(--muted)] disabled:opacity-30"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    disabled={li === part.lines.length - 1 || busy}
                    onClick={() => {
                      const ids = moved(part.lines, li, 1);
                      if (ids) act(() => reorderTemplateLines(ids));
                    }}
                    className="p-0.5 rounded hover:bg-[var(--muted)] disabled:opacity-30"
                  >
                    <ChevronDown size={13} />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => act(() => deleteTemplateLine(l.id))}
                    className="p-0.5 rounded hover:bg-red-50 text-red-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <AddLine
                partId={part.id}
                nextSort={part.lines.length}
                categories={categories}
                catPath={catPath}
                onDone={() => router.refresh()}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
