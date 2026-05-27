"use client";

import { Select } from "@/components/ui/select";

interface BomValue {
  numVal?: number;
  textVal?: string;
}

const MACHINE_OPTIONS = [
  "ECO", "SE-24", "HOME", "Hydraulic",
  "6P/200", "6P/240 PULLY", "6P", "6P/1.5", "6P/1.75",
  "8P", "8P/1.5", "8P/1.75",
  "10P/240 PULLY", "10P", "10P/1.5", "10P/1.75",
  "13P", "13P/1.75",
  "16P", "16P/N", "16P/2.5",
  "20P", "20P/1.5", "20P/1.75", "20P/2.5",
  "26P", "26P/1.25",
  "1250KG", "1250KG/2mts", "1600KG", "2000KG",
  "BELT", "BELT-13P", "BELT-20P",
  "3HP", "5HP", "6HP", "7.5HP", "10HP", "12.5HP", "12.5HP/1.5", "15HP", "20HP",
  "HYD-6P", "HYD-500KG",
] as const;

interface MachineEditorProps {
  category: string;
  getBomValue: (cat: string, variant: string) => BomValue;
  setBomValue: (cat: string, variant: string, val: BomValue) => void;
}

export function MachineEditor({
  category,
  getBomValue,
  setBomValue,
}: MachineEditorProps) {
  const getText = (variant: string) =>
    getBomValue(category, variant).textVal ?? "";
  const setText = (variant: string, value: string) =>
    setBomValue(category, variant, { textVal: value || undefined });

  const filledCount = ["Machine Type", "Machine Capacity"].filter((v) => {
    const val = getBomValue(category, v);
    return val.textVal && val.textVal !== "";
  }).length;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-[var(--foreground)]">Machine</h3>
        {filledCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {filledCount}/2
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">
            Machine Type
          </label>
          <Select
            value={getText("Machine Type")}
            onChange={(e) => setText("Machine Type", e.target.value)}
            className="h-8 text-sm"
          >
            <option value="">--</option>
            {MACHINE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">
            Machine Capacity
          </label>
          <Select
            value={getText("Machine Capacity")}
            onChange={(e) => setText("Machine Capacity", e.target.value)}
            className="h-8 text-sm"
          >
            <option value="">--</option>
            {MACHINE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}
