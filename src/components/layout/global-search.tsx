"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  ClipboardList,
  Package,
  Cog,
  CornerDownLeft,
} from "lucide-react";
import { globalSearch, type GlobalSearchResult } from "@/lib/actions/search";
import { Badge } from "@/components/ui/badge";

/**
 * Ctrl+K / Cmd+K command palette: search jobs, items and programs from any
 * page and jump straight to them. The sidebar's "Search" button opens it
 * too (it dispatches the "open-global-search" event).
 */

const EMPTY: GlobalSearchResult = { jobs: [], items: [], programs: [] };

interface FlatRow {
  key: string;
  group: "Jobs" | "Items" | "Programs";
  title: string;
  meta: string;
  href: string;
  /** Make/Trade marker — items only. */
  mt?: "make" | "trade" | null;
}

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open via keyboard (Ctrl/Cmd+K) or the sidebar button's custom event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-global-search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-global-search", onOpen);
    };
  }, []);

  // Reset + focus when opening.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(EMPTY);
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced fan-out search; sequence id drops stale responses.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      try {
        const res = await globalSearch(query);
        if (seq === seqRef.current) {
          setResults(res);
          setHighlight(0);
        }
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  const rows: FlatRow[] = useMemo(() => {
    const out: FlatRow[] = [];
    for (const j of results.jobs) {
      out.push({
        key: `j-${j.id}`,
        group: "Jobs",
        title: `${j.job_number} — ${j.customer_name ?? "—"}`,
        meta: j.location ?? "",
        href: `/jobs/${j.id}`,
      });
    }
    for (const it of results.items) {
      out.push({
        key: `i-${it.id}`,
        group: "Items",
        title: it.name,
        meta: it.code,
        href: `/inventory/${it.id}`,
        mt: it.effective_procurement_type,
      });
    }
    for (const p of results.programs) {
      out.push({
        key: `p-${p.id}`,
        group: "Programs",
        title: p.name,
        meta: p.code ?? "",
        href: `/programs/${p.id}`,
      });
    }
    return out;
  }, [results]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  // Keyboard navigation inside the palette.
  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && rows[highlight]) {
      go(rows[highlight].href);
    }
  };

  if (!open) return null;

  const GROUP_ICON = {
    Jobs: ClipboardList,
    Items: Package,
    Programs: Cog,
  } as const;

  let lastGroup: string | null = null;

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/30 flex items-start justify-center pt-[12vh] px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="relative border-b border-[var(--border)]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
          {loading && (
            <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search jobs, items, programs…"
            className="w-full h-12 pl-11 pr-10 text-sm bg-transparent focus:outline-none"
          />
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {query.trim() === "" ? (
            <p className="px-4 py-6 text-sm text-[var(--muted-foreground)] text-center">
              Type a job number, customer, item name/code, or program…
            </p>
          ) : rows.length === 0 && !loading ? (
            <p className="px-4 py-6 text-sm text-[var(--muted-foreground)] text-center">
              No matches for &ldquo;{query}&rdquo;
            </p>
          ) : (
            rows.map((row, idx) => {
              const showHeader = row.group !== lastGroup;
              lastGroup = row.group;
              const Icon = GROUP_ICON[row.group];
              return (
                <div key={row.key}>
                  {showHeader && (
                    <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-1.5">
                      <Icon className="h-3 w-3" /> {row.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => go(row.href)}
                    onMouseEnter={() => setHighlight(idx)}
                    className={`w-full text-left px-4 py-2 flex items-center gap-3 cursor-pointer ${
                      idx === highlight ? "bg-[var(--muted)]" : ""
                    }`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate">{row.title}</span>
                    </span>
                    {row.mt && (
                      <Badge
                        variant={row.mt === "make" ? "blue" : "amber"}
                        className="text-[10px] px-1.5 shrink-0"
                        title={row.mt === "make" ? "Make — manufactured in-house" : "Trade — purchased from suppliers"}
                      >
                        {row.mt === "make" ? "M" : "T"}
                      </Badge>
                    )}
                    {row.meta && (
                      <span className="font-mono text-[11px] text-[var(--muted-foreground)] shrink-0">
                        {row.meta}
                      </span>
                    )}
                    {idx === highlight && (
                      <CornerDownLeft className="h-3.5 w-3.5 text-[var(--muted-foreground)] shrink-0" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[var(--border)] text-[11px] text-[var(--muted-foreground)] flex items-center gap-3">
          <span>↑↓ navigate</span>
          <span>Enter — open</span>
          <span>Esc — close</span>
        </div>
      </div>
    </div>
  );
}
