"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { readParam, useUrlListSync } from "@/lib/hooks/use-url-list-state";
import {
  Search,
  Loader2,
  Boxes,
  Puzzle,
  ArrowRight,
  ShoppingCart,
  Layers3,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import type { SubassemblyRow } from "@/lib/actions/item-bom";
import { cn } from "@/lib/utils";

interface Props {
  rows: SubassemblyRow[];
}

export function SubassembliesClient({ rows }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [filter, setFilter] = useState(() => readParam(sp, "q", ""));
  useUrlListSync({ q: filter }, { q: "" });

  const filtered = filter.trim()
    ? rows.filter((r) => {
        const tokens = filter.toLowerCase().split(/\s+/).filter(Boolean);
        const hay = `${r.name} ${r.code} ${r.family ?? ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
    : rows;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Sub-assemblies</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Items that are built from other parts. Define one at a time — pick an
          item below to lay out its parts list, and it shows up here.
        </p>
      </div>

      {/* Start defining a new sub-assembly */}
      <DefineSearch
        onPick={(item) => router.push(`/inventory/${item.id}`)}
      />

      {/* Existing sub-assemblies */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-[var(--muted-foreground)]">
            {rows.length === 0
              ? "No sub-assemblies defined yet"
              : `${rows.length} sub-assembl${rows.length === 1 ? "y" : "ies"} defined`}
          </h2>
          {rows.length > 0 && (
            <div className="relative w-64 max-w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter the list..."
                className="w-full h-8 pl-8 pr-3 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1"
              />
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="card-surface p-8 text-center">
            <Layers3 className="h-8 w-8 mx-auto text-[var(--muted-foreground)] opacity-50" />
            <p className="text-sm text-[var(--muted-foreground)] mt-3 max-w-md mx-auto">
              Search for any made item above and define what it is built from
              (stocked sub-parts) and its assembly parts (loose parts cut on
              programs). Saved structures appear here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-surface p-6 text-center text-sm text-[var(--muted-foreground)]">
            No sub-assembly matches that filter.
          </div>
        ) : (
          <div className="card-surface overflow-hidden divide-y divide-[var(--border)]">
            {filtered.map((r) => (
              <Link
                key={r.id}
                href={`/inventory/${r.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--muted)]/50 transition-colors cursor-pointer group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{r.name}</span>
                    {r.family && (
                      <Badge variant="neutral" title="Finish family">
                        {r.family}
                        {r.finish ? ` · ${r.finish}` : ""}
                      </Badge>
                    )}
                    {r.effective_procurement_type === "trade" && (
                      <Badge variant="amber">
                        <ShoppingCart className="h-3 w-3 mr-1" />
                        bought?
                      </Badge>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-[var(--muted-foreground)]">
                    {r.code}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs text-[var(--muted-foreground)]">
                  {r.built_count > 0 && (
                    <span
                      className="inline-flex items-center gap-1"
                      title="Built from (stocked sub-parts)"
                    >
                      <Boxes className="h-3.5 w-3.5" />
                      {r.built_count}
                    </span>
                  )}
                  {r.loose_count > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-purple-600"
                      title="Assembly parts (loose parts)"
                    >
                      <Puzzle className="h-3.5 w-3.5" />
                      {r.loose_count}
                    </span>
                  )}
                  <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--primary)]" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Search any inventory item and jump to its detail page to define structure. */
function DefineSearch({ onPick }: { onPick: (item: SearchableItem) => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const doSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const data = await searchItems(query, undefined, 20);
        if (seqRef.current === seq) setResults(data);
      } finally {
        if (seqRef.current === seq) setLoading(false);
      }
    }, 250);
  }, []);

  useEffect(() => {
    if (open) doSearch(search);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, search, doSearch]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} className="card-surface p-4">
      <label className="text-xs font-semibold text-[var(--muted-foreground)] flex items-center gap-1.5 mb-2">
        <Boxes className="h-3.5 w-3.5" /> Define a sub-assembly
      </label>
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)] pointer-events-none" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search an item (a door, a frame, a car...) to lay out its parts"
          className="w-full h-10 pl-9 pr-9 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
        )}

        {open && search.trim() && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-80 overflow-y-auto">
            {results.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
                {loading ? "Searching..." : "No items found"}
              </div>
            ) : (
              results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onPick(item)}
                  className="w-full text-left px-3 py-2 text-sm cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                >
                  <div className="font-medium leading-snug break-words">
                    {item.name}
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--muted-foreground)]",
                    )}
                  >
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
    </div>
  );
}
