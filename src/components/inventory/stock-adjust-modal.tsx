"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { TransactionType } from "@/lib/supabase/types";

interface StockAdjustModalProps {
  onClose: () => void;
}

export function StockAdjustModal({ onClose }: StockAdjustModalProps) {
  const [form, setForm] = useState({
    item_id: "",
    warehouse_id: "",
    transaction_type: "purchase_in" as TransactionType,
    quantity: 0,
    notes: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Save to Supabase + update inventory
    console.log("Stock adjustment:", form);
    onClose();
  };

  return (
    <Modal title="Stock Adjustment" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Item</label>
          <Select
            value={form.item_id}
            onChange={(e) => setForm({ ...form, item_id: e.target.value })}
            required
          >
            <option value="">Select item</option>
            <option value="1">RM-MTR-001 - Geared Traction Motor 10HP</option>
            <option value="2">RM-GRL-001 - Guide Rail T89/B 5m</option>
            <option value="3">SA-DOR-001 - Car Door Assembly</option>
            <option value="4">RM-WRR-001 - Wire Rope 12mm</option>
            <option value="5">RM-CTL-001 - Controller Panel VVVF</option>
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
            <option value="1">Main Store</option>
            <option value="2">Raw Material Store</option>
            <option value="3">Finished Goods</option>
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Transaction Type</label>
          <Select
            value={form.transaction_type}
            onChange={(e) =>
              setForm({ ...form, transaction_type: e.target.value as TransactionType })
            }
          >
            <option value="purchase_in">Purchase In</option>
            <option value="production_in">Production In</option>
            <option value="production_out">Production Out</option>
            <option value="adjustment">Adjustment</option>
            <option value="transfer">Transfer</option>
            <option value="scrap">Scrap</option>
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Quantity</label>
          <Input
            type="number"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            required
            min={0}
            step="0.001"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <Input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Optional notes"
          />
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border)]">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Record Transaction</Button>
        </div>
      </form>
    </Modal>
  );
}
