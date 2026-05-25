import type { ParsedRow } from "../types";
import type { ItemType } from "@/lib/supabase/types";

const CATEGORY_MAP: Record<string, { abbr: string; category: string; subCategory: string }> = {
  "guide rail": { abbr: "GR", category: "Mechanical", subCategory: "Guide Rails" },
  "machine unit": { abbr: "MU", category: "Mechanical", subCategory: "Machine Units" },
  "machine belt": { abbr: "MB", category: "Mechanical", subCategory: "Machine Units" },
  "belt detector": { abbr: "BD", category: "Electrical", subCategory: "Belt Detector" },
  oil: { abbr: "OL", category: "Mechanical", subCategory: "Oils & Lubricants" },
  "oil pot": { abbr: "OP", category: "Mechanical", subCategory: "Oils & Lubricants" },
  "wire rope": { abbr: "WR", category: "Mechanical", subCategory: "Wire Rope & Rigging" },
  "rope belt": { abbr: "RB", category: "Mechanical", subCategory: "Wire Rope & Rigging" },
  thimble: { abbr: "TH", category: "Mechanical", subCategory: "Wire Rope & Rigging" },
  "bull dog clip": { abbr: "BC", category: "Mechanical", subCategory: "Wire Rope & Rigging" },
  "bulldog clip": { abbr: "BC", category: "Mechanical", subCategory: "Wire Rope & Rigging" },
  "d shackle": { abbr: "DS", category: "Mechanical", subCategory: "Wire Rope & Rigging" },
  "pvc hanger": { abbr: "PH", category: "Mechanical", subCategory: "Wire Rope & Rigging" },
  "retiring cam": { abbr: "RC", category: "Safety", subCategory: "Retiring Cam" },
  "fan grill": { abbr: "FN", category: "Cabin & Interiors", subCategory: "Fan & Ventilation" },
  fan: { abbr: "FN", category: "Cabin & Interiors", subCategory: "Fan & Ventilation" },
  "aluminium sill": { abbr: "AS", category: "Doors", subCategory: "Aluminium Sill" },
  "landing header": { abbr: "LH", category: "Doors", subCategory: "Landing Header System" },
  "car header": { abbr: "CH", category: "Doors", subCategory: "Car Header System" },
  "dead weight": { abbr: "DW", category: "Mechanical", subCategory: "Dead Weight" },
  header: { abbr: "HD", category: "Doors", subCategory: "Landing Header System" },
  "door shoe": { abbr: "DC", category: "Doors", subCategory: "Door Shoe Channel" },
  "door channel": { abbr: "DC", category: "Doors", subCategory: "Door Shoe Channel" },
  "safety block": { abbr: "SB", category: "Safety", subCategory: "Safety Devices" },
  "speed governor": { abbr: "SG", category: "Safety", subCategory: "Safety Devices" },
  buffer: { abbr: "BF", category: "Safety", subCategory: "Safety Devices" },
  "push button": { abbr: "PB", category: "Electrical", subCategory: "Push Buttons" },
  controller: { abbr: "CT", category: "Electrical", subCategory: "Controllers" },
  motor: { abbr: "MO", category: "Electrical", subCategory: "Motors" },
  encoder: { abbr: "EN", category: "Electrical", subCategory: "Encoders" },
  brake: { abbr: "BK", category: "Mechanical", subCategory: "Machine Units" },
};

function detectCategory(sectionHeader: string): { abbr: string; category: string; subCategory: string } | null {
  const lower = sectionHeader.toLowerCase();
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

function generateSequenceCode(prefix: string, itemType: ItemType, seq: number): string {
  const typePrefix = itemType === "finished_good" ? "FG" : "SA";
  return `${typePrefix}-${prefix}-${String(seq).padStart(3, "0")}`;
}

export function parseFinishedStock(rows: string[][]): ParsedRow[] {
  const results: ParsedRow[] = [];
  let currentCategory: { abbr: string; category: string; subCategory: string } | null = null;
  const sequenceCounters: Record<string, number> = {};

  for (const row of rows) {
    const colA = String(row[0] ?? "").trim();
    const colB = String(row[1] ?? "").trim();
    const colC = String(row[2] ?? "").trim();
    const colD = String(row[3] ?? "").trim();
    const colG = String(row[6] ?? "").trim();
    const colL = String(row[11] ?? "").trim();

    if (colA && !colB) {
      const detected = detectCategory(colA);
      if (detected) currentCategory = detected;
      continue;
    }

    if (!colB) continue;
    if (colB.toLowerCase() === "name") continue;

    const name = colB;
    const spec = colC;
    const stock = parseFloat(colG) || 0;
    const tradeOrMake = colL.toLowerCase().trim();

    const itemType: ItemType = tradeOrMake === "make" ? "sub_assembly" : "finished_good";

    const cat = currentCategory || { abbr: "GN", category: "Mechanical", subCategory: "General" };

    const counterKey = `${itemType === "finished_good" ? "FG" : "SA"}-${cat.abbr}`;
    sequenceCounters[counterKey] = (sequenceCounters[counterKey] || 0) + 1;

    const code = generateSequenceCode(cat.abbr, itemType, sequenceCounters[counterKey]);
    const description = spec ? `${name} - ${spec}` : name;

    results.push({
      code,
      name,
      description,
      lookup_key: colD || `${name} ${spec}`.trim(),
      item_type: itemType,
      category_name: cat.category,
      sub_category_name: cat.subCategory,
      current_stock: stock,
      uom: "nos",
    });
  }

  return results;
}
