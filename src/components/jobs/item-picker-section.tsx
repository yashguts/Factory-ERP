"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { Search, X, Plus, Loader2, Trash2 } from "lucide-react";
import { searchItems } from "@/lib/actions/items";
import type { SearchableItem } from "@/lib/actions/items";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface PickedItem {
  _key: string;
  /** null when the row exists but no item has been picked yet */
  item_id: string | null;
  item_code: string;
  item_name: string;
  uom: string;
  category_name: string | null;
  required_quantity: number;
}

interface ItemPickerSectionProps {
  /** Section display name (also used as `category` in job_bom_lines). */
  category: string;
  description?: string;
  /** Category PATH strings used to scope the search. */
  defaultItemCategories?: string[];
  /** Currently selected items for this section. */
  items: PickedItem[];
  /** Called whenever the item list changes. */
  onItemsChange: (items: PickedItem[]) => void;
  /** Optional remove button for ad-hoc sections. */
  onRemoveSection?: () => void;
}

const makeKey = () => Math.random().toString(36).slice(2);

const emptyRow = (): PickedItem => ({
  _key: makeKey(),
  item_id: null,
  item_code: "",
  item_name: "",
  uom: "",
  category_name: null,
  required_quantity: 1,
});

/* ------------------------------------------------------------------ */
/*  Section component                                                 */
/* ------------------------------------------------------------------ */

export function ItemPickerSection({
  category,
  description,
  defaultItemCategories,
  items,
  onItemsChange,
  onRemoveSection,
}: ItemPickerSectionProps) {
  const [showAll, setShowAll] = useState(false);

  // Ensure at least one row is always visible so the user can start picking
  // without needing to click "+ Add Item".
  const displayRows = items.length > 0 ? items : [emptyRow()];

  const updateRow = useCallback(
    (key: string, patch: Partial<PickedItem>) => {
      // If the section had no rows, seed onItemsChange with the new row
      const base = items.length > 0 ? items : [displayRows[0]];
      onItemsChange(
        base.map((it) => (it._key === key ? { ...it, ...patch } : it)),
      );
    },
    [items, displayRows, onItemsChange],
  );

  const addRow = useCallback(() => {
    onItemsChange([...items, emptyRow()]);
  }, [items, onItemsChange]);

  const removeRow = useCallback(
    (key: string) => {
      onItemsChange(items.filter((it) => it._key !== key));
    },
    [items, onItemsChange],
  );

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-[var(--foreground)]">{category}</h3>
          {items.filter((i) => i.item_id).length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
              {items.filter((i) => i.item_id).length} item
              {items.filter((i) => i.item_id).length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] whitespace-nowrap cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="rounded border-[var(--border)] cursor-pointer"
            />
            All categories
          </label>
          {onRemoveSection && (
            <button
              type="button"
              onClick={onRemoveSection}
              title="Remove this section"
              className="p-1 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {description && (
        <p className="text-xs text-[var(--muted-foreground)] mb-3">
          {description}
        </p>
      )}

      {/* Rows */}
      <div className="space-y-2">
        {displayRows.map((row, idx) => (
          <ItemRow
            key={row._key}
            row={row}
            scopeCategories={
              showAll ? undefined : defaultItemCategories
            }
            sectionCategory={category}
            onUpdate={(patch) => updateRow(row._key, patch)}
            onRemove={
              displayRows.length > 1
                ? () => removeRow(row._key)
                : items.length === 0
                  ? undefined // don't allow removing the seeded empty row
                  : () => removeRow(row._key)
            }
            autoFocus={idx === 0 && !row.item_id && items.length === 0}
          />
        ))}
      </div>

      {/* + Add Item */}
      <button
        type="button"
        onClick={addRow}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:underline cursor-pointer"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Item
      </button>
    </div>
  );
}

/* ================================================================== */
/*  ItemRow — one (search + qty + remove) row                         */
/* ================================================================== */

interface ItemRowProps {
  row: PickedItem;
  scopeCategories?: string[];
  sectionCategory: string;
  onUpdate: (patch: Partial<PickedItem>) => void;
  onRemove?: () => void;
  autoFocus?: boolean;
}

