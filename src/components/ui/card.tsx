import { cn } from "@/lib/utils";
import { HTMLAttributes, ReactNode, forwardRef } from "react";

/** Standard elevated surface (tokens: border + radius + shadow). No padding —
 *  pair with CardBody, or with a SectionHeader for titled cards. */
const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("card-surface overflow-hidden", className)} {...props} />
  )
);
Card.displayName = "Card";

function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-3", className)} {...props} />;
}

interface SectionHeaderProps {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Thin titled bar for the top of a card / BOM phase / parts block. */
function SectionHeader({ title, count, actions, className }: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/30",
        className
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold truncate">{title}</span>
        {count !== undefined && count !== null && (
          <span className="text-xs text-[var(--muted-foreground)] shrink-0">{count}</span>
        )}
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  );
}

export { Card, CardBody, SectionHeader };
