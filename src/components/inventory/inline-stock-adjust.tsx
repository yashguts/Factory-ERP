"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PackagePlus } from "lucide-react";
import { recordTransaction } from "@/lib/actions/inventory";
import type { Warehouse } from "@/lib/supabase/types";

interface InlineStockAdjustProps {
  item: {
    id: string;
    code: string;
    name: string;
    lookup_key: string | null;
    uom: { id: string; abbreviation: string } | null;
  };
  warehouses: Warehouse[];
  onSuccess: () => void;
}

export function InlineStockAdjust({ item, warehouses, onSuccess }: InlineStockAdjustProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [quantity, setQuantity] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        !wrapperRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.stopImmediatePropagation();
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", handleEsc, true);
    return () => document.removeEventListener("keydown", handleEsc, true);
  }, [isOpen]);

  const toggleOpen = () => {
    if (!isOpen && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const popoverHeight = 260; // approximate popover height
      const spaceBelow = window.innerHeight - rect.bottom;
      const flipUp = spaceBelow < popoverHeight;
      setPopoverPos({
        top: flipUp ? rect.top - popoverHeight - 4 : rect.bottom + 4,
        left: Math.max(8, rect.right - 272), // 272 = w-68 = 17rem
      });
    }
    if (isOpen) {
      setIsOpen(false);
    } else {
      setIsOpen(true);
      setError(null);
      setQuantity(0);
      setNotes("");
      setDirection("add");
      setTimeout(() => quantityRef.current?.focus(), 50);
    }
  };

  const handleSubmit = () => {
    if (quantity <= 0) {
      setError("Quantity must be greater than 0");
      return;
    }
    if (warehouses.length === 0) {
      setError("No warehouse configured");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        await recordTransaction({
          item_id: item.id,
          warehouse_id: warehouses[0].id,
          transaction_type: direction === "add" ? "purchase_in" : "production_out",
          quantity,
          notes: notes || undefined,
        });
        setIsOpen(false);
        setQuantity(0);
        setNotes("");
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to record transaction");
      }
    });
  };

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleOpen();
        }}
        className="p-1 rounded hover:bg-[var(--muted)] transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        title="Quick stock adjust"
      >
        <PackagePlus size={15} />
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          className="fixed z-[200] w-68 rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-xl"
          style={{ top: popoverPos.top, left: popoverPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-3 space-y-3">
            {/* Item header */}
            <div className="text-xs text-[var(--muted-foreground)] truncate">
              <span className="font-mono">{item.code}</span>
              {" — "}
              <span className="font-medium text-[var(--foreground)]">
                {item.lookup_key || item.name}
              </span>
            </div>

            {/* Direction toggle */}
            <div className="flex gap-1">
              <button
                type="button"
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  direction === "add"
                    ? "bg-green-600 text-white"
                    : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
                onClick={() => setDirection("add")}
              >
                + Add
              </button>
              <button
                type="button"
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  direction === "remove"
                    ? "bg-red-600 text-white"
                    : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
                onClick={() => setDirection("remove")}
              >
                - Remove
              </button>
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-xs font-medium mb-1">
                Quantity {item.uom ? `(${item.uom.abbreviation})` : ""}
              </label>
              <Input
                ref={quantityRef}
                type="number"
                value={quantity || ""}
                onChange={(e) => setQuantity(Number(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                min={0.001}
                step="1"
                placeholder="Enter quantity"
                className="h-8 text-sm"
              />
            </div>

            {/* Notes */}
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />

            {/* Error */}
            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={() => setIsOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant={direction === "remove" ? "destructive" : "primary"}
                className="flex-1"
                onClick={handleSubmit}
                disabled={isPending || quantity <= 0}
              >
                {isPending
                  ? "Saving..."
                  : direction === "add"
                  ? "Add Stock"
                  : "Remove Stock"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
