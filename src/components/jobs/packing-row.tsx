"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Search, X, Loader2, AlertTriangle } from "lucide-react";
import { searchPackingItems } from "@/lib/actions/packing-list";
import type { SearchableItem } from "@/lib/actions/items";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface PackingRowState {
  _key: string;
  item_id: string | null;
  code: string | null;
  name: string | null;
  uom: string | null;
  qty: number;
}

interface PackingRowProps {
  sectionKey: string;
  sectionLabel: string;
  /** Placeholder hint — an example specification for this particular. */
  hint?: string;
  /** Free-text line (fastener / kit / consumable): plain Specification text, no
   *  inventory search. The typed text is stored in `row.name`. */
  freeText?: boolean;
  row: PackingRowState;
  onUpdate: (patch: Partial<PackingRowState>) => void;
  onRemove: () => void;
  /** Pressing Enter on the qty field of the last row adds another. */
  onQtyEnter?: () => void;
}

/**
 * One packing-list row: a category-scoped item search + a quantity. Compact —
 * the page can show hundreds of these. The search dropdown only fetches when
 * the input is focused/open (no work for collapsed/idle rows).
 */
export function PackingRow(props: PackingRowProps) {
  if (props.freeText) return <FreeTextRow {...props} />;
  return <ItemSearchRow {...props} />;
}

const QtyCell = ({ row, onUpdate, onQtyEnter }: Pick<PackingRowProps, "row" | "onUpdate" | "onQtyEnter">) => (
  <input
    type="number"
    min={0}
    step="any"
    inputMode="decimal"
    value={row.qty || ""}
    onChange={(e) => onUpdate({ qty: e.target.value ? Number(e.target.value) : 0 })}
    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onQtyEnter?.(); } }}
    placeholder="Qty"
    className="w-16 h-7 px-1.5 text-[13px] text-right rounded border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] tabular-nums"
  />
);

/** Free-text Specification line — for fasteners / kits / consumables. */
function FreeTextRow({ hint, row, onUpdate, onRemove, onQtyEnter }: PackingRowProps) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={row.name ?? ""}
        onChange={(e) => onUpdate({ name: e.target.value })}
        placeholder={hint ? `e.g. ${hint}` : "Specification…"}
        className="flex-1 min-w-0 h-7 px-2 text-[13px] rounded border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
      />
      <QtyCell row={row} onUpdate={onUpdate} onQtyEnter={onQtyEnter} />
      <span className="w-7 shrink-0" />
      <button
        type="button"
        onClick={onRemove}
        title="Remove line"
        className="p-1 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ItemSearchRow({
  sectionKey,
  sectionLabel,
  hint,
  row,
  onUpdate,
  onRemove,
  onQtyEnter,
}: PackingRowProps) {
  const [search, setSearch] = useState(row.item_id ? (row.name ?? "") : "");
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (row.item_id) setSearch(row.name ?? "");
    else if (!open) setSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.item_id, row.name]);

  const doSearch = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const delay = query ? 220 : 30;
      debounceRef.current = setTimeout(async () => {
        const seq = ++seqRef.current;
        setLoading(true);
        try {
          const data = await searchPackingItems(sectionKey, query, 40);
          if (seqRef.current === seq) {
            setResults(data);
            setHighlightIdx(0);
            setSearchError(null);
          }
        } catch (err) {
          console.error("[packing-search] failed", err);
          if (seqRef.current === seq) {
            setResults([]);
            setSearchError(err instanceof Error ? err.message : "Search failed");
          }
        } finally {
          if (seqRef.current === seq) setLoading(false);
        }
      }, delay);
    },
    [sectionKey],
  );

  useEffect(() => {
    if (open) doSearch(search);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search, sectionKey]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlightIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, open]);

  const pickItem = useCallback(
    (item: SearchableItem) => {
      onUpdate({
        item_id: item.id,
        code: item.code,
        name: item.name,
        uom: item.uom_abbreviation,
        qty: row.qty || 1,
      });
      setSearch(item.name);
      setOpen(false);
    },
    [onUpdate, row.qty],
  );

  const clearItem = useCallback(() => {
    onUpdate({ item_id: null, code: null, name: null, uom: null });
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
    <div ref={containerRef} className="relative flex items-center gap-1.5">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--muted-foreground)] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (hasItem) onUpdate({ item_id: null, code: null, name: null, uom: null });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder={hint ? `Search ${hint}…` : `Search ${sectionLabel}…`}
          className={cn(
            "w-full h-7 pl-7 pr-6 text-[13px] rounded border bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]",
            hasItem ? "border-blue-300" : "border-[var(--border)]",
          )}
        />
        {hasItem && (
          <button
            type="button"
            onClick={clearItem}
            title="Change item"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {loading && !hasItem && (
          <Loader2 className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-[var(--muted-foreground)]" />
        )}

        {open && !hasItem && (
          <div
            ref={listRef}
            className="absolute z-50 mt-1 w-full min-w-[380px] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-72 overflow-y-auto"
          >
            {searchError ? (
              <div className="px-3 py-3 text-xs">
                <div className="flex items-start gap-1.5 text-red-700">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium">Search failed</div>
                    <div className="text-[11px] opacity-80 mt-0.5">{searchError}</div>
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
              <div className="px-3 py-3 text-center text-xs text-[var(--muted-foreground)]">
                {loading ? "Searching…" : search ? "No items found" : "Type to search"}
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
                    "w-full text-left px-2.5 py-1.5 text-[13px] cursor-pointer border-b border-[var(--border)] last:border-0",
                    idx === highlightIdx ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "hover:bg-[var(--muted)]",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="font-medium leading-snug break-words flex-1">{item.name}</span>
                    <span
                      className={cn(
                        "text-[11px] font-mono shrink-0 mt-0.5 tabular-nums",
                        idx === highlightIdx ? "opacity-90" : item.total_stock <= 0 ? "text-red-500" : "text-[var(--muted-foreground)]",
                      )}
                      title={`In stock: ${formatStock(item.total_stock)} ${item.uom_abbreviation}`.trim()}
                    >
                      {formatStock(item.total_stock)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]",
                      idx === highlightIdx ? "text-[var(--primary-foreground)] opacity-75" : "text-[var(--muted-foreground)]",
                    )}
                  >
                    <span className="font-mono">{item.code}</span>
                    {item.category_name && <span className="italic">{item.category_name}</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        value={row.qty || ""}
        onChange={(e) => onUpdate({ qty: e.target.value ? Number(e.target.value) : 0 })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onQtyEnter?.();
          }
        }}
        placeholder="Qty"
        className="w-16 h-7 px-1.5 text-[13px] text-right rounded border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] tabular-nums"
      />
      <span className="w-7 text-[11px] text-[var(--muted-foreground)] text-center shrink-0">{row.uom || "—"}</span>
      <button
        type="button"
        onClick={onRemove}
        title="Remove row"
        className="p-1 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function formatStock(qty: number): string {
  if (!Number.isFinite(qty)) return "0";
  if (Number.isInteger(qty)) return qty.toLocaleString();
  return Number(qty.toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
