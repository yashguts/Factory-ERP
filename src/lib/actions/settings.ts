"use server";

import { unstable_cache } from "next/cache";
import { createCacheClient } from "@/lib/supabase/cache-client";
import { fetchAllRanged } from "@/lib/supabase/fetch-all";
import { getItemStockSummaries } from "@/lib/actions/inventory";
import { getMrpData, getJobDriveDemandRules } from "@/lib/actions/mrp";

/* ================================================================== */
/*  Settings · Overstocked items                                       */
/*                                                                    */
/*  Items we're holding meaningfully MORE of than current job demand   */
/*  needs — capital sitting on the floor, and a "don't buy more" hint. */
/*  Reuses the cached MRP demand + stock reads (this wrapper is NOT     */
/*  cached, so calling the cached reads here is safe — no nesting).     */
/* ================================================================== */

export interface OverstockRow {
  item_id: string;
  code: string;
  name: string;
  category_name: string | null;
  uom: string | null;
  procurement_type: "make" | "trade" | null;
  in_stock: number;
  /** Current requirement across in-production jobs (0 = nothing needs it now). */
  required: number;
  /** in_stock − required (always > 0 in this list). */
  excess: number;
  /** in_stock / required, or null when there's no current demand. */
  ratio: number | null;
  /** True when at least one in-production job currently needs this item. */
  has_demand: boolean;
}

export async function getOverstockItems(): Promise<OverstockRow[]> {
  const [items, mrp] = await Promise.all([
    getItemStockSummaries(),
    getMrpData(),
  ]);
  const reqByItem = new Map(mrp.map((r) => [r.item_id, r.total_required]));

  const out: OverstockRow[] = [];
  for (const it of items) {
    const in_stock = it.total_stock ?? 0;
    if (in_stock <= 0) continue;
    const required = reqByItem.get(it.id) ?? 0;
    const excess = in_stock - required;
    // "Much greater than requirement": skip trivial overages; for items a job
    // currently needs, require holding at least 1.5× the need; items with no
    // current demand qualify on the excess floor alone (idle / dead stock).
    if (excess < 5) continue;
    if (required > 0 && in_stock < required * 1.5) continue;
    out.push({
      item_id: it.id,
      code: it.code,
      name: it.name,
      category_name: it.category_name,
      uom: it.uom_abbreviation,
      procurement_type: it.effective_procurement_type,
      in_stock,
      required,
      excess,
      ratio: required > 0 ? in_stock / required : null,
      has_demand: required > 0,
    });
  }
  out.sort((a, b) => b.excess - a.excess);
  return out;
}

/* ================================================================== */
/*  Settings · Demand rules (plain-English documentation)              */
/*                                                                    */
/*  A living, read-only doc of every rule the ERP uses to INVENT       */
/*  demand that isn't a direct job-BOM line, so the team can see why    */
/*  MRP asks for things. Three kinds today:                            */
/*   1. Component rules (item_demand_rules) — child per demanded parent */
/*   2. Drive-type rules (JOB_DRIVE_DEMAND in mrp.ts)                   */
/*   3. Structural explosion (item_bom_lines / finish rules) — noted    */
/* ================================================================== */

/** One distinct "child × qty" line within a component-rule family. */
export interface ComponentRuleLine {
  child_code: string;
  child_name: string;
  qty: number;
  /** How many distinct parent items trigger this child-at-this-qty. */
  parent_count: number;
  /** A few example parents, for context. */
  example_parents: { code: string; name: string }[];
}

export interface ComponentRuleFamily {
  /** The rule's `note` (its family key), e.g. "safety frame guide shoe". */
  note: string;
  rule_count: number;
  parent_count: number;
  lines: ComponentRuleLine[];
}

export interface DriveRuleDoc {
  code: string;
  name: string;
  drive_types: string[];
  qty_per_job: number;
}

export interface DemandRulesDoc {
  componentFamilies: ComponentRuleFamily[];
  driveRules: DriveRuleDoc[];
  /** Totals for the header. */
  componentRuleCount: number;
}

