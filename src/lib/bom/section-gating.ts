import type { BomSection } from "./bom-sections";

export function shouldRenderSection(
  section: BomSection,
  doorType: string | null,
  driveType: string | null,
): boolean {
  if (section.gate.kind === "always") return true;
  if (section.gate.kind === "doorType") {
    if (!doorType) return false;
    return section.gate.doors.includes(doorType);
  }
  if (section.gate.kind === "driveType") {
    if (!driveType) return false;
    return section.gate.drives.some((d) =>
      d.endsWith("-") ? driveType.startsWith(d) : driveType === d,
    );
  }
  if (section.gate.kind === "driveTypeExclude") {
    if (!driveType) return true;
    return !section.gate.drives.some((d) =>
      d.endsWith("-") ? driveType.startsWith(d) : driveType === d,
    );
  }
  return true;
}

export const DOOR_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "COL", label: "Collapsible" },
  { value: "MT", label: "Manual Telescopic" },
  { value: "CO", label: "Centre Opening" },
  { value: "AT", label: "Auto Telescopic" },
  { value: "AFF", label: "Auto Four-Fold" },
  { value: "BYPART", label: "Biparted" },
  { value: "SWS", label: "Swing-Sensor" },
  { value: "DUMB", label: "Dumbwaiter" },
];

// The drive types offered on the job form. The `value` is the stored code
// (BOM section gating + spec_string key off it — never rename a value without
// migrating jobs); the `label` is what the engineer sees. MR/MRL/Home are all
// rope drives, now labelled as such.
export const DRIVE_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "MR", label: "MR Rope" },
  { value: "MRL", label: "MRL Rope" },
  { value: "HOME", label: "Home Rope" },
  { value: "BELT", label: "Belt" },
  { value: "HYD", label: "Hydraulic" },
  { value: "CANTI", label: "Cantilever 3-phase" },
  { value: "R1000", label: "R1000" },
];

// Friendly label for a stored drive_type code. Falls back to the raw value for
// any legacy code no longer offered (e.g. old "ROPE" / "V3F" jobs) so existing
// data still reads sensibly.
export function driveTypeLabel(value: string | null | undefined): string {
  if (!value) return "";
  return DRIVE_TYPES.find((d) => d.value === value)?.label ?? value;
}

export const STOPS_OPTIONS = Array.from({ length: 30 }, (_, i) => i + 1);

export const CAPACITY_PASS = [4, 6, 8, 10, 13, 16, 20, 23, 26];
export const CAPACITY_KG = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
