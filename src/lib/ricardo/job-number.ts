/**
 * Ricardo CRM job-number matching.
 *
 * CRM job numbers are a city prefix + 4-digit number ("RNLDL-0111"), stored
 * split (cities.prefix + jobs.job_number). ERP entries drift in format —
 * missing dash ("RNLBLR0042"), 3-digit padding ("RNLNAG009") — so both sides
 * normalise to "PREFIX|NUMBER" with leading zeros stripped before matching.
 * The SQL side of this lives in erp_job_financials() on the Ricardo project.
 */

// Ricardo-brand prefixes only (RNL* cities, REB* cities, ANZ, LKO). LT jobs
// ("4630", "LTR&ML-343", "BH - 180") must not trigger a CRM lookup.
const RICARDO_PREFIX = /^(RNL|REB|ANZ|LKO)/;

export function ricardoKeyOf(
  jobNumber: string | null | undefined,
): string | null {
  if (!jobNumber) return null;
  const m = jobNumber.trim().match(/^([A-Za-z]+)[\s-]*0*(\d+)$/);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  if (!RICARDO_PREFIX.test(prefix)) return null;
  return `${prefix}|${m[2]}`;
}
