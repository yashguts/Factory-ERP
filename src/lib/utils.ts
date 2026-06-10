import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a duration in seconds as "H:MM:SS" (machining/program time). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Parse a user-typed machining time into seconds. Accepts "h:mm:ss",
 * "mm:ss" or plain decimal minutes ("7.05"). Returns null for blank,
 * NaN-equivalent input returns undefined (invalid).
 */
export function parseDuration(input: string): number | null | undefined {
  const t = input.trim();
  if (!t) return null;
  const parts = t.split(":").map((p) => p.trim());
  if (parts.length === 3 || parts.length === 2) {
    if (parts.some((p) => p === "" || !/^\d+$/.test(p))) return undefined;
    const nums = parts.map(Number);
    const [h, m, s] = parts.length === 3 ? nums : [0, nums[0], nums[1]];
    if (m > 59 || s > 59) return undefined;
    const total = h * 3600 + m * 60 + s;
    return total > 0 ? total : undefined;
  }
  const mins = Number(t);
  if (!Number.isFinite(mins) || mins <= 0) return undefined;
  return Math.round(mins * 60);
}
