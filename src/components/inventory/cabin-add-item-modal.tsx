"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Check, Layers } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { createCabinItem, createCabinPanelVariants } from "@/lib/actions/cabin";
import {
  CABIN_PANEL_FINISHES,
  CABIN_PANEL_GRADE_FINISHES,
  CABIN_PANEL_DESIGNER_FINISHES,
} from "@/lib/cabin/cabin-types";
import { cn } from "@/lib/utils";

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
  const [fanResult, setFanResult] = useState<{ created: number; skipped: number } | null>(null);

  const [fanOut, setFanOut] = useState(false);
  const [name, setName] = useState("");
  const [subChoice, setSubChoice] = useState(subCategories[0]?.name ?? NEW);
  const [newSub, setNewSub] = useState("");
  const [stock, setStock] = useState("0");
  const [finishes, setFinishes] = useState<Set<string>>(() => new Set(CABIN_PANEL_FINISHES));

  const resolvedSub = subChoice === NEW ? newSub.trim() : subChoice;
  const base = name.trim();
  const selected = CABIN_PANEL_FINISHES.filter((f) => finishes.has(f));

  const toggleFinish = (f: string) =>
    setFinishes((prev) => {
      const n = new Set(prev);
      n.has(f) ? n.delete(f) : n.add(f);
      return n;
    });

  // ── single item ──
  const submitItem = (addAnother: boolean) => {
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
      } else {
        onClose();
      }
    });
  };

  // ── fan-out: one item per finish ──
  const submitFanOut = () => {
    setError(null);
    setFanResult(null);
    if (!base) {
      setError("Base panel name is required.");
      return;
    }
    if (selected.length === 0) {
      setError("Pick at least one finish.");
      return;
    }
    startTransition(async () => {
      const res = await createCabinPanelVariants({
        typeId,
        subCategory: resolvedSub || null,
        baseName: base,
        finishes: selected,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onSaved();
      setFanResult({ created: res.created.length, skipped: res.skipped.length });
      setName("");
    });
  };

  return (
    <Modal title={`Add ${typeName} item`} onClose={onClose} size={fanOut ? "lg" : "md"}>
      <div className="space-y-3">
        {/* Mode toggle */}
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none rounded-md border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2">
          <input
            type="checkbox"
            checked={fanOut}
            onChange={(e) => { setFanOut(e.target.checked); setError(null); setFanResult(null); setJustAdded(null); }}
            className="cursor-pointer"
          />
          <Layers className="h-4 w-4 text-[var(--primary)]" />
          <span className="font-medium">Create all finish variants at once</span>
          <span className="text-[var(--muted-foreground)]">— MS · SS grades · designer finishes</span>
        </label>

        {error && (
          <div className="p-3 text-sm bg-[var(--destructive-bg)] text-[var(--destructive)] rounded-md border border-[var(--destructive-border)]">
            {error}
          </div>
        )}
        {justAdded && !error && (
          <Badge variant="success" className="gap-1.5">
            <Check className="h-3.5 w-3.5" /> Added {justAdded}
          </Badge>
        )}
        {fanResult && !error && (
          <Badge variant="success" className="gap-1.5">
            <Check className="h-3.5 w-3.5" /> Created {fanResult.created} item{fanResult.created === 1 ? "" : "s"}
            {fanResult.skipped > 0 ? ` · ${fanResult.skipped} already existed` : ""}
          </Badge>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">
            {fanOut ? "Base panel name" : "Item Name"} <span className="text-[var(--destructive)]">*</span>
          </label>
          <Input
            size="sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={fanOut ? "e.g., P2C 350 WITH TOUCH COP STD" : "e.g., ACO 900X900"}
            autoFocus
          />
          {fanOut && (
            <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
              Each finish is appended → e.g. <span className="font-mono">{base || "<base>"} MS</span>,{" "}
              <span className="font-mono">{base || "<base>"} SS 304</span>, <span className="font-mono">{base || "<base>"} Rose Gold</span>…
            </p>
          )}
        </div>

        <div className={cn("grid gap-3", fanOut ? "grid-cols-1" : "grid-cols-2")}>
          <div>
            <label className="block text-sm font-medium mb-1">Sub-type</label>
            <Select size="sm" value={subChoice} onChange={(e) => setSubChoice(e.target.value)}>
              {subCategories.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
              <option value={NEW}>+ New sub-type…</option>
            </Select>
            {subChoice === NEW && (
              <Input
                size="sm"
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                placeholder="New sub-type name"
                className="mt-2"
              />
            )}
          </div>
          {!fanOut && (
            <div>
              <label className="block text-sm font-medium mb-1">Opening stock</label>
              <Input size="sm" type="number" step="any" value={stock} onChange={(e) => setStock(e.target.value)} />
            </div>
          )}
        </div>

        {fanOut && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium">
                Finishes <span className="text-[var(--muted-foreground)] font-normal">({selected.length} selected)</span>
              </label>
              <div className="flex gap-2 text-xs">
                <button type="button" className="text-[var(--primary)] hover:underline cursor-pointer" onClick={() => setFinishes(new Set(CABIN_PANEL_FINISHES))}>All</button>
                <button type="button" className="text-[var(--muted-foreground)] hover:underline cursor-pointer" onClick={() => setFinishes(new Set())}>None</button>
              </div>
            </div>
            <FinishGroup label="Grades" items={CABIN_PANEL_GRADE_FINISHES} sel={finishes} onToggle={toggleFinish} />
            <FinishGroup label="Designer finishes" items={CABIN_PANEL_DESIGNER_FINISHES} sel={finishes} onToggle={toggleFinish} />
          </div>
        )}

        {!fanOut && (
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Created as a Make, stocked cabin item (unit: nos); code auto-generated.
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={isPending}>
            {fanResult ? "Done" : "Cancel"}
          </Button>
          {fanOut ? (
            <Button size="sm" onClick={submitFanOut} disabled={isPending || !base || selected.length === 0}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Layers className="h-3.5 w-3.5 mr-1.5" />}
              Create {selected.length} variant{selected.length === 1 ? "" : "s"}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => submitItem(true)} disabled={isPending}>
                {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                Save &amp; add another
              </Button>
              <Button size="sm" onClick={() => submitItem(false)} disabled={isPending}>
                {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                Add item
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function FinishGroup({
  label,
  items,
  sel,
  onToggle,
}: {
  label: string;
  items: readonly string[];
  sel: Set<string>;
  onToggle: (f: string) => void;
}) {
  return (
    <div className="mb-2">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)] mb-1">{label}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
        {items.map((f) => (
          <label key={f} className="flex items-center gap-1.5 text-xs cursor-pointer select-none py-0.5">
            <input type="checkbox" checked={sel.has(f)} onChange={() => onToggle(f)} className="cursor-pointer" />
            <span className="truncate" title={f}>{f}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
