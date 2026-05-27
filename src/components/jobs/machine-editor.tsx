"use client";

import { useMemo } from "react";
import { FuzzySelect } from "@/components/ui/fuzzy-select";
import type { FuzzySelectOption } from "@/components/ui/fuzzy-select";

interface BomValue {
  numVal?: number;
  textVal?: string;
}

const MACHINE_TRACTION = [
  "Machine Unit ECO Space (TRACTION)",
  "Machine Unit ECO Space SE-24",
  "Machine Unit 4 pass/200mm/4g/6mm/Home",
  "Machine Unit 6 Pass/200mm/4g/8mm",
  "Machine Unit 6 Pass/240mm/4g/8mm",
  "Machine Unit 6 pass/320mm/4g/8mm",
  "Machine Unit 6 pass/320mm/4g/8mm/1.5 m/s",
  "Machine Unit 6 pass/320mm/5g/8mm/1.75 m/s",
  "Machine Unit 8 pass/320mm/4g/8mm",
  "Machine Unit 8 pass/320mm/4g/8mm/1.6 m/s",
  "Machine Unit 8 pass/320mm/5g/8mm/1.75 m/s",
  "Machine Unit 10 Pass/240mm/5g/8mm",
  "Machine Unit 10 pass/320mm/5g/8mm",
  "Machine Unit 10 pass/320mm/6g/8mm/1.5 m/s",
  "Machine Unit 10 pass/320mm/6g/8mm/1.75 m/s",
  "Machine Unit 13 pass/320mm/6g/8mm",
  "Machine Unit 13 pass/400mm/5g/10mm/1.75 m/s",
  "Machine Unit 16 pass/320mm/7g/8mm",
  "Machine Unit 16 pass/320mm/6g/8mm",
  "Machine Unit 16 pass/485mm/6g/10mm/2.5 m/s",
  "Machine Unit 20 Pass/320mm/8g/8mm",
  "Machine Unit 20 Pass/320mm/8g/8mm/1.5 m/s",
  "Machine Unit 20 Pass/320mm/8g/8mm/1.75 m/s",
  "Machine Unit 20 Pass/320mm/8g/8mm/2.5 m/s",
  "Machine Unit 26 Pass/320mm/10g/8mm",
  "Machine Unit 26 Pass/480mm/10g/8mm",
  "Machine Unit 1250kg/320mm/9g/8mm",
  "Machine Unit 2500kg/320mm/9g/8mm/2.0 m/s",
  "Machine Unit 1600kg/320mm/10g/8mm",
  "Machine Unit 2000kg/320mm/10g/8mm",
] as const;

const MACHINE_BELT = [
  "Machine Unit 4 pass/100mm/2g/30mm/Home BELT",
  "Machine Unit Belt 13 Pass/6.8 KW/1.0M/S",
  "Machine Unit Belt 20 Pass/6.8 KW/1.0M/S",
] as const;

const MACHINE_HP = [
  "Machine Unit 3 HP/DRUM-TYPE",
  "Machine Unit 5 HP/530mm/3g/10mm/940rpm/0.65 m/s (STELLAR)",
  "Machine Unit 6 HP/530mm/3g/13mm/1440rpm/1.0 m/s (STELLAR)",
  "Machine Unit 7.5 HP/530mm/3g/13mm/1440rpm (V3F)",
  "Machine Unit 10 HP/610mm/4g/13mm/1440rpm (V3F)",
  "Machine Unit 12.5 HP/610mm/4g/13mm/1440rpm (V3F)",
  "Machine Unit 12.5 HP/610mm/4g/13mm/1440rpm (V3F)/1.5m/s",
  "Machine Unit 15 HP/610mm/4g/13mm/1440rpm (V3F)",
  "Machine Unit 20 HP/610mm/6g/13mm/1440rpm (V3F)",
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
  const value = getBomValue(category, "Type").textVal ?? "";
  const setValue = (v: string) =>
    setBomValue(category, "Type", { textVal: v || undefined });

  const filled = value !== "";

  const options: FuzzySelectOption[] = useMemo(
    () => [
      ...MACHINE_TRACTION.map((o) => ({ value: o, group: "Traction" })),
      ...MACHINE_BELT.map((o) => ({ value: o, group: "Belt" })),
      ...MACHINE_HP.map((o) => ({ value: o, group: "HP / Geared" })),
    ],
    [],
  );

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-[var(--foreground)]">Machine</h3>
        {filled && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            1/1
          </span>
        )}
      </div>
      <div>
        <label className="block text-xs text-[var(--muted-foreground)] mb-1">
          Machine Unit
        </label>
        <FuzzySelect
          options={options}
          value={value}
          onChange={setValue}
          placeholder="-- Select Machine --"
        />
      </div>
    </div>
  );
}
