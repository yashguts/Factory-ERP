"use client";

import { useState, useMemo, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronRight, Search, FolderTree } from "lucide-react";
import { getAllCategories } from "@/lib/actions/categories";
import type { CategoryNode } from "@/lib/actions/categories";

interface Props {
  /** Display labels (paths) of sections already on the form — to hide. */
  existingPaths: string[];
  onPick: (selection: { path: string; displayName: string }) => void;
  onClose: () => void;
}

/**
 * Fuzzy-search & tree-pick a category from the inventory taxonomy.
 * Returns the full path string (e.g. "Hardware > Bull Dog Clips") so
 * the parent form can add it as an ad-hoc BOM section.
 */
export function CategoryPickerModal({
  existingPaths,
  onPick,
  onClose,
}: Props) {
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  /* Load category list once */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await getAllCategories();
        if (!cancelled) setCategories(all);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Build path strings for every category */
  const paths = useMemo(() => {
    const byId = new Map<string, CategoryNode>();
    for (const c of categories) byId.set(c.id, c);
    const out: Array<{ id: string; path: string; leafName: string }> = [];
    for (const c of categories) {
      const segs: string[] = [];
      let cur: CategoryNode | undefined = c;
      while (cur) {
        segs.unshift(cur.name);
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
      out.push({ id: c.id, path: segs.join(" > "), leafName: c.name });
    }
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }, [categories]);

  /* Filter by fuzzy match across the full path */
  const filtered = useMemo(() => {
    const existing = new Set(existingPaths);
    const tokens = search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return paths.filter((p) => {
      if (existing.has(p.path)) return false;
      if (tokens.length === 0) return true;
      const lower = p.path.toLowerCase();
      return tokens.every((t) => lower.includes(t));
    });
  }, [paths, search, existingPaths]);

  return (
    <Modal title="Add Section From Inventory" onClose={onClose} className="max-w-2xl">
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-foreground)]">
          Pick any inventory category. Items in this category (and all its
          sub-categories) will be searchable in the new section.
        </p>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)] pointer-events-none" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type to filter — e.g. 'pulley', 'hardware bolt'..."
            className="pl-9"
          />
        </div>

        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
            Loading categories...
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
            No categories match.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border)]">
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick({ path: p.path, displayName: p.leafName })}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[var(--muted)] cursor-pointer"
              >
                <FolderTree className="h-3.5 w-3.5 text-[var(--muted-foreground)] shrink-0" />
                <span className="truncate">
                  {renderPathBreadcrumb(p.path)}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Render a path like "Hardware > Bull Dog Clips" with subtle separators. */
function renderPathBreadcrumb(path: string) {
  const parts = path.split(" > ");
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {parts.map((part, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span
            className={
              i === parts.length - 1
                ? "font-medium text-[var(--foreground)]"
                : "text-[var(--muted-foreground)]"
            }
          >
            {part}
          </span>
          {i < parts.length - 1 && (
            <ChevronRight className="h-3 w-3 text-[var(--muted-foreground)] opacity-60" />
          )}
        </span>
      ))}
    </span>
  );
}
