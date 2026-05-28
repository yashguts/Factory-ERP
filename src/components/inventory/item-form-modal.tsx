"use client";

import { useState, useMemo, useTransition } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createItem, updateItem } from "@/lib/actions/inventory";
import type { ItemType, ItemCategory, UnitOfMeasurement } from "@/lib/supabase/types";

interface ItemRef {
  item_type: ItemType;
  category_id: string | null;
}

interface ItemFormModalProps {
  /** Existing item being edited. When null, the modal is in create mode. */
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
    procurement_type?: "make" | "trade" | null;
    suppliers?: string[];
  } | null;
  /**
   * When set, the modal opens in create mode but pre-filled from this
   * source. The code field is auto-filled with the next available
   * number in the source's series (see `nextCodeInSeries`). The user
   * just changes the name / spec and saves.
   */
  cloneSource?: {
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
    procurement_type?: "make" | "trade" | null;
    suppliers?: string[];
  } | null;
  /** Pre-computed next code in series (caller derives via nextCodeInSeries). */
  suggestedCode?: string | null;
  categories: (ItemCategory & {
    procurement_type?: "make" | "trade" | null;
  })[];
  units: UnitOfMeasurement[];
  items: ItemRef[];
  onClose: () => void;
  onSaved: () => void;
}

type ProcOverride = "" | "make" | "trade";

