/**
 * Cabin program metadata + small pure helpers, shared by the server actions and
 * the client UI. Kept OUT of the "use server" actions file, which may only export
 * async functions.
 */
import { CABIN_PANEL_DESIGNER_FINISHES } from "@/lib/cabin/cabin-types";

export const CABIN_PROGRAM_CATEGORIES = ["Cabin", "Platform", "Canopy"] as const;
export type CabinProgramCategory = (typeof CABIN_PROGRAM_CATEGORIES)[number];

/** Finishes offered on the cabin-program form: base metals + SS grades + every
 *  designer finish. MS/GI and GI cover Platform/Canopy base sheet. */
export const CABIN_PROGRAM_FINISHES: string[] = [
  "MS",
  "MS/GI",
  "GI",
  "SS 304",
  "SS 430",
  "SS 441",
  ...CABIN_PANEL_DESIGNER_FINISHES,
];

/** Machine options (mirrors the Programs feature's active set). */
export const CABIN_PROGRAM_MACHINES = ["cnc_laser", "cnc_punch", "assembly_fit"] as const;

/** Third dimension of a sheet name, e.g. "1250x2500x1.2mm MS/GI" -> 1.2. */
export function sheetThicknessMm(name: string | null | undefined): number | null {
  if (!name) return null;
  const dims = /\d{3,4}\s*[xX]\s*\d{3,4}\s*[xX]\s*(\d+(?:\.\d+)?)\s*mm/.exec(name);
  if (dims) return parseFloat(dims[1]);
  const loose = /(\d+(?:\.\d+)?)\s*mm\b/i.exec(name);
  return loose ? parseFloat(loose[1]) : null;
}
