"use client";

import { Select } from "@/components/ui/select";

export interface PlanFilterValue {
  type: string;
  category: string;
  sub: string;
}
export const EMPTY_PLAN_FILTER: PlanFilterValue = { type: "all", category: "all", sub: "all" };

/** A row carries the three filterable dimensions of the item it represents. */
export interface FilterableRow {
  type: string;
  category: string; // top-level category
  subCategory: string; // direct (sub-)category
}

const TYPE_LABELS: Record<string, string> = {
  raw_material: "Raw Material",
  sub_assembly: "Sub Assembly",
  finished_good: "Finished Good",
  mechanical_finished_stock: "Mech. Finished Stock",
  door_panel: "Door Panel",
};
const typeLabel = (t: string) => TYPE_LABELS[t] ?? t;
const uniq = (a: string[]) => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y));

export function planMatches(r: FilterableRow, v: PlanFilterValue): boolean {
  if (v.type !== "all" && r.type !== v.type) return false;
  if (v.category !== "all" && r.category !== v.category) return false;
  if (v.sub !== "all" && r.subCategory !== v.sub) return false;
  return true;
}

/**
 * Type / Category / Sub-category filter row, matching the Inventory page. Sub-category
 * options are scoped to the selected category. Options are derived from the supplied
 * rows so only values that actually appear are offered.
 */
export function PlanFilters({
  rows,
  value,
  onChange,
}: {
  rows: FilterableRow[];
  value: PlanFilterValue;
  onChange: (v: PlanFilterValue) => void;
}) {
  const types = uniq(rows.map((r) => r.type));
  const cats = uniq(rows.map((r) => r.category));
  const subs = uniq(
    rows.filter((r) => value.category === "all" || r.category === value.category).map((r) => r.subCategory),
  );
  const active = value.type !== "all" || value.category !== "all" || value.sub !== "all";

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <Select
        size="sm"
        value={value.type}
        onChange={(e) => onChange({ ...value, type: e.target.value })}
        className="w-auto min-w-[150px]"
      >
        <option value="all">All Types</option>
        {types.map((t) => (
          <option key={t} value={t}>{typeLabel(t)}</option>
        ))}
      </Select>
      <Select
        size="sm"
        value={value.category}
        onChange={(e) => onChange({ ...value, category: e.target.value, sub: "all" })}
        className="w-auto min-w-[160px]"
      >
        <option value="all">All Categories</option>
        {cats.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </Select>
      <Select
        size="sm"
        value={value.sub}
        onChange={(e) => onChange({ ...value, sub: e.target.value })}
        className="w-auto min-w-[170px]"
      >
        <option value="all">All Sub-categories</option>
        {subs.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </Select>
      {active && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_PLAN_FILTER)}
          className="text-xs text-[var(--primary)] hover:underline cursor-pointer"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
