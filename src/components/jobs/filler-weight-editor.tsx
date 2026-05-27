"use client";

import { Input } from "@/components/ui/input";

interface BomValue {
  numVal?: number;
  textVal?: string;
}

const FILLER_WEIGHT_LEAVES = [
  { variant: "610/AHM", unit: "pcs" },
  { variant: "710/AHM", unit: "pcs" },
  { variant: "850X100/AHM", unit: "pcs" },
  { variant: "850X150/AHM", unit: "pcs" },
  { variant: "850X200/AHM", unit: "pcs" },
  { variant: "850X250/AHM", unit: "pcs" },
  { variant: "1050/AHM", unit: "pcs" },
  { variant: "1050X200/AHM", unit: "pcs" },
  { variant: "1050X350/AHM", unit: "pcs" },
  { variant: "710/CI", unit: "pcs" },
  { variant: "850X150/CI", unit: "pcs" },
  { variant: "850X200/CI", unit: "pcs" },
  { variant: "850X250/CI", unit: "pcs" },
  { variant: "1050/CI", unit: "pcs" },
  { variant: "550/HOME", unit: "pcs" },
  { variant: "650/HOME", unit: "pcs" },
  { variant: "750/HOME", unit: "pcs" },
  { variant: "850/HOME", unit: "pcs" },
] as const;

interface FillerWeightEditorProps {
  category: string;
  getBomValue: (cat: string, variant: string) => BomValue;
  setBomValue: (cat: string, variant: string, val: BomValue) => void;
}

export function FillerWeightEditor({
  category,
  getBomValue,
  setBomValue,
}: FillerWeightEditorProps) {
  const getNum = (variant: string) =>
    getBomValue(category, variant).numVal;
  const setNum = (variant: string, value: string) =>
    setBomValue(category, variant, {
      numVal: value ? Number(value) : undefined,
    });

  const filledCount = FILLER_WEIGHT_LEAVES.filter((l) => {
    const val = getBomValue(category, l.variant);
    return val.numVal != null && val.numVal !== 0;
  }).length;

  // Group by material type for organized display
  const ahmLeaves = FILLER_WEIGHT_LEAVES.filter((l) => l.variant.endsWith("/AHM"));
  const ciLeaves = FILLER_WEIGHT_LEAVES.filter((l) => l.variant.endsWith("/CI"));
  const homeLeaves = FILLER_WEIGHT_LEAVES.filter((l) => l.variant.endsWith("/HOME"));

  const renderGroup = (label: string, leaves: typeof FILLER_WEIGHT_LEAVES[number][]) => (
    <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
      <h5 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-2">
        {label}
      </h5>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {leaves.map((leaf) => {
          const shortLabel = leaf.variant.replace(/\/(AHM|CI|HOME)$/, "");
          return (
            <div key={leaf.variant}>
              <label
                className="block text-xs text-[var(--muted-foreground)] mb-1 truncate"
                title={leaf.variant}
              >
                {shortLabel}
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
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 lg:col-span-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-[var(--foreground)]">Filler Weight</h3>
        {filledCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {filledCount}/{FILLER_WEIGHT_LEAVES.length}
          </span>
        )}
      </div>
      <div className="space-y-3">
        {renderGroup("AHM", ahmLeaves)}
        {renderGroup("CI", ciLeaves)}
        {renderGroup("HOME", homeLeaves)}
      </div>
    </div>
  );
}
