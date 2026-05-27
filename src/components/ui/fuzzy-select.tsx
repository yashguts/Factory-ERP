"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, X } from "lucide-react";

export interface FuzzySelectOption {
  value: string;
  label?: string;
  group?: string;
}

interface FuzzySelectProps {
  options: FuzzySelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Fuzzy-match scoring: split query into tokens, each token must appear
 * somewhere in the text (case-insensitive). Returns -1 for no match,
 * or a score ≥ 0 (lower = better match).
 */
function fuzzyScore(text: string, query: string): number {
  if (!query.trim()) return 0;
  const lower = text.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    const idx = lower.indexOf(token);
    if (idx === -1) return -1; // token not found → no match
    score += idx; // earlier positions score better
  }
  return score;
}

export function FuzzySelect({
  options,
  value,
  onChange,
  placeholder = "-- Select --",
  className,
  disabled,
}: FuzzySelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(() => {
    if (!value) return "";
    const opt = options.find((o) => o.value === value);
    return opt?.label ?? opt?.value ?? value;
  }, [value, options]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    return options
      .map((o) => ({
        option: o,
        score: fuzzyScore(o.label ?? o.value, search),
      }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.option);
  }, [options, search]);

  // Group filtered options
  const grouped = useMemo(() => {
    const groups = new Map<string, FuzzySelectOption[]>();
    for (const opt of filtered) {
      const g = opt.group ?? "";
      const arr = groups.get(g) ?? [];
      arr.push(opt);
      groups.set(g, arr);
    }
    return groups;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatFiltered = filtered;

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [filtered.length, search]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-option-idx]");
    const target = items[highlightIdx] as HTMLElement | undefined;
    target?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setSearch("");
    setHighlightIdx(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [disabled]);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setOpen(false);
      setSearch("");
    },
    [onChange],
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange("");
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, flatFiltered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (flatFiltered[highlightIdx]) {
          handleSelect(flatFiltered[highlightIdx].value);
        }
      } else if (e.key === "Escape") {
        setOpen(false);
        setSearch("");
      }
    },
    [flatFiltered, highlightIdx, handleSelect],
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          !value && "text-[var(--muted-foreground)]",
        )}
      >
        <span className="truncate text-left flex-1">
          {value ? selectedLabel : placeholder}
        </span>
        <span className="flex items-center gap-0.5 ml-1 shrink-0">
          {value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)]"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[280px] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg">
          {/* Search input */}
          <div className="p-1.5 border-b border-[var(--border)]">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type to search…"
              className="w-full h-7 px-2 text-sm rounded border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>

          {/* Options list */}
          <div
            ref={listRef}
            className="max-h-60 overflow-y-auto p-1"
          >
            {flatFiltered.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-[var(--muted-foreground)]">
                No matches found
              </div>
            ) : (
              Array.from(grouped.entries()).map(([group, opts]) => (
                <div key={group}>
                  {group && (
                    <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      {group}
                    </div>
                  )}
                  {opts.map((opt) => {
                    const flatIdx = flatFiltered.indexOf(opt);
                    const isHighlighted = flatIdx === highlightIdx;
                    const isSelected = opt.value === value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        data-option-idx={flatIdx}
                        onClick={() => handleSelect(opt.value)}
                        onMouseEnter={() => setHighlightIdx(flatIdx)}
                        className={cn(
                          "w-full text-left px-2 py-1.5 text-sm rounded cursor-pointer flex items-center gap-2",
                          isHighlighted
                            ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                            : "hover:bg-[var(--muted)]",
                          isSelected && !isHighlighted && "font-medium",
                        )}
                      >
                        {search ? (
                          <HighlightMatch
                            text={opt.label ?? opt.value}
                            query={search}
                            isHighlighted={isHighlighted}
                          />
                        ) : (
                          <span className="truncate">{opt.label ?? opt.value}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Highlights matched tokens in bold */
function HighlightMatch({
  text,
  query,
  isHighlighted,
}: {
  text: string;
  query: string;
  isHighlighted: boolean;
}) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return <span className="truncate">{text}</span>;

  // Find all match ranges
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    const idx = lower.indexOf(token);
    if (idx >= 0) ranges.push([idx, idx + token.length]);
  }
  // Sort and merge overlapping ranges
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    if (merged.length > 0 && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }

  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const [s, e] of merged) {
    if (s > last) parts.push(<span key={last}>{text.slice(last, s)}</span>);
    parts.push(
      <span
        key={`m${s}`}
        className={cn(
          "font-bold",
          isHighlighted ? "underline" : "text-[var(--primary)]",
        )}
      >
        {text.slice(s, e)}
      </span>,
    );
    last = e;
  }
  if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>);

  return <span className="truncate">{parts}</span>;
}
