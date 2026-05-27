"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { Search, X, Plus, Loader2 } from "lucide-react";
import { searchItems } from "@/lib/actions/items";
import type { SearchableItem } from "@/lib/actions/items";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface PickedItem {
  _key: string;
  item_id: string;
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
  /** item_categories.name values for the default filter. */
  defaultItemCategories?: string[];
  /** Currently selected items for this section. */
  items: PickedItem[];
  /** Called whenever the item list changes. */
  onItemsChange: (items: PickedItem[]) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function ItemPickerSection({
  category,
  description,
  defaultItemCategories,
  items,
  onItemsChange,
}: ItemPickerSectionProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchSeqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  /* ---- debounced search ---- */
  const doSearch = useCallback(
    (query: string, allCategories: boolean) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      const delay = query ? 300 : 50; // near-instant on open, debounced while typing
      debounceRef.current = setTimeout(async () => {
        const seq = ++searchSeqRef.current;
        setLoading(true);
        try {
          const cats = allCategories ? undefined : defaultItemCategories;
          const data = await searchItems(query, cats, 40);
          if (searchSeqRef.current === seq) {
            setResults(data);
            setHighlightIdx(0);
          }
        } catch {
          /* swallow network errors */
        } finally {
          if (searchSeqRef.current === seq) setLoading(false);
        }
      }, delay);
    },
    [defaultItemCategories],
  );

  /* trigger search when dropdown opens, query changes, or filter toggles */
  useEffect(() => {
    if (showDropdown) doSearch(search, showAll);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDropdown, search, showAll]);

  /* close on outside click */
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  /* scroll highlighted option into view */
  useEffect(() => {
    if (!showDropdown || !listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-idx="${highlightIdx}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, showDropdown]);

  /* ---- item mutations ---- */
  const addItem = useCallback(
    (item: SearchableItem) => {
      if (items.some((p) => p.item_id === item.id)) return; // no duplicates
      onItemsChange([
        ...items,
        {
          _key: Math.random().toString(36).slice(2),
          item_id: item.id,
          item_code: item.code,
          item_name: item.name,
          uom: item.uom_abbreviation,
          category_name: item.category_name,
          required_quantity: 1,
        },
      ]);
      setSearch("");
      inputRef.current?.focus();
    },
    [items, onItemsChange],
  );

  const removeItem = useCallback(
    (key: string) => onItemsChange(items.filter((i) => i._key !== key)),
    [items, onItemsChange],
  );

  const updateQuantity = useCallback(
    (key: string, qty: number) =>
      onItemsChange(
        items.map((i) =>
          i._key === key ? { ...i, required_quantity: qty } : i,
        ),
      ),
    [items, onItemsChange],
  );

  /* exclude already-picked items from dropdown */
  const available = results.filter(
    (r) => !items.some((p) => p.item_id === r.id),
  );

  /* ---- keyboard nav ---- */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, available.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (available[highlightIdx]) addItem(available[highlightIdx]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-medium text-[var(--foreground)]">{category}</h3>
        {items.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {items.length} item{items.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {description && (
        <p className="text-xs text-[var(--muted-foreground)] mb-3">
          {description}
        </p>
      )}

      {/* Search bar */}
      <div ref={containerRef} className="relative mb-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setShowDropdown(true)}
              onKeyDown={handleKeyDown}
              placeholder="Search items to add..."
              className="w-full h-8 pl-8 pr-8 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1"
            />
            {loading && (
              <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
            )}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] whitespace-nowrap cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="rounded border-[var(--border)]"
            />
            All
          </label>
        </div>

        {/* Dropdown results */}
        {showDropdown && (
          <div
            ref={listRef}
            className="absolute z-50 mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-64 overflow-y-auto"
          >
            {available.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
                {loading
                  ? "Searching..."
                  : results.length > 0 && available.length === 0
                    ? "All matching items already added"
                    : search
                      ? "No items found"
                      : "Type to search or browse items"}
              </div>
            ) : (
              available.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  data-idx={idx}
                  onClick={() => addItem(item)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm flex items-center gap-3",
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
                  <Plus className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Selected items table */}
      {items.length > 0 ? (
        <div className="rounded-md border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--muted)] text-[11px] text-[var(--muted-foreground)] uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 font-medium">Code</th>
                <th className="text-left px-3 py-1.5 font-medium">Item</th>
                <th className="text-right px-3 py-1.5 font-medium w-28">
                  Qty
                </th>
                <th className="text-left px-3 py-1.5 font-medium w-14">
                  Unit
                </th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item._key}
                  className="border-t border-[var(--border)] group"
                >
                  <td className="px-3 py-1.5 font-mono text-[11px] text-[var(--muted-foreground)]">
                    {item.item_code}
                  </td>
                  <td className="px-3 py-1.5 text-[var(--foreground)] truncate max-w-[200px]">
                    {item.item_name}
                  </td>
                  <td className="px-3 py-1">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="numeric"
                      value={item.required_quantity || ""}
                      onChange={(e) =>
                        updateQuantity(
                          item._key,
                          e.target.value ? Number(e.target.value) : 0,
                        )
                      }
                      className="w-full h-7 px-2 text-sm text-right rounded border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-[11px] text-[var(--muted-foreground)]">
                    {item.uom}
                  </td>
                  <td className="px-1 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeItem(item._key)}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 text-[var(--muted-foreground)] hover:text-red-600 transition-opacity"
                      title="Remove item"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--background)] px-4 py-6 text-center">
          <p className="text-xs text-[var(--muted-foreground)]">
            No items added yet. Use the search above to find and add inventory
            items.
          </p>
        </div>
      )}
    </div>
  );
}
