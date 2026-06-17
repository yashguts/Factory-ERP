"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { searchItems, type SearchableItem } from "@/lib/actions/items";

/**
 * Server-backed item search-picker (mirrors the stock-adjust modal). Searches
 * via `searchItems` on a debounce, with keyboard nav and a fixed-position
 * dropdown. Shared by the Add-PO form and the PO detail "Add item" bar.
 */
export function ItemPicker({
  value,
  onPick,
}: {
  value: SearchableItem | null;
  onPick: (item: SearchableItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await searchItems(query, undefined, 30);
        if (!cancelled) { setResults(res); setHi(0); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const choose = (item: SearchableItem) => {
    onPick(item);
    setQuery("");
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[hi]) choose(results[hi]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  const reopen = () => { setQuery(""); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); };

  return (
    <div ref={wrapRef} className="relative">
      {value && !open ? (
        <div
          className="flex items-center justify-between h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm cursor-pointer"
          onClick={reopen}
        >
          <span className="truncate">
            <span className="font-mono text-[var(--muted-foreground)]">{value.code}</span>
            {" — "}{value.name}
          </span>
          <span className="ml-2 shrink-0 text-[11px] text-[var(--muted-foreground)]">change</span>
        </div>
      ) : (
        <Input
          ref={inputRef}
          size="sm"
          placeholder="Search item by name, code, or lookup key…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
      )}
      {open && (
        <div
          ref={listRef}
          className="fixed z-[200] max-h-60 overflow-auto rounded-md border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-xl)]"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {loading && results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-[var(--muted-foreground)]">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-[var(--muted-foreground)]">No items found</div>
          ) : (
            results.map((item, idx) => (
              <div
                key={item.id}
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                  idx === hi ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--foreground)] hover:bg-[var(--muted)]"
                }`}
                onMouseEnter={() => setHi(idx)}
                onClick={() => choose(item)}
              >
                <span className={idx === hi ? "opacity-80" : "text-[var(--muted-foreground)]"}>{item.code}</span>
                {" — "}{item.name}
                <span className={idx === hi ? "opacity-70" : "text-[var(--muted-foreground)]"}> · stock {item.total_stock.toLocaleString()}{item.uom_abbreviation ? ` ${item.uom_abbreviation}` : ""}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
