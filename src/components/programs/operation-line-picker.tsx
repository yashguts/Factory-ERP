"use client";

import { useCallback } from "react";
import { Plus, PackagePlus } from "lucide-react";
import { ItemRow } from "@/components/jobs/item-row";
import { LoosePartPicker } from "@/components/inventory/loose-part-picker";
import type { PickedItem } from "@/components/jobs/item-picker-section";
import type { OutputRole } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

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
  /** Outputs only: show a per-row type selector that drives the picker. */
  withRole?: boolean;
  /** Outputs only: open a phantom-loose-part create targeting a specific row. */
  onCreateLoose?: (rowKey: string, query: string) => void;
}

const ROLE_OPTIONS: { value: OutputRole; label: string }[] = [
  { value: "component", label: "Finished part" },
  { value: "cut_part", label: "Loose part" },
  { value: "tooling", label: "Tool" },
  { value: "scrap", label: "Scrap" },
];

/**
 * Per-line picker for an operation's inputs or outputs.
 *
 * Inputs: a plain inventory search + qty.
 * Outputs (withRole): the TYPE is chosen first, and it drives the row —
 *   - Loose part  -> a loose-parts-only search (phantoms + program labels),
 *     with promote-on-pick and "create as phantom"; never the full inventory.
 *   - Finished part / Tool / Scrap -> the normal inventory search.
 * A row with no type yet is gated until the engineer declares intent — small
 * friction, far fewer mis-categorised parts.
 */
export function OperationLinePicker({
  rows,
  onChange,
  searchLabel,
  allowCreate,
  onRequestCreate,
  withRole,
  onCreateLoose,
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

  const setRole = (row: PickedItem, role: OutputRole) => {
    // Switching across the loose boundary changes the search universe, so a
    // previously-picked item no longer applies — clear it to force a re-pick.
    const crossesLooseBoundary =
      (row.role === "cut_part") !== (role === "cut_part");
    if (row.item_id && crossesLooseBoundary) {
      updateRow(row._key, {
        role,
        item_id: null,
        item_code: "",
        item_name: "",
        uom: "",
      });
    } else {
      updateRow(row._key, { role });
    }
  };

  return (
    <div>
      <div className="space-y-1.5">
        {rows.map((row) => {
          // Inputs: plain item search + qty, no type.
          if (!withRole) {
            return (
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
            );
          }

          // Outputs: type FIRST, then the matching picker.
          const role = row.role;
          return (
            <div key={row._key} className="flex items-start gap-2">
              <select
                value={role ?? ""}
                onChange={(e) => setRole(row, e.target.value as OutputRole)}
                title="What is this output? Choose this first."
                className={cn(
                  "h-8 w-[140px] shrink-0 rounded-md border bg-[var(--background)] px-2 text-sm cursor-pointer hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)] transition-colors",
                  role
                    ? "border-[var(--border)]"
                    : "border-amber-400 text-amber-700 font-medium",
                )}
              >
                <option value="" disabled>
                  Type…
                </option>
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              <div className="flex-1 min-w-0">
                {!role ? (
                  <div className="flex items-center h-8 px-3 rounded-md border border-dashed border-[var(--border)] text-xs text-[var(--muted-foreground)]">
                    Choose a type first
                  </div>
                ) : role === "cut_part" ? (
                  <LoosePartPicker
                    itemId={row.item_id}
                    itemName={row.item_name}
                    itemCode={row.item_code}
                    uom={row.uom}
                    qty={row.required_quantity}
                    onPick={(p) =>
                      updateRow(row._key, {
                        item_id: p.id,
                        item_code: p.code,
                        item_name: p.name,
                        uom: p.uom,
                        required_quantity: row.required_quantity || 1,
                        role: "cut_part",
                      })
                    }
                    onClear={() =>
                      updateRow(row._key, {
                        item_id: null,
                        item_code: "",
                        item_name: "",
                        uom: "",
                      })
                    }
                    onQty={(n) => updateRow(row._key, { required_quantity: n })}
                    onRemove={
                      rows.length > 1 || row.item_id
                        ? () => removeRow(row._key)
                        : undefined
                    }
                    onCreateNew={(q) => onCreateLoose?.(row._key, q)}
                    pendingLabel={row.label}
                  />
                ) : (
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
                )}
              </div>
            </div>
          );
        })}
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
