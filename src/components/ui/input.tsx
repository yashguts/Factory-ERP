import { cn } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

// `size` on a native <input> is the (rarely used) character-width number; we
// reclaim it for our compact/standard control sizing and drop the native one.
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "md";
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, size = "md", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "flex w-full rounded-md border border-[var(--border)] bg-[var(--background)] text-sm shadow-[var(--shadow-xs)]",
          "placeholder:text-[var(--muted-foreground)]",
          "hover:border-[var(--border-strong)]",
          "focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1 focus:border-[var(--primary)]",
          "disabled:opacity-50 disabled:hover:border-[var(--border)]",
          "transition-colors duration-150",
          size === "sm" ? "h-8 px-2.5 py-1" : "h-10 px-3 py-2",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
