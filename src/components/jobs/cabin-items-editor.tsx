"use client";

import { Input } from "@/components/ui/input";

interface BomValue {
  numVal?: number;
  textVal?: string;
}

const CABIN_ITEMS_LEAVES = [
  { variant: "Cabin Glass", unit: "pcs" },
  { variant: "Floor Tiles", unit: "pcs" },
  { variant: "Chequered Plate (Aluminium)", unit: "pcs" },
  { variant: "Chequered Plate (MS)", unit: "pcs" },
  { variant: "Safety / Car Gate Switch", unit: "pcs" },
  { variant: "Home Safety Switch", unit: "pcs" },
  { variant: "PVC Cable Hanger", unit: "pcs" },
  { variant: "Ret. Cam", unit: "pcs" },
  { variant: "Reed Channel", unit: "pcs" },
  { variant: "Fan Grill Square", unit: "pcs" },
  { variant: "Fan Grill Blower", unit: "pcs" },
  { variant: "Fireman Switch", unit: "pcs" },
  { variant: "Oil Pot", unit: "pcs" },
  { variant: "Mobil T-40", unit: "pcs" },
  { variant: "Grease 200grm", unit: "pcs" },
  { variant: "Safety Tips Plate", unit: "pcs" },
  { variant: "Danger Plate", unit: "pcs" },
] as const;

interface CabinItemsEditorProps {
  category: string;
  getBomValue: (cat: string, variant: string) => BomValue;
  setBomValue: (cat: string, variant: string, val: BomValue) => void;
}

export function CabinItemsEditor({
  category,
  getBomValue,
  setBomValue,
}: CabinItemsEditorProps) {
  const getNum = (variant: string) =>
    getBomValue(category, variant).numVal;
  const setNum = (variant: string, value: string) =>
    setBomValue(category, variant, {
      numVal: value ? Number(value) : undefined,
    });

  const filledCount = CABIN_ITEMS_LEAVES.filter((l) => {
    const val = getBomValue(category, l.variant);
    return val.numVal != null && val.numVal !== 0;
  }).length;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 lg:col-span-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-[var(--foreground)]">Cabin Items</h3>
        {filledCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {filledCount}/{CABIN_ITEMS_LEAVES.length}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {CABIN_ITEMS_LEAVES.map((leaf) => (
          <div key={leaf.variant}>
            <label
              className="block text-xs text-[var(--muted-foreground)] mb-1 truncate"
              title={leaf.variant}
            >
              {leaf.variant}
              <span className="text-[10px] ml-1 opacity-60">({leaf.unit})</span>
            </label>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              className="h-8 text-sm"
              value={getNum(leaf.variant) ?? ""}
              onChange={(e) => setNum(leaf.variant, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
