"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Loader2, X, ChevronLeft } from "lucide-react";
import {
  searchCabinBases,
  getCabinBaseFinishes,
  type CabinBase,
  type CabinFinishOption,
} from "@/lib/actions/cabin-jobs";
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
 * Two-step picker for finish-fanned cabin types: pick the BASE item, then its
 * FINISH, which resolves to the exact inventory item. A base with a single
 * finish auto-resolves (no finish step). Search is scoped to the block's
 * inventory type (RHS/LHS -> Front Wall).
 */
export function CabinBaseFinishPicker({
  cabinType,
  itemId,
  itemCode,
  itemName,
  onPick,
  onClear,
}: Props) {
  const invType = cabinInventoryType(cabinType);

  // --- base search state ---
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CabinBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // --- finish step state ---
  const [base, setBase] = useState<CabinBase | null>(null);
  const [finishes, setFinishes] = useState<CabinFinishOption[]>([]);
  const [loadingFinishes, setLoadingFinishes] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
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
          const data = await searchCabinBases(q, invType, 25);
          if (seqRef.current === seq) setResults(data);
        } finally {
          if (seqRef.current === seq) setLoading(false);
        }
      }, 250);
    },
    [invType],
  );

  useEffect(() => {
    if (open && !base) doSearch(search);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, search, base, doSearch]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const selectBase = async (b: CabinBase) => {
    setBase(b);
    setLoadingFinishes(true);
    try {
      const opts = await getCabinBaseFinishes(b.family, invType);
      if (opts.length === 1) {
        // single finish (Granite / non-fanned) -> resolve immediately, no finish step
        const o = opts[0];
        onPick({ id: o.item_id, code: o.code, name: o.name, uom: o.uom });
        resetSearch();
      } else {
        setFinishes(opts);
      }
    } finally {
      setLoadingFinishes(false);
    }
  };

  const resetSearch = () => {
    setBase(null);
    setFinishes([]);
    setSearch("");
    setResults([]);
    setOpen(false);
  };

  const backToBases = () => {
    setBase(null);
    setFinishes([]);
    setOpen(true);
  };

  // ---------- already picked ----------
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

  // ---------- step 2: finish selection ----------
  if (base) {
    return (
      <div ref={containerRef} className="relative">
        <div className="flex items-center gap-2 h-8 px-2 rounded-md border border-[var(--primary)]/40 bg-[var(--primary)]/5 min-w-0">
          <button
            type="button"
            onClick={backToBases}
            title="Choose a different item"
            className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer shrink-0"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-sm font-medium truncate flex-1" title={base.family}>
            {base.family}
          </span>
          <span className="text-[11px] text-[var(--muted-foreground)] shrink-0">
            pick finish
          </span>
        </div>
        <div className="absolute z-50 mt-1 w-full min-w-[360px] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-72 overflow-y-auto">
          {loadingFinishes ? (
            <div className="px-3 py-3 text-center text-xs text-[var(--muted-foreground)]">
              Loading finishes...
            </div>
          ) : (
            finishes.map((o) => (
              <button
                key={o.item_id}
                type="button"
                onClick={() => {
                  onPick({ id: o.item_id, code: o.code, name: o.name, uom: o.uom });
                  resetSearch();
                }}
                className="w-full text-left px-3 py-2 text-sm cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
              >
                <div className="flex items-start gap-2">
                  <span className="font-medium leading-snug break-words flex-1">
                    {o.finish ?? "— no finish —"}
                  </span>
                  <span
                    className={`text-[11px] font-mono shrink-0 mt-0.5 tabular-nums ${
                      o.total_stock <= 0 ? "text-red-500" : "text-[var(--muted-foreground)]"
                    }`}
                    title={`In stock: ${formatStock(o.total_stock)} ${o.uom}`.trim()}
                  >
                    {formatStock(o.total_stock)}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] font-mono text-[var(--muted-foreground)]">
                  {o.code}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  // ---------- step 1: base search ----------
  return (
    <div ref={containerRef} className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={`Search ${cabinType} item...`}
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
            results.map((b) => (
              <button
                key={b.family}
                type="button"
                onClick={() => selectBase(b)}
                className="w-full text-left px-3 py-2 text-sm cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
              >
                <div className="flex items-start gap-2">
                  <span className="font-medium leading-snug break-words flex-1">
                    {b.family}
                  </span>
                  <span
                    className="text-[11px] shrink-0 mt-0.5 text-[var(--muted-foreground)] tabular-nums"
                    title={`Total stock across finishes: ${formatStock(b.total_stock)}`}
                  >
                    {formatStock(b.total_stock)}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {b.finish_count === 1
                    ? "1 finish"
                    : `${b.finish_count} finishes`}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Whole numbers plain, fractions to 2 dp (matches the other cabin pickers). */
function formatStock(qty: number): string {
  if (!Number.isFinite(qty)) return "0";
  if (Number.isInteger(qty)) return qty.toLocaleString();
  return Number(qty.toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
