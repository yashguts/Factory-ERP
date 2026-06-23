"use client";

import { useState, useMemo, useEffect, type ReactNode } from "react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Search, Loader2 } from "lucide-react";
import { getJobs, getJobsImportMeta } from "@/lib/actions/jobs";
import type { JobImportMeta } from "@/lib/actions/jobs";
import type { Job } from "@/lib/supabase/types";
import { DRIVE_TYPES } from "@/lib/bom/section-gating";

interface Props {
  /** Called with the selected job's id. Caller fetches its template. */
  onPick: (jobId: string, jobNumber: string) => void;
  onClose: () => void;
}

/** Drive-type code -> friendly label (e.g. "HOME" -> "Home"). */
const DRIVE_LABELS: Record<string, string> = Object.fromEntries(
  DRIVE_TYPES.map((d) => [d.value, d.label]),
);

/** Leading integer of a value like "10PASS" / "1000KG", for numeric sorting. */
function leadingNum(s: string): number {
  const m = s.match(/^\d+/);
  return m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
}

/** Wrap the earliest-matching search token inside `text` in a subtle highlight. */
function highlightMatch(text: string, tokens: string[]): ReactNode {
  if (tokens.length === 0) return text;
  const lower = text.toLowerCase();
  let best: { start: number; len: number } | null = null;
  for (const t of tokens) {
    const idx = lower.indexOf(t);
    if (idx >= 0 && (best === null || idx < best.start))
      best = { start: idx, len: t.length };
  }
  if (!best) return text;
  return (
    <>
      {text.slice(0, best.start)}
      <span className="rounded-[2px] bg-yellow-400/30">
        {text.slice(best.start, best.start + best.len)}
      </span>
      {text.slice(best.start + best.len)}
    </>
  );
}

/**
 * Search & pick an existing job to template a new job's spec + BOM from.
 * Loads the full job list once on open (cached server-side) and filters
 * client-side: a multi-token fuzzy text box, structured spec facets (brand,
 * drive, door system, stops, capacity), and relevance ranking when searching.
 */
