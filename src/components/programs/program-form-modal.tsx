"use client";

import { useMemo, useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import {
  OPERATION_MACHINES,
  OPERATION_MACHINE_LABELS,
  type OperationMachine,
  type ItemCategory,
  type UnitOfMeasurement,
  type ItemType,
} from "@/lib/supabase/types";

interface Props {
  /** Existing operation when editing; omit/undefined for create. */
  operation?: OperationDetail | null;
  /**
   * Source operation to clone into a NEW program. Pre-fills the form from it
   * but saves via createOperation (the source is never touched). Ignored when
   * `operation` is set.
   */
  cloneSource?: OperationDetail | null;
  /** Pre-computed code suggestion for clone mode (often null → auto-derived). */
  suggestedCode?: string | null;
  categories: ItemCategory[];
  units: UnitOfMeasurement[];
  itemRefs: { item_type: ItemType; category_id: string | null }[];
  onClose: () => void;
  onSaved: (id: string) => void;
}

const makeKey = () => Math.random().toString(36).slice(2);

const linesToRows = (
  lines: OperationDetail["inputs"] | undefined,
): PickedItem[] => {
  if (!lines || lines.length === 0) return [emptyLine()];
  return lines.map((l) => ({
    _key: makeKey(),
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
  cloneSource,
  suggestedCode,
  categories,
  units,
  itemRefs,
  onClose,
  onSaved,
}: Props) {
  const isEditing = !!operation;
  const isCloning = !operation && !!cloneSource;
  // When cloning, treat the source's values as defaults — the form behaves
  // like a fresh create form, just pre-filled. Saving calls createOperation.
  const source = operation ?? cloneSource ?? null;

  const [name, setName] = useState(source?.name ?? "");
  const [code, setCode] = useState(
    operation?.code ?? (isCloning ? (suggestedCode ?? "") : ""),
  );
  const [machine, setMachine] = useState<OperationMachine>(
    source?.machine ?? "cnc_cutting",
  );
  const [description, setDescription] = useState(source?.description ?? "");
  const [notes, setNotes] = useState(source?.notes ?? "");
  const [inputs, setInputs] = useState<PickedItem[]>(() =>
    linesToRows(source?.inputs),
  );
  const [outputs, setOutputs] = useState<PickedItem[]>(() =>
    linesToRows(source?.outputs),
  );

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Inline "create new item" sub-modal. Tracks which picker triggered it so
  // the new item drops into the right list with a sensible suggested name.
  const [createTarget, setCreateTarget] = useState<"input" | "output" | null>(
    null,
  );

  const isAssembly = machine === "assembly_fit";

  const copy = isAssembly
    ? {
        typeHint: "Combines cut pieces and bought parts into a sub-assembly.",
        inputsTitle: "Inputs (components per run)",
        inputsHelp:
          "The cut pieces and bought parts (glass, rivnuts, …) that go into one run.",
        inputsSearch: "component",
        outputsTitle: "Outputs (produced per run)",
        outputsHelp:
          "The sub-assembly this run builds. Use “Create new item” if it isn’t in inventory yet.",
        outputsSearch: "sub-assembly",
        namePlaceholder: "e.g., Car Panel 700 LV (Long Vision)",
        codePlaceholder: "e.g., ASM-CAR-PANEL-700LV",
      }
    : {
        typeHint: "Cuts raw sheet into parts (the nest).",
        inputsTitle: "Inputs (consumed per run)",
        inputsHelp:
          "Raw materials this program eats each time it runs. Quantity is per single run.",
        inputsSearch: "raw material",
        outputsTitle: "Outputs (produced per run)",
        outputsHelp:
          "The parts that come off the nest. Use “Create new item” to add a placeholder for a part not in inventory yet.",
        outputsSearch: "output part",
        namePlaceholder: "e.g., Car Door Panel Nest V2",
        codePlaceholder: "e.g., CNC-CD-PANEL-V2",
      };

  const suggestedItemName = useMemo(() => {
    const ref = code.trim() || name.trim() || "program";
    const list = createTarget === "input" ? inputs : outputs;
    const n = list.filter((x) => x.item_id).length + 1;
    const word =
      createTarget === "input"
        ? isAssembly
          ? "Component"
          : "Material"
        : isAssembly
          ? "Sub-assembly"
          : "Output";
    return `${word} ${n} of ${ref}`;
  }, [code, name, inputs, outputs, createTarget, isAssembly]);

  const handleCreated = (created: {
    id: string;
    code: string;
    name: string;
    uom: string;
  }) => {
    const row: PickedItem = {
      _key: makeKey(),
      item_id: created.id,
      item_code: created.code,
      item_name: created.name,
      uom: created.uom,
      category_name: null,
      required_quantity: 1,
    };
    const append = (prev: PickedItem[]) => [
      ...prev.filter((r) => r.item_id),
      row,
      emptyLine(),
    ];
    if (createTarget === "input") setInputs(append);
    else setOutputs(append);
  };

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
        machine,
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
      title={
        isEditing
          ? "Edit Program"
          : isCloning
            ? `Clone Program — based on ${cloneSource?.code ?? cloneSource?.name}`
            : "Add Program"
      }
      onClose={onClose}
      className="max-w-3xl"
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
            <span className="font-medium">
              {cloneSource.code ?? cloneSource.name}
            </span>
            . Type, inputs and outputs are carried over — give it a new name; the
            code auto-generates if left blank, and the sketch starts fresh.
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
              placeholder={copy.namePlaceholder}
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
              placeholder={copy.codePlaceholder}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 items-start">
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <Select
              value={machine}
              onChange={(e) => setMachine(e.target.value as OperationMachine)}
            >
              {OPERATION_MACHINES.map((m) => (
                <option key={m} value={m}>
                  {OPERATION_MACHINE_LABELS[m]}
                </option>
              ))}
            </Select>
          </div>
          <p className="col-span-2 text-xs text-[var(--muted-foreground)] mt-7">
            {copy.typeHint}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — what this program is for"
          />
        </div>

        {/* Inputs */}
        <div className="border-t border-[var(--border)] pt-3">
          <div className="mb-2">
            <h3 className="text-sm font-semibold">{copy.inputsTitle}</h3>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              {copy.inputsHelp}
            </p>
          </div>
          <OperationLinePicker
            rows={inputs}
            onChange={setInputs}
            searchLabel={copy.inputsSearch}
            allowCreate
            onRequestCreate={() => setCreateTarget("input")}
          />
        </div>

        {/* Outputs */}
        <div className="border-t border-[var(--border)] pt-3">
          <div className="mb-2">
            <h3 className="text-sm font-semibold">{copy.outputsTitle}</h3>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              {copy.outputsHelp}
            </p>
          </div>
          <OperationLinePicker
            rows={outputs}
            onChange={setOutputs}
            searchLabel={copy.outputsSearch}
            allowCreate
            onRequestCreate={() => setCreateTarget("output")}
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

      {createTarget && (
        <ItemFormModal
          categories={categories}
          units={units}
          items={itemRefs}
          createDefaults={{ name: suggestedItemName, item_type: "sub_assembly" }}
          onClose={() => setCreateTarget(null)}
          onSaved={() => setCreateTarget(null)}
          onCreated={handleCreated}
        />
      )}
    </Modal>
  );
}
