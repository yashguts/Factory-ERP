"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { recordTransaction } from "@/lib/actions/inventory";
import type { TransactionType, Warehouse } from "@/lib/supabase/types";

interface StockAdjustModalProps {
  items: { id: string; code: string; name: string }[];
  warehouses: Warehouse[];
  onClose: () => void;
  onSaved: () => void;
}

function ItemSearchSelect({
  items,
  value,
  onChange,
}: {
  items: { id: string; code: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedItem = items.find((i) => i.id === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 50);
    const q = query.toLowerCase();
    return items
      .filter(
        (i) =>
          i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [query, items]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [filtered]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightIdx]) {
        onChange(filtered[highlightIdx].id);
        setQuery("");
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      {/* Display selected item or search input */}
      {value && !open ? (
        <div
          className="flex items-center justify-between h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm cursor-pointer"
          onClick={() => {
            setQuery("");
            setOpen(true);
          }}
        >
          <span className="truncate">
            <span className="text-[var(--muted-foreground)]">{selectedItem?.code}</span>
            {" — "}
            {selectedItem?.name}
          </span>
          <button
            type="button"
            className="ml-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setQuery("");
              setOpen(true);
            }}
          >
            &times;
          </button>
        </div>
      ) : (
        <Input
          autoFocus
          placeholder="Search by name or code..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="h-9"
        />
      )}

      {/* Dropdown */}
      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-[var(--muted-foreground)]">
              No items found
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={item.id}
                className={`px-3 py-2 text-sm cursor-pointer ${
                  idx === highlightIdx
                    ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                    : "hover:bg-[var(--accent)]/50"
                }`}
                onMouseEnter={() => setHighlightIdx(idx)}
                onClick={() => {
                  onChange(item.id);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="text-[var(--muted-foreground)]">{item.code}</span>
                {" — "}
                {item.name}
              </div>
            ))
          )}
          {!query.trim() && items.length > 50 && (
            <div className="px-3 py-1.5 text-xs text-[var(--muted-foreground)] border-t border-[var(--border)]">
              Type to search all {items.length} items...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function StockAdjustModal({ items, warehouses, onClose, onSaved }: StockAdjustModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    item_id: "",
    warehouse_id: "",
    transaction_type: "purchase_in" as TransactionType,
    quantity: 0,
    notes: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.item_id || !form.warehouse_id || form.quantity <= 0) {
      setError("Please fill all required fields with valid values");
      return;
    }

    startTransition(async () => {
      try {
        await recordTransaction({
          item_id: form.item_id,
          warehouse_id: form.warehouse_id,
          transaction_type: form.transaction_type,
          quantity: form.quantity,
          notes: form.notes || undefined,
        });
        onSaved();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to record transaction");
      }
    });
  };

  return (
    <Modal title="Stock Adjustment" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-sm bg-red-50 text-red-700 rounded-md border border-red-200">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Item</label>
          <ItemSearchSelect
            items={items}
            value={form.item_id}
            onChange={(id) => setForm({ ...form, item_id: id })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Warehouse</label>
          <Select
            value={form.warehouse_id}
            onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
            required
          >
            <option value="">Select warehouse</option>
            {warehouses.map((wh) => (
              <option key={wh.id} value={wh.id}>{wh.name}</option>
            ))}
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Transaction Type</label>
          <Select
            value={form.transaction_type}
            onChange={(e) => setForm({ ...form, transaction_type: e.target.value as TransactionType })}
          >
            <option value="purchase_in">Purchase In</option>
            <option value="production_in">Production In</option>
            <option value="production_out">Production Out (deducts)</option>
            <option value="adjustment">Adjustment</option>
            <option value="transfer">Transfer</option>
            <option value="scrap">Scrap (deducts)</option>
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Quantity</label>
          <Input
            type="number"
            value={form.quantity || ""}
            onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            required
            min={0.001}
            step="0.001"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <Input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="e.g., Invoice #1234, PO reference"
          />
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border)]">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Recording..." : "Record Transaction"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
