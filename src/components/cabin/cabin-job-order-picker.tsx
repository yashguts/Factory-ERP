"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Loader2, X, Briefcase } from "lucide-react";
import { searchJobOrders, type JobOrderOption } from "@/lib/actions/cabin-jobs";

interface Props {
  /** Currently selected job number ("" = nothing picked yet). */
  value: string;
  customer?: string | null;
  autoFocus?: boolean;
  onPick: (job: JobOrderOption) => void;
  onClear: () => void;
}

/**
 * Job-Order picker for the cabin-job form. A cabin job must match an existing
 * Job Order (jobs.job_number) — picking from this list instead of free-typing
 * makes typos impossible and auto-fills the customer. Server-side createCabinJob/
 * updateCabinJob also enforce the link.
 */
export function CabinJobOrderPicker({ value, customer, autoFocus, onPick, onClear }: Props) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<JobOrderOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const data = await searchJobOrders(q, 20);
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
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  if (value) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-[var(--success-border)] bg-[var(--success-bg)] min-w-0">
        <Briefcase className="h-3.5 w-3.5 text-[var(--success)] shrink-0" />
        <span className="text-sm font-medium truncate">{value}</span>
        {customer && (
          <span className="text-xs text-[var(--muted-foreground)] truncate">· {customer}</span>
        )}
        <button
          type="button"
          onClick={onClear}
          title="Change Job Order"
          className="ml-auto p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
      <input
        autoFocus={autoFocus}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search Job Orders by number or customer…"
        className="w-full h-9 pl-8 pr-7 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      />
      {loading && (
        <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[320px] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-center text-xs text-[var(--muted-foreground)]">
              {loading
                ? "Searching…"
                : search.trim()
                  ? "No Job Order matches — create it in Jobs first."
                  : "Type to search Job Orders."}
            </div>
          ) : (
            results.map((j) => (
              <button
                key={j.job_number}
                type="button"
                onClick={() => {
                  onPick(j);
                  setSearch("");
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{j.job_number}</span>
                  {j.requirement_dispatch_date && (
                    <span className="ml-auto text-[11px] text-[var(--muted-foreground)] tabular-nums shrink-0">
                      {j.requirement_dispatch_date}
                    </span>
                  )}
                </div>
                {j.customer_name && (
                  <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)] truncate">
                    {j.customer_name}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
