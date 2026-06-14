"use client";

import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useEffect } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Width preset. A `max-w-*` in `className` still overrides this. */
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({ title, onClose, children, size = "md", className }: ModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] cursor-pointer animate-fade-in"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-[60] bg-[var(--background)] rounded-lg border border-[var(--border)] w-full max-h-[90vh] overflow-y-auto cursor-default",
          "shadow-[var(--shadow-xl)] animate-scale-in",
          SIZE_CLASS[size],
          className
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--background)] rounded-t-lg">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md hover:bg-[var(--muted)] transition-colors cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
