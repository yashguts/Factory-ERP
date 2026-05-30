"use client";

import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useEffect } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ title, onClose, children, className }: ModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] cursor-pointer animate-fade-in"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-[60] bg-[var(--background)] rounded-lg border border-[var(--border)] w-full max-h-[90vh] overflow-y-auto cursor-default",
          "shadow-[var(--shadow-xl)] animate-scale-in",
          className ?? "max-w-lg"
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--background)] rounded-t-lg">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[var(--muted)] transition-colors cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
