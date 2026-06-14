import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * One compact, action-oriented empty state. Replaces the ad-hoc p-12/p-8
 * "No items match" blocks scattered across the list pages.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-10 px-4",
        className
      )}
    >
      {icon && <div className="mb-2 text-[var(--muted-foreground)]">{icon}</div>}
      <div className="text-sm font-medium text-[var(--foreground)]">{title}</div>
      {description && (
        <div className="mt-1 text-sm text-[var(--muted-foreground)] max-w-sm">
          {description}
        </div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
