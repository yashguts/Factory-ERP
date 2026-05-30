import { cn } from "@/lib/utils";
import { SelectHTMLAttributes, forwardRef } from "react";

const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          "flex h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm shadow-[var(--shadow-xs)] cursor-pointer",
          "hover:border-[var(--border-strong)]",
          "focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1 focus:border-[var(--primary)]",
          "disabled:opacity-50 disabled:cursor-default disabled:hover:border-[var(--border)]",
          "transition-colors duration-150",
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";

export { Select };
