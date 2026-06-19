"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { OPERATION_MACHINE_LABELS } from "@/lib/supabase/types";
import type { InventoryProgramRef } from "@/lib/actions/inventory";

/**
 * Hover popover listing the Programs (operations) mapped to an inventory item.
 * The programs are already loaded with the page row (attachItemPrograms), so —
 * like CabinJobsPopover — this needs no fetch; the list is passed straight in.
 * Each row links to the Programs page pre-filtered to that program's code.
 */
export function ProgramsPopover({
  programs,
  children,
}: {
  programs: InventoryProgramRef[];
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
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <span
      className="relative inline-block"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
    >
      {children}
      {open && programs.length > 0 && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-[320px] rounded-md border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-lg)] text-left"
          onMouseEnter={enter}
          onMouseLeave={leave}
        >
          <div className="px-3 py-2 border-b border-[var(--border)]">
            <div className="text-xs text-[var(--muted-foreground)]">
              {programs.length} program{programs.length === 1 ? "" : "s"} mapped to this item
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {programs.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-1.5 text-left first:border-t-0 hover:bg-[var(--muted)]/40"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/programs?q=${encodeURIComponent(p.code ?? p.name)}`);
                }}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1">
                    <span className="font-mono text-xs font-medium truncate" title={p.code ?? p.name}>
                      {p.code ?? p.name}
                    </span>
                    <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                  </span>
                  <span className="block text-[10px] text-[var(--muted-foreground)]">
                    {OPERATION_MACHINE_LABELS[p.machine] ?? p.machine}
                  </span>
                </span>
                <Badge
                  variant={p.role === "produces" ? "green" : "amber"}
                  className="shrink-0 text-[10px] px-1.5"
                >
                  {p.role === "produces" ? "produces" : "consumes"}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
