"use server";

import {
  getRicardoFinancials,
  getRicardoFinancialsForJobs,
  type RicardoFinancials,
  type RicardoListSummary,
} from "./ricardo";
import { getLtCrmFinancials, getLtCrmFinancialsForJobs } from "./ltcrm";

/**
 * Unified CRM financials across both live CRMs. A job number matches at most
 * one CRM: Ricardo prefixes (RNL/REB/ANZ/LKO) and LT prefixes (IN-XX / bare
 * foreign ISO) are disjoint, so the two feeds merge without collisions.
 */

export interface CrmFinancials extends RicardoFinancials {
  source: "ricardo" | "ltcrm";
}

export async function getCrmFinancials(
  jobNumber: string,
): Promise<CrmFinancials | null> {
  const ricardo = await getRicardoFinancials(jobNumber);
  if (ricardo) return { ...ricardo, source: "ricardo" };
  const lt = await getLtCrmFinancials(jobNumber);
  if (lt) return { ...lt, source: "ltcrm" };
  return null;
}

export async function getCrmFinancialsForJobs(
  jobNumbers: string[],
): Promise<Record<string, RicardoListSummary>> {
  const [ricardo, lt] = await Promise.all([
    getRicardoFinancialsForJobs(jobNumbers),
    getLtCrmFinancialsForJobs(jobNumbers),
  ]);
  return { ...ricardo, ...lt };
}
