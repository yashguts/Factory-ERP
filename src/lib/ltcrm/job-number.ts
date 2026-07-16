/**
 * LT Elevator CRM job-number matching.
 *
 * LT CRM job numbers are a city prefix + numeric suffix, stored split
 * (cities.prefix + jobs.job_number). Indian offices use ISO-3166-2 style
 * prefixes with an embedded dash ("IN-WB-4110"); foreign offices use the bare
 * country code ("BT-0001"). Both sides normalise to "PREFIX|NUMBER" with
 * leading zeros stripped before matching. The SQL side lives in
 * erp_job_financials() on the LT Elevator CRM project.
 */

// Bare-ISO foreign prefixes seeded in the CRM's cities table. Kept explicit so
// legacy ERP formats ("BH - 180", "JHK114") can't trigger a CRM lookup.
const FOREIGN_PREFIX = new Set(["AU", "BD", "BT", "LK", "MY", "NP", "NZ"]);

export function ltCrmKeyOf(
  jobNumber: string | null | undefined,
): string | null {
  if (!jobNumber) return null;
  const s = jobNumber.trim().toUpperCase();
  let m = s.match(/^(IN-[A-Z]{2,3})-0*(\d+)$/);
  if (m) return `${m[1]}|${m[2]}`;
  m = s.match(/^([A-Z]{2})-0*(\d+)$/);
  if (m && FOREIGN_PREFIX.has(m[1])) return `${m[1]}|${m[2]}`;
  return null;
}
