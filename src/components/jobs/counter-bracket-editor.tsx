"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FuzzySelect } from "@/components/ui/fuzzy-select";
import type { FuzzySelectOption } from "@/components/ui/fuzzy-select";

interface BomValue {
  numVal?: number;
  textVal?: string;
}

const TYPE_OPTIONS = [
  "A",
  "B(65-100)",
  "C(100-145)",
  "D(145-190)",
  "E(190-235)",
  "F(235-280)",
  "G(280-325)",
  "Counter Goods Bracket",
] as const;

const MAX_TYPES = 4;

interface CounterBracketEditorProps {
  category: string;
  getBomValue: (cat: string, variant: string) => BomValue;
  setBomValue: (cat: string, variant: string, val: BomValue) => void;
}

export function CounterBracketEditor({
  category,
  getBomValue,
  setBomValue,
}: CounterBracketEditorProps) {
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

  const countRaw = get("Number of Types");
  const count = Math.min(MAX_TYPES, Math.max(1, Number(countRaw) || 1));

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <h3 className="font-medium text-[var(--foreground)] mb-3">
        COUNTER BRACKET
      </h3>
      <p className="text-xs text-[var(--muted-foreground)] mb-3">
        Counter bracket types (1–4). Shown for MR and Hydraulic drives.
      </p>

      <div className="space-y-3">
        {/* Number of Types — native since only 4 options */}
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">
            Number of Counter Bracket Types
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
          return (
            <div
              key={n}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3"
            >
              <h5 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-2">
                Counter Bracket Type {n}
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                {/* Type dropdown */}
                <div>
                  <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                    Type
                  </label>
                  <FuzzySelect
                    options={typeOpts}
                    value={get(`Type ${n}`)}
                    onChange={(v) => set(`Type ${n}`, v)}
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