export function ItemFormModal({
  item,
  cloneSource,
  suggestedCode,
  categories,
  units,
  items,
  onClose,
  onSaved,
}: ItemFormModalProps) {
  const isEditing = !!item;
  const isCloning = !item && !!cloneSource;
  // When cloning, treat the source's values as defaults — the form
  // behaves like a fresh create form, but pre-filled. The user only
  // edits what's different.
  const seed = item ?? cloneSource ?? null;
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
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [categories]);

  // Build mapping: item_type → Set of parent category IDs that contain items of that type
  const typeToParentCatIds = useMemo(() => {
    // First, map each category_id to its parent (top-level) category ID
    const catToParent: Record<string, string> = {};
    for (const cat of categories) {
      if (cat.parent_id === null) {
        catToParent[cat.id] = cat.id; // parent maps to itself
      }
    }
    for (const cat of categories) {
      if (cat.parent_id && catToParent[cat.parent_id] !== undefined) {
        // Direct child of a top-level category
        catToParent[cat.id] = cat.parent_id;
      }
    }
    // Handle grandchildren (3-level)
    for (const cat of categories) {
      if (cat.parent_id && catToParent[cat.id] === undefined && catToParent[cat.parent_id] !== undefined) {
        catToParent[cat.id] = catToParent[cat.parent_id];
      }
    }

    const map: Record<string, Set<string>> = {};
    for (const it of items) {
      if (!it.category_id) continue;
      const parentId = catToParent[it.category_id];
      if (!parentId) continue;
      if (!map[it.item_type]) map[it.item_type] = new Set();
      map[it.item_type].add(parentId);
    }
    return map;
  }, [items, categories]);

  // Build mapping: item_type → Set of sub-category IDs that contain items of that type
  const typeToSubCatIds = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const it of items) {
      if (!it.category_id) continue;
      if (!map[it.item_type]) map[it.item_type] = new Set();
      map[it.item_type].add(it.category_id);
    }
    return map;
  }, [items]);

  // Resolve initial parent + sub-category from item's category_id
  const resolveInitialCategories = () => {
    if (!seed?.category_id) return { parentId: "", subId: "" };

    const cat = categories.find((c) => c.id === seed.category_id);
    if (!cat) return { parentId: "", subId: "" };

    if (cat.parent_id === null) return { parentId: cat.id, subId: "" };

    const parent = categories.find((c) => c.id === cat.parent_id);
    if (parent && parent.parent_id === null) return { parentId: parent.id, subId: cat.id };

    if (parent) {
      const grandparent = categories.find((c) => c.id === parent.parent_id);
      if (grandparent) return { parentId: grandparent.id, subId: parent.id };
    }

    return { parentId: "", subId: "" };
  };

  const initial = resolveInitialCategories();
  const [parentCategoryId, setParentCategoryId] = useState(initial.parentId);
  const [subCategoryId, setSubCategoryId] = useState(initial.subId);

  const resolvedCategoryId = subCategoryId || parentCategoryId || null;

  const [form, setForm] = useState({
    // When cloning, the code starts at the auto-suggested next-in-series;
    // when editing, the existing code; when creating fresh, blank.
    code: isCloning ? (suggestedCode ?? "") : (seed?.code ?? ""),
    name: seed?.name ?? "",
    description: seed?.description ?? "",
    item_type: seed?.item_type ?? ("mechanical_finished_stock" as ItemType),
    uom_id: seed?.uom_id ?? "",
    minimum_stock: Number(seed?.minimum_stock ?? 0),
    reorder_point: Number(seed?.reorder_point ?? 0),
    lead_time_days: Number(seed?.lead_time_days ?? 0),
    cost_price: Number(seed?.cost_price ?? 0),
  });

  // Make/Trade per-item override. "" means "inherit from category".
  const [procOverride, setProcOverride] = useState<ProcOverride>(
    seed?.procurement_type ?? "",
  );

  // What the category itself says about Make/Trade — used to label the
  // "Inherit" option in the dropdown and to compute the effective type
  // when the user hasn't set a per-item override.
  const categoryProcurement = useMemo(() => {
    if (!resolvedCategoryId) return null;
    const cat = categories.find((c) => c.id === resolvedCategoryId);
    return cat?.procurement_type ?? null;
  }, [resolvedCategoryId, categories]);

  const effectiveProcurement: "make" | "trade" | null =
    procOverride === "" ? categoryProcurement : procOverride;

  // Suppliers — fixed 5 slots so the layout is stable; empty strings are
  // dropped before save by normalizeSuppliers on the server.
  const initialSuppliers = seed?.suppliers ?? [];
  const [suppliers, setSuppliers] = useState<string[]>(() => {
    const arr = [...initialSuppliers];
    while (arr.length < 5) arr.push("");
    return arr.slice(0, 5);
  });
  const setSupplierAt = (idx: number, value: string) =>
    setSuppliers((prev) => prev.map((s, i) => (i === idx ? value : s)));

  // Filter parent categories by selected item type
  const filteredParentCategories = useMemo(() => {
    const allowedIds = typeToParentCatIds[form.item_type];
    if (!allowedIds || allowedIds.size === 0) return []; // no categories for types with no items
    return parentCategories.filter((c) => allowedIds.has(c.id));
  }, [form.item_type, typeToParentCatIds, parentCategories]);

  // Filter sub-categories by selected item type
  const subCategories = useMemo(() => {
    if (!parentCategoryId) return [];
    const all = childrenByParent[parentCategoryId] ?? [];
    const allowedSubIds = typeToSubCatIds[form.item_type];
    if (!allowedSubIds || allowedSubIds.size === 0) return all;
    return all.filter((c) => allowedSubIds.has(c.id));
  }, [parentCategoryId, childrenByParent, form.item_type, typeToSubCatIds]);

  // When item type changes, reset category selections if they're no longer valid
  const handleTypeChange = (newType: ItemType) => {
    setForm({ ...form, item_type: newType });
    const allowedIds = typeToParentCatIds[newType];
    if (allowedIds && !allowedIds.has(parentCategoryId)) {
      setParentCategoryId("");
      setSubCategoryId("");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        // For Make items the supplier list is hidden in the UI and
        // intentionally cleared on save so we don't leave stale data
        // behind if an item flipped from Trade→Make.
        const cleanedSuppliers =
          effectiveProcurement === "trade"
            ? suppliers.map((s) => s.trim()).filter(Boolean)
            : [];

        const payload = {
          ...form,
          category_id: resolvedCategoryId,
          procurement_type: (procOverride === ""
            ? null
            : procOverride) as "make" | "trade" | null,
          suppliers: cleanedSuppliers,
        };
        const result =
          isEditing && item
            ? await updateItem(item.id, payload)
            : await createItem({
                ...payload,
                category_id: payload.category_id || undefined,
              });
        if (!result.ok) {
          // Server-action returned an expected validation error
          // (duplicate code, bad FK, etc). Surface the real message
          // instead of letting Next.js's generic production-error
          // wrapper take over.
          setError(result.error);
          return;
        }
        onSaved();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save item");
      }
    });
  };

  return (
    <Modal
      title={
        isEditing
          ? "Edit Item"
          : isCloning
            ? `Clone Item — based on ${cloneSource?.code}`
            : "Add New Item"
      }
      onClose={onClose}
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-sm bg-red-50 text-red-700 rounded-md border border-red-200">
            {error}
          </div>
        )}

        {isCloning && cloneSource && (
          <div className="p-2.5 text-xs bg-blue-50 text-blue-900 rounded-md border border-blue-200">
            Cloning from{" "}
            <span className="font-mono font-medium">{cloneSource.code}</span> —{" "}
            <span className="font-medium">{cloneSource.name}</span>.
            Category, UOM, Make/Trade and suppliers carried over. Code
            auto-suggested as next in series.
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Item Code
              {isCloning && (
                <span className="text-[var(--muted-foreground)] font-normal text-xs ml-1">
                  (auto-suggested — editable)
                </span>
              )}
            </label>
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
              onChange={(e) => handleTypeChange(e.target.value as ItemType)}
            >
              <option value="raw_material">Raw Material</option>
              <option value="sub_assembly">Sub Assembly</option>
              <option value="finished_good">Finished Good</option>
              <option value="mechanical_finished_stock">Mechanical Finished Stock</option>
              <option value="door_panel">Door Panel</option>
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
              {filteredParentCategories.map((cat) => (
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

        {/* Make / Trade classification */}
        <div className="border-t border-[var(--border)] pt-4">
          <div className="grid grid-cols-3 gap-4 items-start">
            <div>
              <label className="block text-sm font-medium mb-1">
                Make / Trade
              </label>
              <Select
                value={procOverride}
                onChange={(e) =>
                  setProcOverride(e.target.value as ProcOverride)
                }
              >
                <option value="">
                  Inherit from category
                  {categoryProcurement
                    ? ` (${categoryProcurement === "make" ? "Make" : "Trade"})`
                    : " (not set)"}
                </option>
                <option value="make">Make (manufactured in-house)</option>
                <option value="trade">Trade (purchased from supplier)</option>
              </Select>
              {effectiveProcurement && (
                <p className="text-[11px] mt-1 text-[var(--muted-foreground)]">
                  Effective:{" "}
                  <span
                    className={`font-medium ${
                      effectiveProcurement === "make"
                        ? "text-blue-700"
                        : "text-amber-700"
                    }`}
                  >
                    {effectiveProcurement === "make" ? "Make" : "Trade"}
                  </span>
                  {procOverride === "" && categoryProcurement
                    ? " (inherited)"
                    : procOverride !== ""
                      ? " (override)"
                      : ""}
                </p>
              )}
            </div>
            <div className="col-span-2">
              {effectiveProcurement === "trade" ? (
                <>
                  <label className="block text-sm font-medium mb-1">
                    Suppliers
                    <span className="text-[var(--muted-foreground)] font-normal text-xs ml-1">
                      (up to 5)
                    </span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {suppliers.map((s, i) => (
                      <Input
                        key={i}
                        value={s}
                        onChange={(e) => setSupplierAt(i, e.target.value)}
                        placeholder={`Supplier ${i + 1}`}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-[var(--muted-foreground)] mt-7">
                  Supplier list is hidden because this item is{" "}
                  {effectiveProcurement === "make" ? "Make" : "unclassified"}.
                  Switch to Trade to enter suppliers.
                </p>
              )}
            </div>
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