export function JobTemplatePickerModal({ onPick, onClose }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [meta, setMeta] = useState<Record<string, JobImportMeta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Spec facets — "" means "all".
  const [brand, setBrand] = useState("");
  const [drive, setDrive] = useState("");
  const [door, setDoor] = useState("");
  const [stops, setStops] = useState("");
  const [capacity, setCapacity] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [data, metaData] = await Promise.all([
          getJobs() as Promise<Job[]>,
          getJobsImportMeta(),
        ]);
        if (!cancelled) {
          setJobs(data);
          setMeta(metaData);
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load jobs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Facet option lists — derived from the loaded jobs so a dropdown only
  // appears, and only lists values, that actually exist.
  const brandOpts = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) if (j.brand) set.add(j.brand);
    return [...set].sort();
  }, [jobs]);

  const driveOpts = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) if (j.drive_type) set.add(j.drive_type);
    return [...set].sort((a, b) =>
      (DRIVE_LABELS[a] ?? a).localeCompare(DRIVE_LABELS[b] ?? b),
    );
  }, [jobs]);

  const doorOpts = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) {
      const d = meta[j.id]?.door;
      if (d) set.add(d);
    }
    return [...set].sort();
  }, [jobs, meta]);

  const stopsOpts = useMemo(() => {
    const set = new Set<number>();
    for (const j of jobs) if (j.floors != null) set.add(j.floors);
    return [...set].sort((a, b) => a - b);
  }, [jobs]);

  const capacityOpts = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) if (j.capacity) set.add(j.capacity);
    return [...set].sort((a, b) => leadingNum(a) - leadingNum(b) || a.localeCompare(b));
  }, [jobs]);

  const searchTokens = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    const matched = jobs.filter((job) => {
      // Structured facets (AND).
      if (brand && job.brand !== brand) return false;
      if (drive && job.drive_type !== drive) return false;
      if (door && meta[job.id]?.door !== door) return false;
      if (stops && String(job.floors) !== stops) return false;
      if (capacity && job.capacity !== capacity) return false;
      // Free-text: every token must appear somewhere in the haystack.
      if (searchTokens.length === 0) return true;
      const haystack = [
        job.job_number,
        job.customer_name,
        job.location,
        job.spec_string,
        job.brand,
        meta[job.id]?.door,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchTokens.every((t) => haystack.includes(t));
    });

    // Rank by relevance only when a text query is present; otherwise the
    // incoming created_at-desc order (newest first) is preserved.
    if (searchTokens.length === 0) return matched;
    const rank = (job: Job): number => {
      const num = job.job_number.toLowerCase();
      if (num === query) return 0;
      if (
        num.startsWith(query) ||
        (job.customer_name?.toLowerCase().startsWith(query) ?? false)
      )
        return 1;
      return 2;
    };
    return matched
      .map((job, i) => ({ job, i }))
      .sort((a, b) => rank(a.job) - rank(b.job) || a.i - b.i)
      .map((x) => x.job);
  }, [jobs, meta, search, searchTokens, brand, drive, door, stops, capacity]);

  const hasFilters = !!(search || brand || drive || door || stops || capacity);
  const clearAll = () => {
    setSearch("");
    setBrand("");
    setDrive("");
    setDoor("");
    setStops("");
    setCapacity("");
  };

  return (
    <Modal
      title="Import from Existing Job"
      onClose={onClose}
      size="lg"
    >
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-foreground)]">
          Pick a job to clone. Its elevator specification and all picked
          BOM items will be copied into this form. Job Details (number,
          customer, location, dates, stage) will <strong>not</strong> be
          touched — you fill those fresh.
        </p>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)] pointer-events-none" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by job number, customer, location, spec..."
            className="pl-9"
          />
        </div>

        {!loading && !error && jobs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {brandOpts.length > 0 && (
              <Select
                size="sm"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                title="Filter by brand"
                className="w-auto"
              >
                <option value="">All brands</option>
                {brandOpts.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            )}
            {driveOpts.length > 0 && (
              <Select
                size="sm"
                value={drive}
                onChange={(e) => setDrive(e.target.value)}
                title="Filter by drive type"
                className="w-auto"
              >
                <option value="">All drives</option>
                {driveOpts.map((d) => (
                  <option key={d} value={d}>
                    {DRIVE_LABELS[d] ?? d}
                  </option>
                ))}
              </Select>
            )}
            {doorOpts.length > 0 && (
              <Select
                size="sm"
                value={door}
                onChange={(e) => setDoor(e.target.value)}
                title="Filter by door system"
                className="w-auto"
              >
                <option value="">All doors</option>
                {doorOpts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            )}
            {stopsOpts.length > 0 && (
              <Select
                size="sm"
                value={stops}
                onChange={(e) => setStops(e.target.value)}
                title="Filter by stops"
                className="w-auto"
              >
                <option value="">All stops</option>
                {stopsOpts.map((n) => (
                  <option key={n} value={String(n)}>
                    {n} Stops
                  </option>
                ))}
              </Select>
            )}
            {capacityOpts.length > 0 && (
              <Select
                size="sm"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                title="Filter by capacity"
                className="w-auto"
              >
                <option value="">All capacity</option>
                {capacityOpts.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="ml-auto"
              >
                Clear
              </Button>
            )}
          </div>
        )}

        {!loading && !error && jobs.length > 0 && (
          <p className="text-xs text-[var(--muted-foreground)]">
            {filtered.length} of {jobs.length} job{jobs.length === 1 ? "" : "s"}
          </p>
        )}

        {loading ? (
          <div className="py-8 flex items-center justify-center text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading jobs...
          </div>
        ) : error ? (
          <p className="text-sm text-[var(--destructive)] text-center py-8">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
            {jobs.length === 0
              ? "No jobs exist yet — create one first, then you can clone it."
              : "No jobs match."}
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border)]">
            {filtered.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => onPick(job.id, job.job_number)}
                className="w-full text-left px-3 py-2.5 hover:bg-[var(--muted)] cursor-pointer"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono font-medium text-sm">
                    {highlightMatch(job.job_number, searchTokens)}
                  </span>
                  {job.spec_string && (
                    <span className="text-[11px] font-mono text-[var(--muted-foreground)]">
                      {job.spec_string}
                    </span>
                  )}
                </div>
                <div className="flex items-baseline justify-between gap-3 mt-0.5">
                  <span className="text-xs text-[var(--muted-foreground)] truncate">
                    {[job.customer_name, job.location].filter(Boolean).join(" · ") ||
                      "No customer / location"}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {meta[job.id]?.door && (
                      <Badge variant="neutral" className="text-[10px] px-1.5">
                        {meta[job.id].door}
                      </Badge>
                    )}
                    <span className="text-[10px] text-[var(--muted-foreground)] whitespace-nowrap">
                      {meta[job.id]?.items ?? 0} item
                      {(meta[job.id]?.items ?? 0) === 1 ? "" : "s"}
                    </span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
