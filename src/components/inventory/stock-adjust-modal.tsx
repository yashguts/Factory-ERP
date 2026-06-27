"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { recordTransaction } from "@/lib/actions/inventory";
import { useOperator } from "@/lib/jobs/use-operator";
import { searchItems, type SearchableItem } from "@/lib/actions/items";
import type { TransactionType, Warehouse } from "@/lib/supabase/types";

interface StockAdjustModalProps {
  warehouses: Warehouse[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Item picker backed by a server search (searchItems) rather than a client-side
 * array — so the modal works without shipping the whole item list to the browser.
 */
function ItemSearchSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [selected, setSelected] = useState<SearchableItem | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [open]);

  // Debounced server search while the dropdown is open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await searchItems(query, undefined, 50, { excludeCabin: true });
        if (!cancelled) {
          setResults(res);
          setHighlightIdx(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (!wrapperRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  const choose = (item: SearchableItem) => {
    onChange(item.id);
    setSelected(item);
    setQuery("");
    setOpen(false);
  };

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
      setHighlightIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlightIdx]) choose(results[highlightIdx]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  };

  const openAndFocus = () => {
    setQuery("");
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div ref={wrapperRef} className="relative">
      {value && selected && !open ? (
        <div
          className="flex items-center justify-between h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm cursor-pointer"
          onClick={openAndFocus}
        >
          <span className="truncate text-[var(--foreground)]">
            <span className="text-[var(--muted-foreground)]">{selected.code}</span>
            {" — "}
            {selected.name}
          </span>
          <button
            type="button"
            className="ml-2 flex-shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-lg leading-none cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setSelected(null);
              setQuery("");
              setOpen(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            &times;
          </button>
        </div>
      ) : (
        <Input
          ref={inputRef}
          placeholder="Search by name, code, or lookup key..."
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

      {open && (
        <div
          ref={listRef}
          className="fixed z-[200] max-h-60 overflow-auto rounded-md border border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow-xl)]"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          {loading && results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-[var(--muted-foreground)]">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-[var(--muted-foreground)]">No items found</div>
          ) : (
            results.map((item, idx) => (
              <div
                key={item.id}
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                  idx === highlightIdx
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "text-[var(--foreground)] hover:bg-[var(--muted)]"
                }`}
                onMouseEnter={() => setHighlightIdx(idx)}
                onClick={() => choose(item)}
              >
                <span className={idx === highlightIdx ? "opacity-80" : "text-[var(--muted-foreground)]"}>
                  {item.code}
                </span>
                {" — "}
                {item.name}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function StockAdjustModal({
  warehouses,
  onClose,
  onSaved,
}: StockAdjustModalProps) {
  const toast = useToast();
  const { ensureOperator } = useOperator();
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

    const operator = ensureOperator();
    startTransition(async () => {
      try {
        await recordTransaction({
          item_id: form.item_id,
          warehouse_id: form.warehouse_id,
          transaction_type: form.transaction_type,
          quantity: form.quantity,
          notes: form.notes || undefined,
          created_by_name: operator,
        });
        toast.success(
          `Stock adjustment recorded (${form.quantity.toLocaleString()}). Daily Changes keeps the full trail.`,
        );
        onSaved();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to record transaction");
      }
    });
  };

  return (
    <Modal title="Stock Adjustment" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="p-3 text-sm bg-[var(--destructive-bg)] text-[var(--destructive)] rounded-md border border-[var(--destructive-border)]">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1">
            Item
          </label>
          <ItemSearchSelect
            value={form.item_id}
            onChange={(id) => setForm({ ...form, item_id: id })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1">
              Warehouse
            </label>
            <Select
              value={form.warehouse_id}
              onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
              required
            >
              <option value="">Select warehouse</option>
              {warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1">
              Transaction Type
            </label>
            <Select
              value={form.transaction_type}
              onChange={(e) =>
                setForm({ ...form, transaction_type: e.target.value as TransactionType })
              }
            >
              <option value="purchase_in">Purchase In</option>
              <option value="production_in">Production In</option>
              <option value="production_out">Production Out (deducts)</option>
              <option value="adjustment">Adjustment</option>
              <option value="transfer">Transfer</option>
              <option value="scrap">Scrap (deducts)</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1">
              Quantity
            </label>
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
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1">
              Notes
            </label>
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g., Invoice #1234, PO reference"
            />
          </div>
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
