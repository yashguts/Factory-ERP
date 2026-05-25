"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Item, ItemType } from "@/lib/supabase/types";

interface ItemFormModalProps {
  item?: (Item & { uom_abbr?: string; category_name?: string }) | null;
  onClose: () => void;
}

export function ItemFormModal({ item, onClose }: ItemFormModalProps) {
  const isEditing = !!item;

  const [form, setForm] = useState({
    code: item?.code ?? "",
    name: item?.name ?? "",
    description: item?.description ?? "",
    item_type: item?.item_type ?? ("raw_material" as ItemType),
    category_id: item?.category_id ?? "",
    uom_id: item?.uom_id ?? "",
    minimum_stock: item?.minimum_stock ?? 0,
    reorder_point: item?.reorder_point ?? 0,
    lead_time_days: item?.lead_time_days ?? 0,
    cost_price: item?.cost_price ?? 0,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Save to Supabase
    console.log("Save item:", form);
    onClose();
  };

  return (
    <Modal title={isEditing ? "Edit Item" : "Add New Item"} onClose={onClose} className="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Item Code</label>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="e.g., RM-MTR-001"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Item Type</label>
            <Select
              value={form.item_type}
              onChange={(e) => setForm({ ...form, item_type: e.target.value as ItemType })}
            >
              <option value="raw_material">Raw Material</option>
              <option value="sub_assembly">Sub Assembly</option>
              <option value="finished_good">Finished Good</option>
            </Select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Item Name</label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., Geared Traction Motor 10HP"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Optional description"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <Select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
            >
              <option value="">Select category</option>
              <option value="1">Mechanical</option>
              <option value="2">Electrical</option>
              <option value="3">Structural</option>
              <option value="4">Cabin & Interiors</option>
              <option value="5">Safety</option>
              <option value="6">Doors</option>
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Unit of Measurement</label>
            <Select
              value={form.uom_id}
              onChange={(e) => setForm({ ...form, uom_id: e.target.value })}
              required
            >
              <option value="">Select UOM</option>
              <option value="1">Pieces (pcs)</option>
              <option value="2">Numbers (nos)</option>
              <option value="3">Meters (m)</option>
              <option value="4">Millimeters (mm)</option>
              <option value="5">Feet (ft)</option>
              <option value="6">Kilograms (kg)</option>
              <option value="7">Grams (g)</option>
              <option value="8">Square Meters (sqm)</option>
              <option value="9">Liters (L)</option>
              <option value="10">Sets (set)</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Min Stock</label>
            <Input
              type="number"
              value={form.minimum_stock}
              onChange={(e) => setForm({ ...form, minimum_stock: Number(e.target.value) })}
              min={0}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reorder Point</label>
            <Input
              type="number"
              value={form.reorder_point}
              onChange={(e) => setForm({ ...form, reorder_point: Number(e.target.value) })}
              min={0}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Lead Time (days)</label>
            <Input
              type="number"
              value={form.lead_time_days}
              onChange={(e) => setForm({ ...form, lead_time_days: Number(e.target.value) })}
              min={0}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cost Price (INR)</label>
            <Input
              type="number"
              value={form.cost_price}
              onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) })}
              min={0}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border)]">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{isEditing ? "Update Item" : "Create Item"}</Button>
        </div>
      </form>
    </Modal>
  );
}
