"use client";

import { useMemo, useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemFormModal } from "@/components/inventory/item-form-modal";
import {
  OperationLinePicker,
  emptyLine,
} from "@/components/programs/operation-line-picker";
import {
  createOperation,
  updateOperation,
  type OperationDetail,
  type OperationLineInput,
} from "@/lib/actions/operations";
import type { PickedItem } from "@/components/jobs/item-picker-section";
import type {
  ItemCategory,
  UnitOfMeasurement,
  ItemType,
} from "@/lib/supabase/types";

interface Props {
  /** Existing operation when editing; omit/undefined for create. */
  operation?: OperationDetail | null;
  categories: ItemCategory[];
  units: UnitOfMeasurement[];
  itemRefs: { item_type: ItemType; category_id: string | null }[];
  onClose: () => void;
  onSaved: (id: string) => void;
}

const linesToRows = (
  lines: OperationDetail["inputs"] | undefined,
): PickedItem[] => {
  if (!lines || lines.length === 0) return [emptyLine()];
  return lines.map((l) => ({
    _key: Math.random().toString(36).slice(2),
    item_id: l.item_id,
    item_code: l.item_code,
    item_name: l.item_name,
    uom: l.uom,
    category_name: null,
    required_quantity: l.qty_per_run,
  }));
};

const rowsToLines = (rows: PickedItem[]): OperationLineInput[] =>
  rows
    .filter((r) => r.item_id)
    .map((r) => ({
      item_id: r.item_id as string,
      qty_per_run: r.required_quantity || 0,
    }));

export function ProgramFormModal({
  operation,
  categories,
  units,
  itemRefs,
  onClose,
  onSaved,
}: Props) {
  const isEditing = !!operation;

  const [name, setName] = useState(operation?.name ?? "");
  const [code, setCode] = useState(operation?.code ?? "");
  const [description, setDescription] = useState(operation?.description ?? "");
  const [notes, setNotes] = useState(operation?.notes ?? "");
  const [inputs, setInputs] = useState<PickedItem[]>(() =>
    linesToRows(operation?.inputs),
  );
  const [outputs, setOutputs] = useState<PickedItem[]>(() =>
    linesToRows(operation?.outputs),
  );

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Inline "create new item" sub-modal (for unnamed output parts).
  const [showCreateItem, setShowCreateItem] = useState(false);
  const suggestedItemName = useMemo(() => {
    const ref = code.trim() || name.trim() || "program";
    const n = outputs.filter((o) => o.item_id).length + 1;
    return `Output ${n} of ${ref}`;
  }, [code, name, outputs]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Program name is required.");
      return;
    }
    startTransition(async () => {
      const payload = {
        name,
        code: code.trim() || null,
        description: description.trim() || null,
        notes: notes.trim() || null,
        inputs: rowsToLines(inputs),
        outputs: rowsToLines(outputs),
      };
      const result =
        isEditing && operation
          ? await updateOperation(operation.id, payload)
          : await createOperation(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.id);
    });
  };

  return (
    <Modal
      title={isEditing ? "Edit Program" : "Add Program"}
      onClose={onClose}
      className="max-w-3xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-sm bg-red-50 text-red-700 rounded-md border border-red-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">
              Program Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Car Door Panel Nest V2"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Code
              <span className="text-[var(--muted-foreground)] font-normal text-xs ml-1">
                (auto if blank)
              </span>
            </label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g., CNC-CD-PANEL-V2"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Type:</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
            CNC Cutting
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">
            (bending, powder coat &amp; manual stations come later)
          </span>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Description
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — what this program is for"
          />
        </div>

        {/* Inputs */}
        <div className="border-t border-[var(--border)] pt-3">
          <div className="mb-2">
            <h3 className="text-sm font-semibold">Inputs (consumed per run)</h3>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Raw materials this program eats each time it runs. Quantity is
              per single run.
            </p>
          </div>
          <OperationLinePicker
            rows={inputs}
            onChange={setInputs}
            searchLabel="raw material"
          />
        </div>

        {/* Outputs */}
        <div className="border-t border-[var(--border)] pt-3">
          <div className="mb-2">
            <h3 className="text-sm font-semibold">Outputs (produced per run)</h3>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              The parts that come off the nest. If a part isn’t in inventory
              yet, use “Create new item” to add a placeholder you can rename
              later.
            </p>
          </div>
          <OperationLinePicker
            rows={outputs}
            onChange={setOutputs}
            searchLabel="output part"
            allowCreate
            onRequestCreate={() => setShowCreateItem(true)}
          />
        </div>

        {/* Notes */}
        <div className="border-t border-[var(--border)] pt-3">
          <label className="block text-sm font-medium mb-1">Notes</label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional — setup notes, scrap tips, etc."
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending
              ? "Saving..."
              : isEditing
                ? "Update Program"
                : "Create Program"}
          </Button>
        </div>
      </form>

      {showCreateItem && (
        <ItemFormModal
          categories={categories}
          units={units}
          items={itemRefs}
          createDefaults={{ name: suggestedItemName, item_type: "sub_assembly" }}
          onClose={() => setShowCreateItem(false)}
          onSaved={() => setShowCreateItem(false)}
          onCreated={(created) => {
            // Drop the freshly-created item straight into a new output row.
            setOutputs((prev) => [
              ...prev.filter((r) => r.item_id),
              {
                _key: Math.random().toString(36).slice(2),
                item_id: created.id,
                item_code: created.code,
                item_name: created.name,
                uom: created.uom,
                category_name: null,
                required_quantity: 1,
              },
              emptyLine(),
            ]);
          }}
        />
      )}
    </Modal>
  );
}
