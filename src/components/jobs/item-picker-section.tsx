"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { ItemRow } from "@/components/jobs/item-row";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface PickedItem {
  _key: string;
  /** null when the row exists but no item has been picked yet */
  item_id: string | null;
  item_code: string;
  item_name: string;
  /** Optional friendlier label (item.lookup_key) for picked items. */
  item_lookup?: string | null;
  uom: string;
  category_name: string | null;
  required_quantity: number;
}

interface ItemPickerSectionProps {
  /** Section display name (also used as `category` in job_bom_lines). */
  category: string;
  description?: string;
  /** Category PATH strings used to scope the search. */
  defaultItemCategories?: string[];
  /** Currently selected items for this section. */
  items: PickedItem[];
  /** Called whenever the item list changes. */
  onItemsChange: (items: PickedItem[]) => void;
  /** Optional remove button for ad-hoc sections. */
  onRemoveSection?: () => void;
  /**
   * True when none of the section's defaultItemCategories resolve to a
   * real category in the inventory. Triggers an inline warning and forces
   * "All categories" mode so the user can still pick something useful.
   */
  isUnmapped?: boolean;
}

const makeKey = () => Math.random().toString(36).slice(2);

const emptyRow = (): PickedItem => ({
  _key: makeKey(),
  item_id: null,
  item_code: "",
  item_name: "",
  uom: "",
  category_name: null,
  required_quantity: 1,
});

/* ------------------------------------------------------------------ */
/*  Section component                                                 */
/* ------------------------------------------------------------------ */

export function ItemPickerSection({
  category,
  description,
  defaultItemCategories,
  items,
  onItemsChange,
  onRemoveSection,
  isUnmapped,
}: ItemPickerSectionProps) {
  // If the bound categories don't resolve, force "All categories" so the
  // search box is at least usable. User can still uncheck if they want.
  const [showAll, setShowAll] = useState(!!isUnmapped);
  useEffect(() => {
    if (isUnmapped) setShowAll(true);
  }, [isUnmapped]);

  // Seed exactly one empty row so the user can start typing immediately.
  // CRITICAL: memoize so the seed's _key is stable across renders. If we
  // built [emptyRow()] inline every render, the row's React key would
  // change each time and the input would remount — which previously
  // stole focus to the last-mounted empty section while the user was
  // typing in Job Number.
  const seedRow = useMemo(() => emptyRow(), []);
  const displayRows = items.length > 0 ? items : [seedRow];
  const pickedCount = items.filter((i) => i.item_id).length;

  const updateRow = useCallback(
    (key: string, patch: Partial<PickedItem>) => {
      const base = items.length > 0 ? items : [displayRows[0]];
      onItemsChange(
        base.map((it) => (it._key === key ? { ...it, ...patch } : it)),
      );
    },
    [items, displayRows, onItemsChange],
  );

  const addRow = useCallback(() => {
    onItemsChange([...(items.length > 0 ? items : []), emptyRow()]);
  }, [items, onItemsChange]);

  const removeRow = useCallback(
    (key: string) => {
      onItemsChange(items.filter((it) => it._key !== key));
    },
    [items, onItemsChange],
  );

  return (
    <section className="py-3 border-b border-[var(--border)] last:border-b-0">
      {/* Section header — compact label row */}
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="font-medium text-sm text-[var(--foreground)] truncate">
            {category}
          </h3>
          {pickedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 shrink-0">
              {pickedCount}
            </span>
          )}
          {description && !isUnmapped && (
            <span className="text-xs text-[var(--muted-foreground)] truncate">
              · {description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="h-3 w-3 rounded border-[var(--border)] cursor-pointer"
            />
            All categories
          </label>
          {onRemoveSection && (
            <button
              type="button"
              onClick={onRemoveSection}
              title="Remove this section"
              className="p-1 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Mapping warning — appears when the bound category paths can't
          be resolved against the live inventory taxonomy. */}
      {isUnmapped && (
        <div className="mb-2 flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            No inventory category mapped for this section
            {defaultItemCategories && defaultItemCategories.length > 0 && (
              <>
                {" "}
                (looked up{" "}
                <span className="font-mono">
                  {defaultItemCategories.join(", ")}
                </span>
                ).
              </>
            )}{" "}
            Search is browsing all categories — pick any item.
          </span>
        </div>
      )}

      {/* Rows */}
      <div className="space-y-1.5">
        {displayRows.map((row) => (
          <ItemRow
            key={row._key}
            row={row}
            scopeCategories={showAll ? undefined : defaultItemCategories}
            sectionCategory={category}
            onUpdate={(patch) => updateRow(row._key, patch)}
            onRemove={
              displayRows.length > 1
                ? () => removeRow(row._key)
                : items.length === 0
                  ? undefined
                  : () => removeRow(row._key)
            }
          />
        ))}
      </div>

      {/* + Add Item */}
      <button
        type="button"
        onClick={addRow}
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer"
      >
        <Plus className="h-3 w-3" />
        Add Item
      </button>
    </section>
  );
}
