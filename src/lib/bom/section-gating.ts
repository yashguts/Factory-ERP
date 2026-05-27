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

export const DRIVE_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "MR", label: "MR" },
  { value: "MRL", label: "MRL" },
  { value: "HOME", label: "Home" },
  { value: "V3F", label: "V3F" },
  { value: "MV3F", label: "MV3F" },
  { value: "BELT", label: "Belt" },
  { value: "HYD", label: "Hydraulic" },
  { value: "ROPE", label: "Rope" },
  { value: "CANTI", label: "Cantilever" },
];

export const STOPS_OPTIONS = Array.from({ length: 30 }, (_, i) => i + 1);

export const CAPACITY_PASS = [4, 6, 8, 10, 13, 16, 20, 23, 26];
export const CAPACITY_KG = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
