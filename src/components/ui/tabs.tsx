"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export interface TabItem {
  value: string;
  label: ReactNode;
  count?: number;
}

interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  /** "segmented" = pill group (filters); "underline" = classic tab bar. */
  variant?: "segmented" | "underline";
  className?: string;
}

/**
 * One keyboard-navigable tab/segmented primitive with optional count badges,
 * controlled by value/onChange so it stays URL-state friendly. Replaces the
 * 3+ bespoke tab bars (MRP, jobs, weekly, programs, BOM view toggle).
 */
export function Tabs({ tabs, value, onChange, variant = "segmented", className }: TabsProps) {
  if (variant === "underline") {
    return (
      <div
        role="tablist"
        className={cn("flex items-center gap-4 border-b border-[var(--border)]", className)}
      >
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.value)}
              className={cn(
                "relative -mb-px flex items-center gap-1.5 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer",
                active
                  ? "border-[var(--primary)] text-[var(--foreground)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              {t.label}
              {t.count !== undefined && (
                <span
                  className={cn(
                    "text-xs",
                    active ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-0.5",
        className
      )}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap",
              active
                ? "bg-[var(--background)] text-[var(--foreground)] shadow-[var(--shadow-xs)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="text-xs text-[var(--muted-foreground)]">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
