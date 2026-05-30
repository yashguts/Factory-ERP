import { cn } from "@/lib/utils";
import { HTMLAttributes, forwardRef } from "react";

type BadgeVariant =
  | "neutral"
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "purple"
  | "pink"
  | "cyan"
  | "success"
  | "warning"
  | "danger";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Render as a small dot instead of text */
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  neutral: "bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
  pink: "bg-pink-50 text-pink-700 border-pink-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  success: "bg-[var(--success-bg)] text-[var(--success)] border-[var(--success-border)]",
  warning: "bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning-border)]",
  danger: "bg-[var(--destructive-bg)] text-[var(--destructive)] border-[var(--destructive-border)]",
};

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "neutral", dot, children, ...props }, ref) => {
    if (dot) {
      return (
        <span
          ref={ref}
          className={cn(
            "inline-block h-2 w-2 rounded-full",
            {
              "bg-[var(--muted-foreground)]": variant === "neutral",
              "bg-blue-500": variant === "blue",
              "bg-emerald-500": variant === "green" || variant === "success",
              "bg-amber-500": variant === "amber" || variant === "warning",
              "bg-red-500": variant === "red" || variant === "danger",
              "bg-purple-500": variant === "purple",
              "bg-pink-500": variant === "pink",
              "bg-cyan-500": variant === "cyan",
            },
            className
          )}
          {...props}
        />
      );
    }

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap",
          variantStyles[variant],
          className
        )}
        {...props}
      >
        {children}
      </span>
    );
  }
);
Badge.displayName = "Badge";

export { Badge };
export type { BadgeVariant };
