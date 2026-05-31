"use client";

import { useCallback } from "react";
import { Plus, PackagePlus } from "lucide-react";
import { ItemRow } from "@/components/jobs/item-row";
import type { PickedItem } from "@/components/jobs/item-picker-section";
import type { OutputRole } from "@/lib/supabase/types";

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
  /** Outputs only: show a per-row role selector (Finished part / Loose part / Tool). */
  withRole?: boolean;
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
  withRole,
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
          <div
            key={row._key}
            className={withRole ? "flex items-start gap-2" : undefined}
          >
            <div className="flex-1 min-w-0">
              <ItemRow
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
            </div>
            {withRole && (
              <select
                value={row.role ?? "component"}
                onChange={(e) =>
                  updateRow(row._key, { role: e.target.value as OutputRole })
                }
                title="What is this output? Finished part = a stocked item; Loose part = cut & fitted, never stocked; Tool = jig/template"
                className="h-9 w-[130px] shrink-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm cursor-pointer hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)] transition-colors"
              >
                <option value="component">Finished part</option>
                <option value="cut_part">Loose part</option>
                <option value="tooling">Tool</option>
                <option value="scrap">Scrap</option>
              </select>
            )}
          </div>
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
            title="Create a new inventory item (placeholder you can rename later)"
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