function ItemRow({
  row,
  scopeCategories,
  sectionCategory,
  onUpdate,
  onRemove,
  autoFocus,
}: ItemRowProps) {
  const [search, setSearch] = useState(
    row.item_id ? `${row.item_code} — ${row.item_name}` : "",
  );
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  /* keep search text in sync if the parent resets the row */
  useEffect(() => {
    if (row.item_id) {
      setSearch(`${row.item_code} — ${row.item_name}`);
    } else if (!row.item_id && !open) {
      setSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.item_id, row.item_code, row.item_name]);

  /* autofocus first empty row */
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  /* debounced search */
  const doSearch = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const delay = query ? 250 : 30;
      debounceRef.current = setTimeout(async () => {
        const seq = ++seqRef.current;
        setLoading(true);
        try {
          const data = await searchItems(query, scopeCategories, 40);
          if (seqRef.current === seq) {
            setResults(data);
            setHighlightIdx(0);
          }
        } catch {
          /* swallow */
        } finally {
          if (seqRef.current === seq) setLoading(false);
        }
      }, delay);
    },
    [scopeCategories],
  );

  /* re-run search when query or scope changes (while open) */
  useEffect(() => {
    if (open) doSearch(search.startsWith(row.item_code) ? "" : search);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search, scopeCategories]);

  /* close on outside click */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  /* scroll highlight into view */
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-idx="${highlightIdx}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, open]);

  const pickItem = useCallback(
    (item: SearchableItem) => {
      onUpdate({
        item_id: item.id,
        item_code: item.code,
        item_name: item.name,
        uom: item.uom_abbreviation,
        category_name: item.category_name,
        required_quantity: row.required_quantity || 1,
      });
      setSearch(`${item.code} — ${item.name}`);
      setOpen(false);
    },
    [onUpdate, row.required_quantity],
  );

  const clearItem = useCallback(() => {
    onUpdate({
      item_id: null,
      item_code: "",
      item_name: "",
      uom: "",
      category_name: null,
    });
    setSearch("");
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [onUpdate]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlightIdx]) pickItem(results[highlightIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const hasItem = !!row.item_id;

  return (
    <div ref={containerRef} className="relative flex items-start gap-2">
      {/* Search / display */}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (hasItem) {
              // user is typing over a picked item → clear it
              onUpdate({
                item_id: null,
                item_code: "",
                item_name: "",
                uom: "",
                category_name: null,
              });
            }
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder={`Search items in ${sectionCategory}...`}
          className={cn(
            "w-full h-8 pl-8 pr-8 text-sm rounded-md border bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1",
            hasItem ? "border-blue-300" : "border-[var(--border)]",
          )}
        />
        {hasItem && (
          <button
            type="button"
            onClick={clearItem}
            title="Change item"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {loading && !hasItem && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
        )}

        {/* Dropdown */}
        {open && !hasItem && (
          <div
            ref={listRef}
            className="absolute z-50 mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-64 overflow-y-auto"
          >
            {results.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
                {loading
                  ? "Searching..."
                  : search
                    ? "No items found"
                    : "Type to search"}
              </div>
            ) : (
              results.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  data-idx={idx}
                  onClick={() => pickItem(item)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm flex items-center gap-3 cursor-pointer",
                    "border-b border-[var(--border)] last:border-0",
                    idx === highlightIdx
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "hover:bg-[var(--muted)]",
                  )}
                >
                  <span className="font-mono text-[11px] opacity-70 w-24 shrink-0 truncate">
                    {item.code}
                  </span>
                  <span className="flex-1 truncate">{item.name}</span>
                  {item.category_name && (
                    <span className="text-[10px] opacity-50 shrink-0 hidden sm:inline">
                      {item.category_name}
                    </span>
                  )}
                  <span className="text-xs opacity-60 shrink-0 w-8 text-right">
                    {item.uom_abbreviation}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Qty */}
      <input
        type="number"
        min={0}
        step="any"
        inputMode="numeric"
        value={row.required_quantity || ""}
        onChange={(e) =>
          onUpdate({
            required_quantity: e.target.value ? Number(e.target.value) : 0,
          })
        }
        disabled={!hasItem}
        placeholder="Qty"
        className="w-20 h-8 px-2 text-sm text-right rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1 disabled:opacity-50"
      />

      {/* Unit display */}
      <span className="w-10 text-xs text-[var(--muted-foreground)] mt-2 text-center shrink-0">
        {row.uom || "—"}
      </span>

      {/* Remove row */}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove row"
          className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
