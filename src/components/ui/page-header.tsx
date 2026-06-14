"use client";

import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  /** Inline muted text after the title (count, spec, etc.). */
  meta?: ReactNode;
  /** Secondary line below the title (detail pages). */
  subtitle?: ReactNode;
  icon?: ReactNode;
  /** Right-aligned action cluster (size="sm" buttons + overflow menu). */
  actions?: ReactNode;
  onBack?: () => void;
  className?: string;
}

/**
 * The single chrome band at the top of every list/detail page: optional Back +
 * icon + title, an inline muted count/meta, and a right-aligned actions slot.
 * Replaces the per-page text-2xl title blocks so density is consistent.
 */
export function PageHeader({
  title,
  meta,
  subtitle,
  icon,
  actions,
  onBack,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3 mb-4", className)}>
      <div className="flex items-center gap-2.5 min-w-0">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            className="shrink-0 p-1.5 -ml-1.5 rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        {icon && (
          <span className="shrink-0 text-[var(--muted-foreground)]">{icon}</span>
        )}
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
            {meta && (
              <span className="text-sm text-[var(--muted-foreground)]">{meta}</span>
            )}
          </div>
          {subtitle && (
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
