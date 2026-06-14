"use client";

import { cn } from "@/lib/utils";
import {
  HTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
  createContext,
  forwardRef,
  useContext,
} from "react";

// Density is set once on <Table> and read by every cell/head via context, so a
// data-heavy list flips to compact with a single prop. Default stays
// "comfortable" (the original px-4 py-3 / h-10 chrome) so no existing table
// shifts until it explicitly opts in.
type Density = "comfortable" | "compact";
const DensityContext = createContext<Density>("comfortable");

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  density?: Density;
  /** className for the scroll wrapper (e.g. max-height for a sticky header). */
  wrapperClassName?: string;
}

const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, density = "comfortable", wrapperClassName, ...props }, ref) => (
    <DensityContext.Provider value={density}>
      <div className={cn("w-full overflow-auto", wrapperClassName)}>
        <table
          ref={ref}
          className={cn("w-full caption-bottom text-sm", className)}
          {...props}
        />
      </div>
    </DensityContext.Provider>
  )
);
Table.displayName = "Table";

interface TableHeaderProps extends HTMLAttributes<HTMLTableSectionElement> {
  /** Pin the header row while the body scrolls. */
  sticky?: boolean;
}

const TableHeader = forwardRef<HTMLTableSectionElement, TableHeaderProps>(
  ({ className, sticky, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn(
        "border-b border-[var(--border)] bg-[var(--muted)]/50",
        sticky && "sticky top-0 z-10 backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
);
TableHeader.displayName = "TableHeader";

const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  )
);
TableBody.displayName = "TableBody";

const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-[var(--border)] hover:bg-[var(--muted)]/60 transition-colors",
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => {
    const density = useContext(DensityContext);
    return (
      <th
        ref={ref}
        className={cn(
          "text-left align-middle font-semibold uppercase tracking-wider text-[var(--muted-foreground)]",
          density === "compact"
            ? "h-8 px-3 text-[11px]"
            : "h-10 px-4 text-xs",
          className
        )}
        {...props}
      />
    );
  }
);
TableHead.displayName = "TableHead";

const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => {
    const density = useContext(DensityContext);
    return (
      <td
        ref={ref}
        className={cn(
          "align-middle",
          density === "compact" ? "px-3 py-1.5 text-[13px]" : "px-4 py-3",
          className
        )}
        {...props}
      />
    );
  }
);
TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
