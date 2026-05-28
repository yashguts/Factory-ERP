/**
 * Compute the next available item code in the same series as `sourceCode`.
 *
 * Item codes follow a `PREFIX-SEQ` pattern where SEQ is the last
 * `-`-separated segment and is a zero-padded integer. We treat
 * everything before that final segment as the "prefix" and look across
 * `allCodes` for the highest SEQ that already exists in that prefix,
 * then return prefix + (max + 1) padded to the original width.
 *
 * Examples:
 *   nextCodeInSeries("SA-HD-057", [...]) → "SA-HD-058"
 *   nextCodeInSeries("DP-BP-BP-001", [...]) → "DP-BP-BP-002"
 *   nextCodeInSeries("FG-GR-004", ["FG-GR-004", "FG-GR-009"]) → "FG-GR-010"
 *
 * Returns null when the source code doesn't end in a numeric segment
 * (i.e. we can't safely extrapolate a successor).
 */
export function nextCodeInSeries(
  sourceCode: string,
  allCodes: readonly string[],
): string | null {
  const parts = sourceCode.split("-");
  if (parts.length < 2) return null;

  const seqPart = parts[parts.length - 1];
  if (!/^\d+$/.test(seqPart)) return null;

  const prefix = parts.slice(0, -1).join("-") + "-";
  const seqWidth = seqPart.length;

  let maxSeq = 0;
  for (const code of allCodes) {
    if (!code.startsWith(prefix)) continue;
    const tail = code.slice(prefix.length);
    // Only consider tails that are pure numbers — don't get tripped up
    // by codes like `SA-HD-057-OLD` if any ever exist.
    if (!/^\d+$/.test(tail)) continue;
    const n = parseInt(tail, 10);
    if (n > maxSeq) maxSeq = n;
  }

  const next = maxSeq + 1;
  return prefix + String(next).padStart(seqWidth, "0");
}
