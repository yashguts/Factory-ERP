"use server";

import { createCacheClient } from "@/lib/supabase/cache-client";
import type { SiteSurveyRead, SiteSurveyRow } from "@/lib/site-survey";

/* ------------------------------------------------------------------ *
 * Site surveys (Construction module → ERP).
 *
 * Construction's outbox calls cx_record_site_survey (migration 076), which
 * stores each submitted survey in cx_site_surveys (one row per job + survey
 * ref, the whole survey in `payload`). Read UNCACHED, like the site clearance
 * and delivery confirmations: the rows are written outside the ERP, so none of
 * our cache tags would ever bust on them.
 * ------------------------------------------------------------------ */

/** Every site survey Construction has sent for this job, newest first.
 *  `ok: false` only when the read itself failed. */
export async function getJobSiteSurveys(jobId: string): Promise<SiteSurveyRead> {
  if (!jobId) return { ok: true, surveys: [] };
  try {
    const supabase = createCacheClient();
    const { data, error } = await supabase
      .from("cx_site_surveys")
      .select("id, survey_ref, survey_no, overall_result, submitted_at, received_at, updated_at, payload")
      .eq("job_id", jobId)
      .order("submitted_at", { ascending: false });
    if (error) {
      // Before migration 076 is applied the table doesn't exist yet: that is
      // "no survey yet", not a failure (deploy order can't break the page).
      if (error.code === "PGRST205" || error.code === "42P01") return { ok: true, surveys: [] };
      return { ok: false, error: error.message };
    }
    return {
      ok: true,
      surveys: (data ?? []).map(
        (r: any): SiteSurveyRow => ({
          id: r.id as string,
          survey_ref: r.survey_ref as string,
          survey_no: (r.survey_no as number | null) ?? null,
          overall_result: (r.overall_result as string | null) ?? null,
          submitted_at: r.submitted_at as string,
          received_at: r.received_at as string,
          updated_at: (r.updated_at as string | null) ?? null,
          payload: r.payload ?? null,
        }),
      ),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the site survey." };
  }
}
