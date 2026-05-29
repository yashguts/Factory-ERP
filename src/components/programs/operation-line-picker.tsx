"use client";

import { useCallback } from "react";
import { Plus, PackagePlus } from "lucide-react";
import { ItemRow } from "@/components/jobs/item-row";
import type { PickedItem } from "@/components/jobs/item-picker-section";

const makeKey = () => Math.random().toString(36).slice(2);

export const emptyLine = (): PickedItem => ({
  _key: makeKey(),
  item_id: null,
  item_code: "",
  item_name: "",
  uom: "",
  category_name: null,
  required_quantity: 1,
});

interface Props {
  /** Rows for this picker (inputs or outputs). Parent owns the array. */
  rows: PickedItem[];
  onChange: (rows: PickedItem[]) => void;
  /** Placeholder hint shown in the search box, e.g. "raw material". */
  searchLabel: string;
  /** Show the inline "Create new item" button (used for outputs). */
  allowCreate?: boolean;
  onRequestCreate?: () => void;
}

/**
 * Per-line picker for an operation's inputs or outputs. Reuses the BOM
 * ItemRow (debounced item search + qty), searching ALL items (no category
 * scope). Qty is stored in `required_quantity` and read back as qty_per_run.
 */
export function OperationLinePicker({
  rows,
  onChange,
  searchLabel,
  allowCreate,
  onRequestCreate,
}: Props) {
  const updateRow = useCallback(
    (key: string, patch: Partial<PickedItem>) => {
      onChange(rows.map((r) => (r._key === key ? { ...r, ...patch } : r)));
    },
    [rows, onChange],
  );

  const addRow = useCallback(() => {
    onChange([...rows, emptyLine()]);
  }, [rows, onChange]);

  const removeRow = useCallback(
    (key: string) => {
      const next = rows.filter((r) => r._key !== key);
      onChange(next.length > 0 ? next : [emptyLine()]);
    },
    [rows, onChange],
  );

  return (
    <div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <ItemRow
            key={row._key}
            row={row}
            scopeCategories={undefined}
            sectionCategory={searchLabel}
            onUpdate={(patch) => updateRow(row._key, patch)}
            onRemove={
              rows.length > 1 || row.item_id
                ? () => removeRow(row._key)
                : undefined
            }
          />
        ))}
      </div>

      <div className="mt-2 flex items-center gap-4">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer"
        >
          <Plus className="h-3 w-3" />
          Add row
        </button>
        {allowCreate && (
          <button
            type="button"
            onClick={onRequestCreate}
            title="Create a new inventory item for an unnamed output part"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline cursor-pointer"
          >
            <PackagePlus className="h-3 w-3" />
            Create new item
          </button>
        )}
      </div>
    </div>
  );
}
