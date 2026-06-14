import { cn } from "@/lib/utils";
import { SelectHTMLAttributes, forwardRef } from "react";

// `size` on a native <select> is the visible-rows number; we reclaim it for
// compact/standard control sizing to match Input and Button.
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: "sm" | "md";
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, size = "md", children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          "flex w-full rounded-md border border-[var(--border)] bg-[var(--background)] text-sm shadow-[var(--shadow-xs)] cursor-pointer",
          "hover:border-[var(--border-strong)]",
          "focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1 focus:border-[var(--primary)]",
          "disabled:opacity-50 disabled:cursor-default disabled:hover:border-[var(--border)]",
          "transition-colors duration-150",
          size === "sm" ? "h-8 px-2 py-1" : "h-10 px-3 py-2",
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
