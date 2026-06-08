"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Check } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createCabinItem } from "@/lib/actions/cabin";

const NEW = "__new__";

interface Props {
  typeId: string;
  typeName: string;
  subCategories: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}

export function CabinAddItemModal({
  typeId,
  typeName,
  subCategories,
  onClose,
  onSaved,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [subChoice, setSubChoice] = useState(
    subCategories[0]?.name ?? NEW,
  );
  const [newSub, setNewSub] = useState("");
  const [stock, setStock] = useState("0");

  const resolvedSub = subChoice === NEW ? newSub.trim() : subChoice;

  const submit = (addAnother: boolean) => {
    setError(null);
    if (!name.trim()) {
      setError("Item name is required.");
      return;
    }
    startTransition(async () => {
      const res = await createCabinItem({
        typeId,
        subCategory: resolvedSub || null,
        name,
        openingStock: stock ? Number(stock) : 0,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onSaved();
      if (addAnother) {
        setJustAdded(`${res.code} — ${name.trim()}`);
        setName("");
        setStock("0");
        // keep sub-type + new-sub for the next item
      } else {
        onClose();
      }
    });
  };

  return (
    <Modal title={`Add ${typeName} item`} onClose={onClose} className="max-w-lg">
      <div className="space-y-4">
        {error && (
          <div className="p-3 text-sm bg-[var(--destructive-bg)] text-[var(--destructive)] rounded-md border border-[var(--destructive-border)]">
            {error}
          </div>
        )}
        {justAdded && !error && (
          <div className="p-2.5 text-sm bg-green-50 text-green-700 rounded-md border border-green-200 inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5" /> Added {justAdded}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">
            Item Name <span className="text-red-500">*</span>
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., ACO 900X900"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Sub-type</label>
            <Select value={subChoice} onChange={(e) => setSubChoice(e.target.value)}>
              {subCategories.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
              <option value={NEW}>+ New sub-type…</option>
            </Select>
            {subChoice === NEW && (
              <Input
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                placeholder="New sub-type name"
                className="mt-2"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Opening stock
            </label>
            <Input
              type="number"
              step="any"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
            />
          </div>
        </div>

        <p className="text-[11px] text-[var(--muted-foreground)]">
          Created as a Make, stocked cabin item (unit: nos); code auto-generated.
        </p>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => submit(true)} disabled={isPending}>
            {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            Save &amp; add another
          </Button>
          <Button onClick={() => submit(false)} disabled={isPending}>
            {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
            Add item
          </Button>
        </div>
      </div>
    </Modal>
  );
}
