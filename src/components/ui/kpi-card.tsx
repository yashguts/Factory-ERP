import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Dashboard-style KPI card: a tinted icon chip + uppercase label + large value,
 * with an optional sub-line. Sits on its own elevated surface (vs the compact
 * {@link StatStrip} divided row). Use inside {@link KpiGrid}.
 */
type KpiTone = "default" | "primary" | "success" | "warning" | "danger";

const CHIP: Record<KpiTone, string> = {
  default: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  primary: "bg-[var(--accent)] text-[var(--primary)]",
  success: "bg-[var(--success-bg)] text-[var(--success)]",
  warning: "bg-[var(--warning-bg)] text-[var(--warning)]",
  danger: "bg-[var(--destructive-bg)] text-[var(--destructive)]",
};

export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 lg:grid-cols-4 gap-3", className)}>{children}</div>
  );
}

export function KpiCard({
  icon,
  label,
  value,
  sub,
  tone = "default",
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: KpiTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]",
        className,
      )}
    >
      {icon != null && (
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", CHIP[tone])}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)] truncate">{label}</div>
        <div className="text-xl font-semibold leading-tight truncate text-[var(--foreground)]">{value}</div>
        {sub != null && <div className="text-[11px] text-[var(--muted-foreground)] truncate mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}
