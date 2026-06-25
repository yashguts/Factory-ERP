"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { Search, X, Loader2, AlertTriangle } from "lucide-react";
import { searchItems } from "@/lib/actions/items";
import type { SearchableItem } from "@/lib/actions/items";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PickedItem } from "@/components/jobs/item-picker-section";

interface ItemRowProps {
  row: PickedItem;
  scopeCategories?: string[];
  sectionCategory: string;
  onUpdate: (patch: Partial<PickedItem>) => void;
  onRemove?: () => void;
}

/**
 * One BOM row: an item-search input (autocomplete dropdown) plus a quantity
 * field plus an optional remove button. State for the dropdown lives here;
 * the picked item itself is owned by the parent ItemPickerSection.
 */
export function ItemRow({
  row,
  scopeCategories,
  sectionCategory,
  onUpdate,
  onRemove,
}: ItemRowProps) {
  // Display the item name once it's picked. (lookup_key was historically
  // a longer label; now items.name carries the same value and is the
  // canonical display — see item-edit form's auto-sync.)
  const initialDisplay = row.item_id ? row.item_name : "";
  const [search, setSearch] = useState(initialDisplay);
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  /** Last search error (action stale after deploy, network blip, etc.) */
  const [searchError, setSearchError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  /* keep search text in sync if the parent resets the row */
  useEffect(() => {
    if (row.item_id) {
      setSearch(row.item_name);
    } else if (!open) {
      setSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.item_id, row.item_lookup, row.item_name]);

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
            setSearchError(null);
          }
        } catch (err) {
          // Surface the failure instead of leaving the user with an
          // empty dropdown forever. Most common cause: page has been
          // open across a deploy and the server action hash is stale —
          // a hard reload will fix it.
          // eslint-disable-next-line no-console
          console.error("[item-search] failed", err);
          if (seqRef.current === seq) {
            setResults([]);
            setSearchError(
              err instanceof Error ? err.message : "Search failed",
            );
          }
        } finally {
          if (seqRef.current === seq) setLoading(false);
        }
      }, delay);
    },
    [scopeCategories],
  );

  /* re-run search when query or scope changes (while open) */
  useEffect(() => {
    if (open) doSearch(search);
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
        item_lookup: item.lookup_key,
        uom: item.uom_abbreviation,
        category_name: item.category_name,
        family: item.family,
        finish: item.finish,
        required_quantity: row.required_quantity || 1,
        // The engineer chose this item — it's no longer an AI guess, so drop the flag.
        confidence: undefined,
      });
      setSearch(item.name);
      setOpen(false);
    },
    [onUpdate, row.required_quantity],
  );

  const clearItem = useCallback(() => {
    onUpdate({
      item_id: null,
      item_code: "",
      item_name: "",
      item_lookup: null,
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
              onUpdate({
                item_id: null,
                item_code: "",
                item_name: "",
                item_lookup: null,
                uom: "",
                category_name: null,
              });
            }
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          title={
            hasItem && row.confidence === "low"
              ? "Low-confidence AI suggestion — verify or replace"
              : undefined
          }
          placeholder={
            row.label && !hasItem
              ? `Fill: ${row.label}`
              : `Search ${sectionCategory}...`
          }
          className={cn(
            "w-full h-8 pl-8 pr-7 text-sm rounded-md border bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1",
            hasItem
              ? row.confidence === "low"
                ? "border-amber-400 bg-amber-50/40"
                : "border-blue-300"
              : "border-[var(--border)]",
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
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
        )}

        {/* Dropdown */}
        {open && !hasItem && (
          <div
            ref={listRef}
            className="absolute z-50 mt-1 w-full min-w-[420px] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-80 overflow-y-auto"
          >
            {searchError ? (
              <div className="px-3 py-3 text-xs">
                <div className="flex items-start gap-1.5 text-red-700">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium">Search failed</div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      {searchError}
                    </div>
                    <div className="text-[11px] opacity-70 mt-1">
                      This usually means the page has been open across a
                      deploy. Reload to fix.
                    </div>
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="mt-1.5 text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer"
                    >
                      Reload page →
                    </button>
                  </div>
                </div>
              </div>
            ) : results.length === 0 ? (
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
                    "w-full text-left px-3 py-2 text-sm cursor-pointer",
                    "border-b border-[var(--border)] last:border-0",
                    idx === highlightIdx
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "hover:bg-[var(--muted)]",
                  )}
                >
                  {/* Line 1: primary label (lookup_key if present, else name) + stock */}
                  <div className="flex items-start gap-2">
                    <span className="font-medium leading-snug break-words flex-1">
                      {item.name}
                    </span>
                    <span
                      className={cn(
                        "text-[11px] font-mono shrink-0 mt-0.5 tabular-nums",
                        idx === highlightIdx
                          ? "opacity-90"
                          : item.total_stock <= 0
                            ? "text-red-500"
                            : "text-[var(--muted-foreground)]",
                      )}
                      title={`In stock: ${formatStock(item.total_stock)} ${item.uom_abbreviation}`.trim()}
                    >
                      {formatStock(item.total_stock)}
                    </span>
                  </div>
                  {/* Line 2: code + category */}
                  <div
                    className={cn(
                      "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]",
                      idx === highlightIdx
                        ? "text-[var(--primary-foreground)] opacity-75"
                        : "text-[var(--muted-foreground)]",
                    )}
                  >
                    {item.effective_procurement_type && (
                      <Badge
                        variant={item.effective_procurement_type === "make" ? "blue" : "amber"}
                        className="text-[10px] px-1.5"
                        title={item.effective_procurement_type === "make" ? "Make — manufactured in-house" : "Trade — purchased from suppliers"}
                      >
                        {item.effective_procurement_type === "make" ? "M" : "T"}
                      </Badge>
                    )}
                    <span className="font-mono">{item.code}</span>
                    {item.category_name && (
                      <span className="italic">{item.category_name}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Low-confidence AI flag */}
      {hasItem && row.confidence === "low" && (
        <span
          className="mt-2 shrink-0"
          title="Low-confidence AI suggestion — verify or replace"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        </span>
      )}

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

      {/* Unit */}
      <span className="w-8 text-[11px] text-[var(--muted-foreground)] mt-2 text-center shrink-0">
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

/**
 * Format inventory stock for the dropdown right column.
 *  - Whole numbers render as e.g. "12" or "1,250"
 *  - Fractional quantities (e.g. 5.5 m of rope) render with up to 2 decimals
 */
function formatStock(qty: number): string {
  if (!Number.isFinite(qty)) return "0";
  if (Number.isInteger(qty)) {
    return qty.toLocaleString();
  }
  return Number(qty.toFixed(2)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}
