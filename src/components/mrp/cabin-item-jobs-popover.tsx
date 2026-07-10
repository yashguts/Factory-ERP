"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ExternalLink } from "lucide-react";
import { getCabinItemJobs, type CabinItemJob } from "@/lib/actions/cabin-mrp";

interface Props {
  itemId: string;
  itemName: string;
  /** Explicit ?jobs= scope (empty = the default eligibility gate). */
  jobIds: string[];
  /** The trigger element — receives the hover/focus events. */
  children: React.ReactNode;
}

/**
 * Hover popover for the Cabin MRP Requirements table: every scoped cabin job
 * that demands the given item, with per-job line count and quantity.
 * Lazy-fetches on first open; cached until the item or scope changes.
 * Same pattern as MrpJobsPopover, but rows navigate to /cabin-jobs/{id}.
 */
export function CabinItemJobsPopover({ itemId, itemName, jobIds, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CabinItemJob[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const hasFetched = useRef(false);
  const scopeKey = useMemo(() => [...jobIds].sort().join(","), [jobIds]);

  // Not remounted when the scope picker changes (same route) — drop the cache
  // so the next hover refetches for the new scope.
  useEffect(() => {
    hasFetched.current = false;
    setData(null);
    setError(null);
  }, [itemId, scopeKey]);

  const fetchData = useCallback(async () => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    setLoading(true);
    try {
      const result = await getCabinItemJobs(itemId, jobIds);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
      hasFetched.current = false; // allow retry
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, scopeKey]);

  const handleEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
    fetchData();
  };

  // Small delay before close so the cursor can travel onto the popover.
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
      className="relative inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-[320px] rounded-md border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-lg)] text-left font-normal"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <div className="px-3 py-2 border-b border-[var(--border)]">
            <div className="text-xs text-[var(--muted-foreground)]">Cabin jobs requiring</div>
            <div className="text-sm font-medium truncate" title={itemName}>
              {itemName}
            </div>
          </div>

          {loading ? (
            <div className="px-3 py-4 flex items-center justify-center text-xs text-[var(--muted-foreground)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              Loading…
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-xs text-[var(--destructive)]">{error}</div>
          ) : !data || data.length === 0 ? (
            <div className="px-3 py-3 text-xs text-[var(--muted-foreground)]">
              No cabin jobs in the current scope require this item.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-[var(--muted)]/40 sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-3 py-1.5">Cabin job</th>
                    <th className="text-right font-medium px-3 py-1.5">Lines</th>
                    <th className="text-right font-medium px-3 py-1.5 pr-3">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr
                      key={row.cabin_job_id}
                      className="border-t border-[var(--border)] hover:bg-[var(--muted)]/40 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/cabin-jobs/${row.cabin_job_id}`);
                      }}
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1">
                          <span className="font-mono font-medium">{row.job_number}</span>
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
                        {row.total_qty.toLocaleString()}
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
