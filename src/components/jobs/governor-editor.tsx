"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface BomValue {
  numVal?: number;
  textVal?: string;
}

const GOVERNOR_TYPE_OPTIONS = [
  "HOME", "1/LH R1", ".5/LH", "0.7/LH R1", ".35/RH",
  "1/RH", "1.5/LH R1", ".5/LH/RH", "SE-24", "HYD-6P",
  "1.88 TRP", ".5/RH", "0.5/RH", "0.7/LH", ".7/RH",
  "1/LH", "1/RH R1", "1.25/RH", "1.5/LH", "1.5/RH", "2.5/LH",
] as const;

const COMPONENT_LEAVES = [
  { variant: "CONT. STAND", unit: "pcs" },
  { variant: "TROUGHING 50", unit: "m" },
  { variant: "TROUGHING 100", unit: "m" },
  { variant: "LIMIT SWITCH", unit: "pcs" },
  { variant: "LIMIT SWITCH BRACKET", unit: "pcs" },
  { variant: "MAGNET WITH BRACKET", unit: "pcs" },
  { variant: "PIT SWITCH", unit: "pcs" },
  { variant: "BELT", unit: "m" },
] as const;

interface GovernorEditorProps {
  category: string;
  getBomValue: (cat: string, variant: string) => BomValue;
  setBomValue: (cat: string, variant: string, val: BomValue) => void;
}

export function GovernorEditor({
  category,
  getBomValue,
  setBomValue,
}: GovernorEditorProps) {
  const getText = (variant: string) =>
    getBomValue(category, variant).textVal ?? "";
  const getNum = (variant: string) =>
    getBomValue(category, variant).numVal;
  const setText = (variant: string, value: string) =>
    setBomValue(category, variant, { textVal: value || undefined });
  const setNum = (variant: string, value: string) =>
    setBomValue(category, variant, {
      numVal: value ? Number(value) : undefined,
    });

  const allVariants = ["Type", ...COMPONENT_LEAVES.map((l) => l.variant)];
  const filledCount = allVariants.filter((v) => {
    const val = getBomValue(category, v);
    return (val.numVal != null && val.numVal !== 0) || (val.textVal && val.textVal !== "");
  }).length;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-[var(--foreground)]">Governor</h3>
        {filledCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {filledCount}/{allVariants.length}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {/* Governor Type */}
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">
            Type
          </label>
          <Select
            value={getText("Type")}
            onChange={(e) => setText("Type", e.target.value)}
            className="h-8 text-sm"
          >
            <option value="">--</option>
            {GOVERNOR_TYPE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        </div>

        {/* Component fields */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {COMPONENT_LEAVES.map((leaf) => (
            <div key={leaf.variant}>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1 truncate" title={leaf.variant}>
                {leaf.variant}
                <span className="text-[10px] ml-1 opacity-60">({leaf.unit})</span>
              </label>
              <Input
                type="number"
                min={0}
                step="any"
                inputMode="numeric"
                className="h-8 text-sm"
                value={getNum(leaf.variant) ?? ""}
                onChange={(e) => setNum(leaf.variant, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
