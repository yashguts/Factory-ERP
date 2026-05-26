"use client";

import { useState, useMemo, useTransition } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createItem, updateItem } from "@/lib/actions/inventory";
import type { ItemType, ItemCategory, UnitOfMeasurement } from "@/lib/supabase/types";

interface ItemFormModalProps {
  item?: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    item_type: ItemType;
    category_id: string | null;
    uom_id: string;
    minimum_stock: number;
    reorder_point: number;
    lead_time_days: number;
    cost_price: number;
  } | null;
  categories: ItemCategory[];
  units: UnitOfMeasurement[];
  onClose: () => void;
  onSaved: () => void;
}

export function ItemFormModal({ item, categories, units, onClose, onSaved }: ItemFormModalProps) {
  const isEditing = !!item;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Build category hierarchy
  const parentCategories = useMemo(
    () => categories.filter((c) => c.parent_id === null).sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );

  const childrenByParent = useMemo(() => {
    const map: Record<string, ItemCategory[]> = {};
    for (const cat of categories) {
      if (cat.parent_id) {
        if (!map[cat.parent_id]) map[cat.parent_id] = [];
        map[cat.parent_id].push(cat);
      }
    }
    // Sort children alphabetically
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [categories]);

  // Resolve initial parent + sub-category from item's category_id
  const resolveInitialCategories = () => {
    if (!item?.category_id) return { parentId: "", subId: "" };

    const cat = categories.find((c) => c.id === item.category_id);
    if (!cat) return { parentId: "", subId: "" };

    // If it's a top-level category
    if (cat.parent_id === null) return { parentId: cat.id, subId: "" };

    // If it's a child, check if its parent is top-level
    const parent = categories.find((c) => c.id === cat.parent_id);
    if (parent && parent.parent_id === null) return { parentId: parent.id, subId: cat.id };

    // It's a grandchild — find the grandparent
    if (parent) {
      const grandparent = categories.find((c) => c.id === parent.parent_id);
      if (grandparent) return { parentId: grandparent.id, subId: parent.id };
    }

    return { parentId: "", subId: "" };
  };

  const initial = resolveInitialCategories();
  const [parentCategoryId, setParentCategoryId] = useState(initial.parentId);
  const [subCategoryId, setSubCategoryId] = useState(initial.subId);

  // Sub-categories for the selected parent
  const subCategories = useMemo(
    () => (parentCategoryId ? childrenByParent[parentCategoryId] ?? [] : []),
    [parentCategoryId, childrenByParent]
  );

  // The actual category_id to save: most specific selection
  const resolvedCategoryId = subCategoryId || parentCategoryId || null;

  const [form, setForm] = useState({
    code: item?.code ?? "",
    name: item?.name ?? "",
    description: item?.description ?? "",
    item_type: item?.item_type ?? ("raw_material" as ItemType),
    uom_id: item?.uom_id ?? "",
    minimum_stock: Number(item?.minimum_stock ?? 0),
    reorder_point: Number(item?.reorder_point ?? 0),
    lead_time_days: Number(item?.lead_time_days ?? 0),
    cost_price: Number(item?.cost_price ?? 0),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const payload = {
          ...form,
          category_id: resolvedCategoryId,
        };
        if (isEditing && item) {
          await updateItem(item.id, payload);
        } else {
          await createItem({
            ...payload,
            category_id: payload.category_id || undefined,
          });
        }
        onSaved();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save item");
      }
    });
  };

  return (
    <Modal title={isEditing ? "Edit Item" : "Add New Item"} onClose={onClose} className="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-sm bg-red-50 text-red-700 rounded-md border border-red-200">
            {error}
          </div>
        )}

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
              <option value="mechanical_finished_stock">Mechanical Finished Stock</option>
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

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <Select
              value={parentCategoryId}
              onChange={(e) => {
                setParentCategoryId(e.target.value);
                setSubCategoryId("");
              }}
            >
              <option value="">Select category</option>
              {parentCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Sub-Category</label>
            <Select
              value={subCategoryId}
              onChange={(e) => setSubCategoryId(e.target.value)}
              disabled={!parentCategoryId || subCategories.length === 0}
            >
              <option value="">
                {!parentCategoryId
                  ? "Select category first"
                  : subCategories.length === 0
                  ? "No sub-categories"
                  : "Select sub-category"}
              </option>
              {subCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
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
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>
              ))}
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
              step="0.001"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reorder Point</label>
            <Input
              type="number"
              value={form.reorder_point}
              onChange={(e) => setForm({ ...form, reorder_point: Number(e.target.value) })}
              min={0}
              step="0.001"
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
              step="0.01"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border)]">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving..." : isEditing ? "Update Item" : "Create Item"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
