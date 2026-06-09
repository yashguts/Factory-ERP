"use client";

import { useState, useMemo, useTransition, useEffect } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Trash2, Loader2, ArrowUpFromLine, ArrowDownToLine } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { createItem, updateItem, deleteItem } from "@/lib/actions/inventory";
import {
  getOperationsForItem,
  type ItemOperationsResult,
} from "@/lib/actions/operations";
import type { ItemType, ItemCategory, UnitOfMeasurement, StockBehaviour } from "@/lib/supabase/types";

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
    stock_behaviour?: StockBehaviour;
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
    stock_behaviour?: StockBehaviour;
    suppliers?: string[];
  } | null;
  /** Pre-computed next code in series (caller derives via nextCodeInSeries). */
  suggestedCode?: string | null;
  categories: (ItemCategory & {
    procurement_type?: "make" | "trade" | null;
  })[];
  units: UnitOfMeasurement[];
  items: ItemRef[];
  /**
   * Create-mode seed values (e.g. when opened inline from another form to
   * add a placeholder item). Ignored when editing/cloning.
   */
  createDefaults?: { name?: string; item_type?: ItemType; stock_behaviour?: StockBehaviour };
  /**
   * Called after a successful CREATE with the new item's essentials, so the
   * caller can drop it straight into a picker. Not called on edit.
   */
  onCreated?: (item: {
    id: string;
    code: string;
    name: string;
    uom: string;
  }) => void;
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
  createDefaults,
  onCreated,
  onClose,
  onSaved,
}: ItemFormModalProps) {
  const isEditing = !!item;
  const isCloning = !item && !!cloneSource;
  // When cloning, treat the source's values as defaults — the form
  // behaves like a fresh create form, but pre-filled. The user only
  // edits what's different.
  const seed = item ?? cloneSource ?? null;
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optional free-text reason recorded in the inventory change log so the
  // Daily Changes page can show *why* an edit was made (not stored on items).
  const [note, setNote] = useState("");

  // Programs that produce/consume this item (edit mode only). Lets the user
  // jump from an item to the CNC program behind it.
  const [itemOps, setItemOps] = useState<ItemOperationsResult | null>(null);
  useEffect(() => {
    if (!item?.id) return;
    let active = true;
    getOperationsForItem(item.id)
      .then((res) => {
        if (active) setItemOps(res);
      })
      .catch(() => {
        /* non-critical widget — ignore failures */
      });
    return () => {
      active = false;
    };
  }, [item?.id]);

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
    name: seed?.name ?? createDefaults?.name ?? "",
    description: seed?.description ?? "",
    item_type:
      seed?.item_type ??
      createDefaults?.item_type ??
      ("mechanical_finished_stock" as ItemType),
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

  // Stock behaviour: stocked (default) | phantom | tooling.
  const [stockBehaviour, setStockBehaviour] = useState<StockBehaviour>(
    seed?.stock_behaviour ?? createDefaults?.stock_behaviour ?? "stocked",
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

  const handleDelete = () => {
    if (!item) return;
    const typed = window.prompt(
      `Delete item "${item.code}" — ${item.name}?\n\n` +
        "If this item is used in any BOM or has any transaction history, " +
        "it will be soft-deleted (hidden from inventory but kept for history). " +
        "Otherwise it will be permanently removed.\n\n" +
        `Type the item code "${item.code}" to confirm:`,
    );
    if (typed === null) return;
    if (typed.trim() !== item.code) {
      alert("Item code did not match. Delete cancelled.");
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await deleteItem(item.id, note.trim() || undefined);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Friendly confirmation so the user knows which path ran.
      if (result.action === "hard_deleted") {
        toast.success(`Item "${item.code}" permanently deleted.`);
      } else {
        toast.info(
          `Item "${item.code}" had history (BOM lines or transactions), so it was deactivated and hidden instead of deleted. References are preserved.`,
        );
      }
      onSaved();
      onClose();
    });
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
          stock_behaviour: stockBehaviour,
          suppliers: cleanedSuppliers,
          note: note.trim() || undefined,
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
        // On a fresh create, hand the new item back so an inline caller can
        // drop it straight into a picker (e.g. an operation's outputs).
        if (!isEditing && onCreated) {
          const uomAbbr =
            units.find((u) => u.id === form.uom_id)?.abbreviation ?? "";
          onCreated({
            id: result.id,
            // Use the server's code — it may have been auto-generated when
            // the user left the field blank.
            code: result.code,
            name: form.name,
            uom: uomAbbr,
          });
        }
        toast.success(
          isEditing
            ? `Saved changes to ${form.name}.`
            : `Item created — ${result.code} ${form.name}.`,
        );
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
          <div className="p-3 text-sm bg-[var(--destructive-bg)] text-[var(--destructive)] rounded-md border border-[var(--destructive-border)]">
            {error}
          </div>
        )}

        {isCloning && cloneSource && (
          <div className="p-2.5 text-xs bg-blue-50 text-blue-800 rounded-md border border-blue-200">
            Cloning from{" "}
            <span className="font-mono font-medium">{cloneSource.code}</span> —{" "}
            <span className="font-medium">{cloneSource.name}</span>.
            Category, UOM, Make/Trade and suppliers carried over. Code
            auto-suggested as next in series.
          </div>
        )}

        {/* Programs that produce / consume this item (edit mode). */}
        {itemOps &&
          (itemOps.produces.length > 0 || itemOps.consumes.length > 0) && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-3 space-y-2">
              {itemOps.produces.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 mb-1">
                    <ArrowUpFromLine className="h-3.5 w-3.5" />
                    Produced by
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {itemOps.produces.map((op) => (
                      <Link
                        key={`out-${op.id}`}
                        href={`/programs/${op.id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)] cursor-pointer"
                        title={op.code ?? op.name}
                      >
                        <span className="font-medium">{op.name}</span>
                        <span className="text-[var(--muted-foreground)]">
                          ×{op.qty_per_run}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {itemOps.consumes.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--muted-foreground)] mb-1">
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                    Consumed by
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {itemOps.consumes.map((op) => (
                      <Link
                        key={`in-${op.id}`}
                        href={`/programs/${op.id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)] cursor-pointer"
                        title={op.code ?? op.name}
                      >
                        <span className="font-medium">{op.name}</span>
                        <span className="text-[var(--muted-foreground)]">
                          ×{op.qty_per_run}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Item Code
              {isCloning ? (
                <span className="text-[var(--muted-foreground)] font-normal text-xs ml-1">
                  (auto-suggested — editable)
                </span>
              ) : !isEditing ? (
                <span className="text-[var(--muted-foreground)] font-normal text-xs ml-1">
                  (auto if blank)
                </span>
              ) : null}
            </label>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder={isEditing ? "e.g., RM-MTR-001" : "Leave blank to auto-generate"}
              required={isEditing}
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

        {/* Stock behaviour — how the item is planned/held. */}
        <div className="border-t border-[var(--border)] pt-4">
          <div className="grid grid-cols-3 gap-4 items-start">
            <div>
              <label className="block text-sm font-medium mb-1">
                Stock behaviour
              </label>
              <Select
                value={stockBehaviour}
                onChange={(e) =>
                  setStockBehaviour(e.target.value as StockBehaviour)
                }
              >
                <option value="stocked">Stocked (held & planned)</option>
                <option value="phantom">Phantom (made, never stocked)</option>
                <option value="tooling">Tooling (jig/template, not a product)</option>
              </Select>
            </div>
            <p className="col-span-2 text-xs text-[var(--muted-foreground)] mt-7">
              {stockBehaviour === "stocked"
                ? "Has a stock balance and is planned by MRP (raw sheets, bought parts, real sub-assemblies)."
                : stockBehaviour === "phantom"
                  ? "Cut/made but never held in stock — explodes through to its raw material; gets no balance or order of its own. Rare as an item."
                  : "A jig or template used to make other parts — excluded from product BOMs and MRP."}
            </p>
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

        {/* Optional audit note — recorded against this change so the
            Daily Changes page shows why it was made. */}
        <div className="border-t border-[var(--border)] pt-4">
          <label className="block text-sm font-medium mb-1">
            Reason for change
            <span className="text-[var(--muted-foreground)] font-normal text-xs ml-1">
              (optional — shown in Daily Changes)
            </span>
          </label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              isEditing
                ? "e.g., corrected cost price from supplier invoice"
                : "e.g., new item added per purchase order"
            }
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-4 border-t border-[var(--border)]">
          {/* Delete is only available when editing an existing item.
              Sits on the left so it's visually separated from the
              positive-action buttons on the right. */}
          {isEditing ? (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
              title="Delete this item (soft-delete if it has BOM/transaction history)"
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              Delete Item
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : isEditing ? "Update Item" : "Create Item"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
