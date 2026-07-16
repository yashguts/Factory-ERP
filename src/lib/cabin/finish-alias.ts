/**
 * Canonical finish names (owner, 2026-07-11).
 *
 * The factory writes the SAME physical finish under several names on hand
 * sketches and older records — e.g. the designer sheet "White Mirror Silver"
 * (RM-037) appears as "White Mirror", "Silver Mirror", "White Silver Mirror"
 * or "Mirror Silver". Cabin Inventory itself is canonical (`items.finish` =
 * "White Mirror Silver" on all fanned items), so anything matching against it
 * must normalise first. Used by the cabin sketch autofill; apply to any new
 * finish-matching surface. Data-side, migration 066 renamed the door-world
 * "(Silver Mirror)" items + program labels to the canonical name.
 *
 * NOT aliases: plain "Mirror", "Black/Golden/Rose Gold/Grade 430 Mirror"
 * (separate finish families) and "Silver Mirror Etchaing JE-131" (a different
 * designer sheet, RM-206).
 */
const FINISH_ALIASES: Record<string, string> = {
  "white mirror": "White Mirror Silver",
  "silver mirror": "White Mirror Silver",
  "white silver mirror": "White Mirror Silver",
  "mirror silver": "White Mirror Silver",
  "ss silver mirror": "White Mirror Silver",
  "ss white mirror silver": "White Mirror Silver",
};

/** Map a written finish to its canonical name (unknown finishes pass through
 *  trimmed; null stays null). Alias keys are matched case/space-insensitively. */
export function canonicalFinish(finish: string | null): string | null {
  if (finish == null) return null;
  const trimmed = finish.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase().replace(/\s+/g, " ");
  return FINISH_ALIASES[key] ?? trimmed;
}
