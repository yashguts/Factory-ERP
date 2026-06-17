"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import type { CabinFinishJobQty } from "@/lib/actions/cabin-jobs";

/**
 * Hover popover listing the cabin jobs that need a given item, each with its qty.
 * The data is already loaded with the page (getCabinFinishRequirement), so unlike
 * the MRP popover this one needs no fetch — the jobs are passed straight in.
 */
export function CabinJobsPopover({
  itemName,
  jobs,
  children,
}: {
  itemName: string;
  jobs: CabinFinishJobQty[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const leave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
    >
      {children}
      {open && jobs.length > 0 && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-[300px] rounded-md border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-lg)] text-left"
          onMouseEnter={enter}
          onMouseLeave={leave}
        >
          <div className="px-3 py-2 border-b border-[var(--border)]">
            <div className="text-xs text-[var(--muted-foreground)]">Jobs needing</div>
            <div className="text-sm font-medium truncate" title={itemName}>{itemName}</div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-[var(--muted)]/40 sticky top-0">
                <tr>
                  <th className="text-left font-medium px-3 py-1.5">Job</th>
                  <th className="text-right font-medium px-3 py-1.5 pr-3">Qty</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr
                    key={j.job_id}
                    className="border-t border-[var(--border)] hover:bg-[var(--muted)]/40 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/cabin-jobs/${j.job_id}`);
                    }}
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <span className="font-mono font-medium">{j.job_number}</span>
                        <ExternalLink className="h-3 w-3 opacity-50" />
                      </div>
                      {j.customer_name && (
                        <div className="text-[10px] text-[var(--muted-foreground)] truncate max-w-[180px]">
                          {j.customer_name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 pr-3 text-right tabular-nums">{j.qty.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </span>
  );
}
