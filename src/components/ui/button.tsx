import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "destructive" | "ghost";
  size?: "sm" | "md" | "lg";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md font-medium transition-all duration-150 cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1",
          "disabled:opacity-50 disabled:pointer-events-none",
          {
            "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-xs)] hover:bg-[var(--primary-hover)] active:shadow-none":
              variant === "primary",
            "border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-xs)] hover:bg-[var(--muted)] hover:border-[var(--border-strong)] active:shadow-none":
              variant === "secondary",
            "bg-[var(--destructive)] text-[var(--destructive-foreground)] shadow-[var(--shadow-xs)] hover:bg-[#b91c1c] active:shadow-none":
              variant === "destructive",
            "hover:bg-[var(--muted)] active:bg-[var(--accent)]":
              variant === "ghost",
          },
          {
            "h-8 px-3 text-sm gap-1.5": size === "sm",
            "h-10 px-4 text-sm gap-2": size === "md",
            "h-12 px-6 text-base gap-2": size === "lg",
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
