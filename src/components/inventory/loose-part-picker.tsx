"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, Loader2, AlertTriangle, Puzzle, Plus } from "lucide-react";
import {
  searchLooseParts,
  promoteLoosePartLabel,
  type LoosePartCandidate,
} from "@/lib/actions/item-bom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface LoosePartPickerProps {
  itemId: string | null;
  itemName: string;
  itemCode: string;
  uom: string;
  qty: number;
  onPick: (p: { id: string; code: string; name: string; uom: string }) => void;
  onClear: () => void;
  onQty: (n: number) => void;
  onRemove?: () => void;
  onCreateNew: (query: string) => void;
  /** A captured loose-part name not yet linked to an item (edit/import case). */
  pendingLabel?: string | null;
}

/**
 * Per-row picker for the Assembly-parts section. Unlike the inventory item
 * search, this searches ONLY loose parts: phantom loose-part items already
 * created, plus the loose-part labels on program outputs. Picking a label
 * promotes it to a tracked phantom item (and relinks its programs) before
 * attaching it. A "create new" escape hatch makes a brand-new loose part.
 */
export function LoosePartPicker({
  itemId,
  itemName,
  itemCode,
  uom,
  qty,
  onPick,
  onClear,
  onQty,
  onRemove,
  onCreateNew,
  pendingLabel,
}: LoosePartPickerProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<LoosePartCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  // An imported/edited loose row carries a captured label but no item yet.
  // Show it as a pending chip until the user resolves it (keeps it visible).
  const [resolving, setResolving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const doSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = query ? 250 : 30;
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const data = await searchLooseParts(query, 30);
        if (seqRef.current === seq) {
          setResults(data);
          setError(null);
        }
      } catch (err) {
        if (seqRef.current === seq) {
          setResults([]);
          setError(err instanceof Error ? err.message : "Search failed");
        }
      } finally {
        if (seqRef.current === seq) setLoading(false);
      }
    }, delay);
  }, []);

  useEffect(() => {
    if (open) doSearch(search);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search]);

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

  const pickItem = (id: string, code: string, name: string, u: string) => {
    onPick({ id, code, name, uom: u });
    setSearch("");
    setOpen(false);
  };

  const promote = async (label: string) => {
    setPromoting(label);
    setError(null);
    try {
      const res = await promoteLoosePartLabel(label);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      pickItem(res.item.id, res.item.code, res.item.name, res.item.uom);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create loose part");
    } finally {
      setPromoting(null);
    }
  };

  const hasItem = !!itemId;
  const showPending = !hasItem && !!pendingLabel && !resolving;
  const inSearch = !hasItem && !showPending;

  return (
    <div ref={containerRef} className="relative flex items-start gap-2">
      <div className="relative flex-1 min-w-0">
        {hasItem ? (
          <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-purple-300 bg-purple-50/40">
            <Puzzle className="h-3.5 w-3.5 text-purple-500 shrink-0" />
            <span className="text-sm font-medium truncate flex-1">{itemName}</span>
            <span className="text-[11px] font-mono text-[var(--muted-foreground)] shrink-0">
              {itemCode}
            </span>
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              title="Change loose part"
              className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer shrink-0"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : showPending ? (
          <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-amber-300 bg-amber-50/50">
            <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600 shrink-0">
              loose
            </span>
            <span className="text-sm truncate flex-1" title={pendingLabel ?? ""}>
              {pendingLabel}
            </span>
            <button
              type="button"
              onClick={() => {
                setResolving(true);
                setSearch(pendingLabel ?? "");
                setOpen(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              title="Link this loose part to a tracked item"
              className="text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer shrink-0"
            >
              Link
            </button>
          </div>
        ) : (
          <>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Search loose parts (program outputs)..."
              className="w-full h-8 pl-8 pr-7 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1"
            />
            {loading && (
              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
            )}
          </>
        )}

        {/* Dropdown */}
        {open && inSearch && (
          <div className="absolute z-50 mt-1 w-full min-w-[440px] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-80 overflow-y-auto">
            {error ? (
              <div className="px-3 py-3 text-xs flex items-start gap-1.5 text-[var(--destructive)]">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            {results.length === 0 && !error ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
                {loading
                  ? "Searching..."
                  : search
                    ? "No matching loose part on any program"
                    : "Type to search loose parts"}
              </div>
            ) : (
              results.map((c) =>
                c.kind === "item" ? (
                  <button
                    key={`i-${c.id}`}
                    type="button"
                    onClick={() => pickItem(c.id, c.code, c.name, c.uom)}
                    className="w-full text-left px-3 py-2 text-sm cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                  >
                    <div className="flex items-center gap-2">
                      <Puzzle className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                      <span className="font-medium leading-snug break-words flex-1">
                        {c.name}
                      </span>
                      <span className="text-[11px] font-mono text-[var(--muted-foreground)] shrink-0">
                        {c.code}
                      </span>
                    </div>
                  </button>
                ) : (
                  <button
                    key={`l-${c.label}`}
                    type="button"
                    disabled={!!promoting}
                    onClick={() => promote(c.label)}
                    className="w-full text-left px-3 py-2 text-sm cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)] disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2">
                      {promoting === c.label ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />
                      ) : (
                        <Plus className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      )}
                      <span className="font-medium leading-snug break-words flex-1">
                        {c.label}
                      </span>
                      <Badge variant="amber" className="text-[10px] uppercase tracking-wide px-1.5 shrink-0">
                        on {c.programs} program{c.programs === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)] pl-6">
                      Click to make it a tracked loose part and link those programs.
                    </div>
                  </button>
                ),
              )
            )}

            {/* Create-new escape hatch */}
            <button
              type="button"
              onClick={() => {
                onCreateNew(search);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm cursor-pointer bg-[var(--muted)]/40 hover:bg-[var(--muted)] border-t border-[var(--border)] sticky bottom-0 inline-flex items-center gap-1.5 text-[var(--primary)] font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              Create new loose part{search ? `: "${search}"` : ""}
            </button>
          </div>
        )}
      </div>

      {/* Qty */}
      <input
        type="number"
        min={0}
        step="any"
        inputMode="numeric"
        value={qty || ""}
        onChange={(e) => onQty(e.target.value ? Number(e.target.value) : 0)}
        disabled={!hasItem}
        placeholder="Qty"
        className="w-20 h-8 px-2 text-sm text-right rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1 disabled:opacity-50"
      />
      <span className="w-8 text-[11px] text-[var(--muted-foreground)] mt-2 text-center shrink-0">
        {uom || "—"}
      </span>

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
