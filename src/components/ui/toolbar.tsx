import { cn } from "@/lib/utils";
import { ReactNode } from "react";

/**
 * A single horizontal band holding a list page's controls: search +
 * segmented control + a few size="sm" Selects + right-aligned actions. Replaces
 * the 2-3 stacked filter rows pages currently roll by hand. Use <ToolbarSpacer/>
 * to push trailing controls to the right.
 */
export function Toolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 flex-wrap mb-3", className)}>
      {children}
    </div>
  );
}

export function ToolbarSpacer() {
  return <div className="flex-1 min-w-2" />;
}
