import { cn } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm shadow-[var(--shadow-xs)]",
          "placeholder:text-[var(--muted-foreground)]",
          "hover:border-[var(--border-strong)]",
          "focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1 focus:border-[var(--primary)]",
          "disabled:opacity-50 disabled:hover:border-[var(--border)]",
          "transition-colors duration-150",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
