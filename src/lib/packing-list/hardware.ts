/**
 * Hardware (nut-bolts & screws) catalogue + the per-category "Hardware" sections.
 *
 * The 13 fastener types used to be their own two categories (Nut-Bolts / Screws).
 * Now they're a manual "+ Add Hardware" picker available INSIDE every other category
 * (except Misc Fitted), so bolts/screws sit with the parts they fix. Each item
 * carries its own size pick-list. Pure data + helpers — shared by the section
 * template (packing-list-sections.ts) and the Part List UI (partlist-client.tsx).
 */
import type { PackingSection } from "./packing-list-sections";

// The two size pick-lists carried by the old Nut-Bolts / Screws sections.
const BOLT_SPECS = ["16x100", "16x60", "16x40", "12x120", "12x75", "12x50", "12x40", "12x30", "12x25", "12x20", "10x75", "10x40", "10x30", "10x20", "8x50", "8x35", "8x20", "6x50", "6x35", "6x20", "6x12"];
const SCREW_SPECS = ["5x20", "6x25", "8x35", "6x15", "5x65", "6x13", "6x20", "5x12", "5x15", "5x50"];

export interface HardwareItem {
  label: string;
  specOptions: string[];
}

/** The 13 hardware items (9 nut-bolts + 4 screws), each with its size pick-list. */
export const HARDWARE_ITEMS: HardwareItem[] = [
  { label: "Bolt+S.W", specOptions: BOLT_SPECS },
  { label: "Bolt+S.W.", specOptions: BOLT_SPECS },
  { label: "Bolt+S.W+F.WD", specOptions: BOLT_SPECS },
  { label: "Bolt+S.W+F.W (Small O/D)", specOptions: BOLT_SPECS },
  { label: "Bolt+F.W+S.W+Nut", specOptions: BOLT_SPECS },
  { label: "Bolt+Nut+D.FW.+S.W", specOptions: BOLT_SPECS },
  { label: "Bolt+Nut+S.W+F.W (Small O/D)", specOptions: BOLT_SPECS },
  { label: "Bolt+D.Nut+S.W+F.W+T.W+Sq.W", specOptions: BOLT_SPECS },
  { label: "Nut & Flat Washner", specOptions: BOLT_SPECS },
  { label: "Screw Ch.Hd+Nut+F.W", specOptions: SCREW_SPECS },
  { label: "C.S.K Screw Nut+S.W+F.W", specOptions: SCREW_SPECS },
  { label: "Self Tap Screw", specOptions: SCREW_SPECS },
  { label: "Wooden Screw", specOptions: SCREW_SPECS },
];

/** The size pick-list for a chosen hardware item ([] if none/unknown). */
export function hardwareSpecOptions(label: string | null): string[] {
  if (!label) return [];
  return HARDWARE_ITEMS.find((h) => h.label === label)?.specOptions ?? [];
}

/** Categories that get a "+ Add Hardware" button — every category EXCEPT Misc
 *  Fitted (and the removed Nut-Bolts / Screws + the BOM "Unsorted" bucket).
 *  Order mirrors the category order on the page. */
export const HARDWARE_GROUPS = [
  "Rails", "Brackets", "Machine", "Rope", "Pulley", "Oil",
  "Header & Sill", "Doors", "Safety", "Counter", "Limit & Cam",
  "Hoistway Items", "Cabin Items",
];

const slug = (g: string): string => g.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const hardwareSectionKey = (group: string): string => `p-hw-${slug(group)}`;
export const isHardwareKey = (key: string): boolean => key.startsWith("p-hw-");

/** One "Hardware" section per eligible category. Capture type 'free' so the save +
 *  completion-gate logic treats hardware rows like any other manual (non-inventory)
 *  line — no inventory item required. */
export const HARDWARE_SECTIONS: PackingSection[] = HARDWARE_GROUPS.map((g): PackingSection => ({
  key: hardwareSectionKey(g),
  label: "Hardware",
  captureType: "free",
  categoryPaths: [],
  specHint: "",
}));

/** sectionKey → category, merged into the UI's grouping map so each Hardware
 *  section lands under the right category. */
export const HARDWARE_GROUP_MAP: Record<string, string> = Object.fromEntries(
  HARDWARE_GROUPS.map((g) => [hardwareSectionKey(g), g]),
);