export async function getDemandRulesDoc(): Promise<DemandRulesDoc> {
  // Rule edits (demand-rules.ts revalidateDemand) and item renames both bust
  // the "items" tag, so the cached doc stays fresh; drive rules are a constant.
  return unstable_cache(_getDemandRulesDocUncached, ["demand-rules-doc"], {
    revalidate: 300,
    tags: ["items"],
  })();
}

async function _getDemandRulesDocUncached(): Promise<DemandRulesDoc> {
  const supabase = createCacheClient();

  // Two independent chains — component rules (+ name resolution) and the
  // constant drive-type rules (+ name lookup) — run concurrently.
  const [{ rules, nameById }, { driveRulesRaw, driveNameByCode }] = await Promise.all([
    (async () => {
      const rules = await fetchAllRanged<{
        parent_item_id: string;
        child_item_id: string;
        qty: number;
        note: string | null;
      }>((from, to, withCount) =>
        supabase
          .from("item_demand_rules")
          .select("parent_item_id, child_item_id, qty, note", withCount ? { count: "exact" } : {})
          .range(from, to),
      );

      // Resolve every referenced item's code + name; the 300-id chunks are
      // independent of each other, so fetch them in parallel.
      const ids = [
        ...new Set(rules.flatMap((r) => [r.parent_item_id, r.child_item_id])),
      ];
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));
      const results = await Promise.all(
        chunks.map((chunk) =>
          supabase.from("items").select("id, code, name").in("id", chunk),
        ),
      );
      const nameById = new Map<string, { code: string; name: string }>();
      for (const { data, error } of results) {
        if (error) throw error;
        for (const it of data ?? [])
          nameById.set(it.id as string, { code: it.code as string, name: it.name as string });
      }
      return { rules, nameById };
    })(),
    (async () => {
      const driveRulesRaw = await getJobDriveDemandRules();
      // Resolve drive-rule item names too (codes are a compile-time constant).
      const driveCodes = [...new Set(driveRulesRaw.map((r) => r.code))];
      const driveNameByCode = new Map<string, string>();
      if (driveCodes.length > 0) {
        const { data } = await supabase.from("items").select("code, name").in("code", driveCodes);
        for (const it of data ?? []) driveNameByCode.set(it.code as string, it.name as string);
      }
      return { driveRulesRaw, driveNameByCode };
    })(),
  ]);
  const nm = (id: string) => nameById.get(id) ?? { code: "—", name: "(unknown)" };

  // Group: note → (child_id|||qty) → { parents }.
  const families = new Map<
    string,
    { parents: Set<string>; lines: Map<string, { childId: string; qty: number; parents: Set<string> }> }
  >();
  for (const r of rules) {
    const note = (r.note ?? "Other rules").trim() || "Other rules";
    const fam = families.get(note) ?? { parents: new Set<string>(), lines: new Map() };
    fam.parents.add(r.parent_item_id);
    const key = `${r.child_item_id}|||${Number(r.qty)}`;
    const line = fam.lines.get(key) ?? { childId: r.child_item_id, qty: Number(r.qty) || 0, parents: new Set<string>() };
    line.parents.add(r.parent_item_id);
    fam.lines.set(key, line);
    families.set(note, fam);
  }

  const componentFamilies: ComponentRuleFamily[] = Array.from(families.entries())
    .map(([note, fam]) => ({
      note,
      rule_count: Array.from(fam.lines.values()).reduce((s, l) => s + l.parents.size, 0),
      parent_count: fam.parents.size,
      lines: Array.from(fam.lines.values())
        .map((l) => {
          const child = nm(l.childId);
          const examples = Array.from(l.parents)
            .slice(0, 3)
            .map((pid) => nm(pid));
          return {
            child_code: child.code,
            child_name: child.name,
            qty: l.qty,
            parent_count: l.parents.size,
            example_parents: examples,
          };
        })
        .sort((a, b) => b.parent_count - a.parent_count),
    }))
    .sort((a, b) => b.parent_count - a.parent_count);

  const driveRules: DriveRuleDoc[] = driveRulesRaw.map((r) => ({
    code: r.code,
    name: driveNameByCode.get(r.code) ?? r.code,
    drive_types: r.driveTypes,
    qty_per_job: r.qtyPerJob,
  }));

  return {
    componentFamilies,
    driveRules,
    componentRuleCount: rules.length,
  };
}
