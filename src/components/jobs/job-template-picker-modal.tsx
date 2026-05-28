"use client";

import { useState, useMemo, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2 } from "lucide-react";
import { getJobs } from "@/lib/actions/jobs";
import type { Job } from "@/lib/supabase/types";

interface Props {
  /** Called with the selected job's id. Caller fetches its template. */
  onPick: (jobId: string, jobNumber: string) => void;
  onClose: () => void;
}

/**
 * Search & pick an existing job to template a new job's spec + BOM from.
 * Loads the full job list once on open (cached server-side) and filters
 * client-side with the same multi-token fuzzy logic used elsewhere.
 */
export function JobTemplatePickerModal({ onPick, onClose }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await getJobs()) as Job[];
        if (!cancelled) setJobs(data);
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

  const filtered = useMemo(() => {
    const tokens = search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return jobs;
    return jobs.filter((job) => {
      const haystack = [
        job.job_number,
        job.customer_name,
        job.location,
        job.spec_string,
        job.brand,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [jobs, search]);

  return (
    <Modal
      title="Import from Existing Job"
      onClose={onClose}
      className="max-w-2xl"
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

        {loading ? (
          <div className="py-8 flex items-center justify-center text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading jobs...
          </div>
        ) : error ? (
          <p className="text-sm text-red-600 text-center py-8">{error}</p>
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
                    {job.job_number}
                  </span>
                  {job.spec_string && (
                    <span className="text-[11px] font-mono text-[var(--muted-foreground)]">
                      {job.spec_string}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">
                  {[job.customer_name, job.location].filter(Boolean).join(" · ") ||
                    "No customer / location"}
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
