"use client";

import { useState, useTransition } from "react";
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
          <Select
            value={form.item_id}
            onChange={(e) => setForm({ ...form, item_id: e.target.value })}
            required
          >
            <option value="">Select item</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name}
              </option>
            ))}
          </Select>
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
