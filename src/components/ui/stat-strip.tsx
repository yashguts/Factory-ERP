import { cn } from "@/lib/utils";
import { ReactNode } from "react";

type Tone = "default" | "primary" | "ok" | "warn" | "danger";

const toneClass: Record<Tone, string> = {
  default: "text-[var(--foreground)]",
  primary: "text-[var(--primary)]",
  ok: "text-[var(--success)]",
  warn: "text-[var(--warning)]",
  danger: "text-[var(--destructive)]",
};

/**
 * Compact horizontal metric strip: a row of label/value pairs divided by thin
 * borders. Replaces the text-2xl/p-4 summary-card grids (MRP, make-plan, weekly,
 * daily-runs, unmatched) — recovers ~80px of vertical space per page.
 */
export function StatStrip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-stretch rounded-lg border border-[var(--border)] bg-[var(--card)] divide-x divide-[var(--border)] overflow-hidden",
        className
      )}
    >
      {children}
    </div>
  );
}

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  tone?: Tone;
  sub?: ReactNode;
  className?: string;
}

export function StatTile({ label, value, tone = "default", sub, className }: StatTileProps) {
  return (
    <div className={cn("px-4 py-2 min-w-[7rem] flex-1", className)}>
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)] whitespace-nowrap">
        {label}
      </div>
      <div className={cn("text-base font-semibold leading-snug", toneClass[tone])}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{sub}</div>
      )}
    </div>
  );
}
