"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FuzzySelect } from "@/components/ui/fuzzy-select";
import type { FuzzySelectOption } from "@/components/ui/fuzzy-select";
import { cn } from "@/lib/utils";

interface BomValue {
  numVal?: number;
  textVal?: string;
}

const TYPE_OPTIONS = [
  "M",
  "B",
  "C",
  "D (Dumbwaiter)",
  "E 260-310",
  "F 310-360",
  "G 360-410",
  "H 410-460",
  "Combination",
  "Fabricated",
  "Home",
  "Home Special",
] as const;

const COMBO_GROUPS: ReadonlyArray<{ family: string; options: readonly string[] }> = [
  { family: "710", options: ["710/S", "710/260", "710/B", "710X50 R1"] },
  {
    family: "850",
    options: [
      "850/S",
      "850/260",
      "850/B",
      "850X50 R1",
      "850x65/S",
      "850x65/260",
      "850X65 R1",
    ],
  },
  { family: "1050x50", options: ["1050x50/S", "1050x50/260", "1050x50/B"] },
  {
    family: "1050x65",
    options: [
      "1050x65/S",
      "1050x65/260",
      "1050x65/300",
      "1050x65/350",
      "1050x65 R1",
    ],
  },
  { family: "1350x50", options: ["1350x50/S", "1350x50/260", "1350x50/B"] },
  { family: "1350x65", options: ["1350x65/S", "1350x65/260", "1350x65/B"] },
];
const COMBO_STANDALONE = ["2450X65"] as const;
const MAX_TYPES = 4;

interface MainBracketEditorProps {
  category: string;
  getBomValue: (cat: string, variant: string) => BomValue;
  setBomValue: (cat: string, variant: string, val: BomValue) => void;
}

export function MainBracketEditor({
  category,
  getBomValue,
  setBomValue,
}: MainBracketEditorProps) {
  const get = (variant: string) => {
    const v = getBomValue(category, variant);
    return v.textVal ?? (v.numVal != null ? String(v.numVal) : "");
  };
  const set = (variant: string, value: string) => {
    setBomValue(category, variant, { textVal: value });
  };
  const setNum = (variant: string, value: string) => {
    setBomValue(category, variant, {
      numVal: value ? Number(value) : undefined,
    });
  };

  const typeOpts: FuzzySelectOption[] = useMemo(
    () => TYPE_OPTIONS.map((o) => ({ value: o })),
    [],
  );

  const comboOpts: FuzzySelectOption[] = useMemo(
    () => [
      ...COMBO_GROUPS.flatMap((g) =>
        g.options.map((o) => ({ value: o, group: g.family })),
      ),
      ...COMBO_STANDALONE.map((o) => ({ value: o })),
    ],
    [],
  );

  const countRaw = get("Number of Types");
  const count = Math.min(MAX_TYPES, Math.max(1, Number(countRaw) || 1));

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 lg:col-span-2">
      <h3 className="font-medium text-[var(--foreground)] mb-3">
        MAIN BRACKET
      </h3>
      <p className="text-xs text-[var(--muted-foreground)] mb-3">
        Pick how many bracket types this job uses (1–4), then specify each one.
      </p>

      <div className="space-y-3">
        {/* Number of Types selector — keep native since it's only 4 options */}
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">
            Number of Main Bracket Types
          </label>
          <Select
            value={countRaw}
            onChange={(e) => set("Number of Types", e.target.value)}
            className="w-40 h-8 text-sm"
          >
            <option value="">—</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </Select>
        </div>

        {/* Bracket rows */}
        {Array.from({ length: count }, (_, idx) => {
          const n = idx + 1;
          const typeVal = get(`Type ${n}`);
          const isCombo = typeVal === "Combination";
          return (
            <div
              key={n}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3"
            >
              <h5 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-2">
                Main Bracket Type {n}
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                {/* Type dropdown */}
                <div>
                  <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                    Type
                  </label>
                  <FuzzySelect
                    options={typeOpts}
                    value={typeVal}
                    onChange={(v) => set(`Type ${n}`, v)}
                  />
                </div>

                {/* Combination sub-dropdown */}
                <div
                  className={cn(
                    "pl-3 border-l-2 border-blue-400/30",
                    !isCombo && "opacity-40 pointer-events-none",
                  )}
                >
                  <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                    Combination Bracket Type
                  </label>
                  <FuzzySelect
                    options={comboOpts}
                    value={get(`Combination ${n}`)}
                    onChange={(v) => set(`Combination ${n}`, v)}
                    disabled={!isCombo}
                  />
                </div>

                {/* Quantity */}
                <div>
                  <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                    Quantity (pcs)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={getBomValue(category, `Quantity ${n}`).numVal ?? ""}
                    onChange={(e) => setNum(`Quantity ${n}`, e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
