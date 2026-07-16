"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ExternalLink } from "lucide-react";
import {
  getMrpItemJobs,
  type MrpJobBreakdown,
} from "@/lib/actions/mrp";

interface Props {
  itemId: string;
  itemName: string;
  uom: string | null;
  cutoffDate?: string;
  /** Explicit ?jobs=/?set= scope the table was computed for — the popover
   *  must ask for the same scope so its list sums to the row it annotates. */
  jobIds?: string[];
  /**
   * Element to attach the popover to. The child is the trigger and
   * receives the hover/focus events.
   */
  children: React.ReactNode;
}

/**
 * Hover popover showing every job that requires the given item, with
 * per-job line count and total quantity. Lazy-fetches on first open and
 * caches the result for the lifetime of the component.
 */
export function MrpJobsPopover({
  itemId,
  itemName,
  uom,
  cutoffDate,
  jobIds,
  children,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MrpJobBreakdown[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const hasFetched = useRef(false);

  // Value-stable key so a re-render with an equal jobIds array doesn't
  // invalidate the cached breakdown.
  const scopeKey = jobIds && jobIds.length ? [...jobIds].sort().join(",") : "";

  // The component is NOT remounted when the date filter or job scope changes
  // (same route, router.push) — drop the cached breakdown so the next hover
  // refetches with the new scope instead of showing the previous list.
  useEffect(() => {
    hasFetched.current = false;
    setData(null);
    setError(null);
  }, [itemId, cutoffDate, scopeKey]);

  const fetchData = useCallback(async () => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    setLoading(true);
    try {
      const result = await getMrpItemJobs(
        itemId,
        cutoffDate,
        scopeKey ? scopeKey.split(",") : undefined,
      );
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
      hasFetched.current = false; // allow retry
    } finally {
      setLoading(false);
    }
  }, [itemId, cutoffDate, scopeKey]);

  const handleEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
    fetchData();
  };

  // Small delay before close so the user can move their cursor onto
  // the popover without it vanishing under them.
  const handleLeave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <span
      ref={wrapRef}
      className="relative inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-[340px] rounded-md border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-lg)] text-left"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-[var(--border)]">
            <div className="text-xs text-[var(--muted-foreground)]">
              Jobs requiring
            </div>
            <div className="text-sm font-medium truncate" title={itemName}>
              {itemName}
            </div>
          </div>

          {/* Body */}
          {loading ? (
            <div className="px-3 py-4 flex items-center justify-center text-xs text-[var(--muted-foreground)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              Loading…
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-xs text-[var(--destructive)]">{error}</div>
          ) : !data || data.length === 0 ? (
            <div className="px-3 py-3 text-xs text-[var(--muted-foreground)]">
              No jobs reference this item.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-[var(--muted)]/40 sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-3 py-1.5">
                      Job
                    </th>
                    <th className="text-right font-medium px-3 py-1.5">
                      Lines
                    </th>
                    <th className="text-right font-medium px-3 py-1.5 pr-3">
                      Qty
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr
                      key={row.job_id}
                      className="border-t border-[var(--border)] hover:bg-[var(--muted)]/40 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/jobs/${row.job_id}`);
                      }}
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1">
                          <span className="font-mono font-medium">
                            {row.job_number}
                          </span>
                          <ExternalLink className="h-3 w-3 opacity-50" />
                        </div>
                        {row.customer_name && (
                          <div className="text-[10px] text-[var(--muted-foreground)] truncate max-w-[180px]">
                            {row.customer_name}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {row.line_count.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 pr-3 text-right tabular-nums">
                        {row.total_quantity.toLocaleString()}
                        {uom && (
                          <span className="text-[10px] text-[var(--muted-foreground)] ml-0.5">
                            {uom}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
