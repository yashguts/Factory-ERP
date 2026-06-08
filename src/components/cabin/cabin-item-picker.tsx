"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Loader2, X } from "lucide-react";
import { searchCabinItems, type CabinSearchItem } from "@/lib/actions/cabin-jobs";
import { cabinInventoryType } from "@/lib/cabin/cabin-types";

export interface PickedCabinItem {
  id: string;
  code: string;
  name: string;
  uom: string;
}

interface Props {
  cabinType: string;
  itemId: string | null;
  itemCode: string | null;
  itemName: string | null;
  onPick: (it: PickedCabinItem) => void;
  onClear: () => void;
}

/**
 * Per-row item picker for a cabin job. Search is SCOPED to the block's cabin
 * inventory type (no universal search). Front Wall RHS/LHS both search the
 * collapsed "Front Wall" inventory type (see cabinInventoryType).
 */
export function CabinItemPicker({
  cabinType,
  itemId,
  itemCode,
  itemName,
  onPick,
  onClear,
}: Props) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CabinSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const doSearch = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!q.trim()) {
        setResults([]);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        const seq = ++seqRef.current;
        setLoading(true);
        try {
          const data = await searchCabinItems(q, cabinInventoryType(cabinType), 25);
          if (seqRef.current === seq) setResults(data);
        } finally {
          if (seqRef.current === seq) setLoading(false);
        }
      }, 250);
    },
    [cabinType],
  );

  useEffect(() => {
    if (open) doSearch(search);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, search, doSearch]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  if (itemId) {
    return (
      <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-blue-300 bg-blue-50/40 min-w-0">
        <span className="text-sm font-medium truncate flex-1">{itemName}</span>
        <span className="text-[11px] font-mono text-[var(--muted-foreground)] shrink-0">
          {itemCode}
        </span>
        <button
          type="button"
          onClick={onClear}
          title="Change item"
          className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer shrink-0"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
      <input
        ref={inputRef}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={`Search ${cabinType} items...`}
        className="w-full h-8 pl-8 pr-7 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      />
      {loading && (
        <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
      )}
      {open && search.trim() && (
        <div className="absolute z-50 mt-1 w-full min-w-[360px] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-center text-xs text-[var(--muted-foreground)]">
              {loading ? "Searching..." : "No items found"}
            </div>
          ) : (
            results.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => {
                  onPick({
                    id: it.id,
                    code: it.code,
                    name: it.name,
                    uom: it.uom,
                  });
                  setSearch("");
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
              >
                <div className="flex items-start gap-2">
                  <span className="font-medium leading-snug break-words flex-1">
                    {it.name}
                  </span>
                  <span
                    className={`text-[11px] font-mono shrink-0 mt-0.5 tabular-nums ${
                      it.total_stock <= 0
                        ? "text-red-500"
                        : "text-[var(--muted-foreground)]"
                    }`}
                    title={`In stock: ${formatStock(it.total_stock)} ${it.uom}`.trim()}
                  >
                    {formatStock(it.total_stock)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                  <span className="font-mono">{it.code}</span>
                  {it.sub_category && <span className="italic">{it.sub_category}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Match the job-orders picker: whole numbers plain, fractions to 2 dp. */
function formatStock(qty: number): string {
  if (!Number.isFinite(qty)) return "0";
  if (Number.isInteger(qty)) return qty.toLocaleString();
  return Number(qty.toFixed(2)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}
