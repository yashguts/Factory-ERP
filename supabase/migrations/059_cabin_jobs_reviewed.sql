-- 059 — Cabin-job review flag (applied 2026-07-03 as cabin_jobs_reviewed_flag)
--
-- AI-drafted cabin jobs start UNREVIEWED (reviewed_at NULL) and are excluded
-- from every cabin requirement / cutting-demand reader until an engineer
-- reviews the draft and marks it reviewed (setCabinJobReviewed). All cabin
-- jobs that existed before this migration were human-entered and are
-- backfilled as reviewed (owner rule, 2026-07-03), so their behaviour is
-- unchanged. createCabinJob sets reviewed_at = now() (human-created =
-- reviewed); only out-of-app AI drafts carry NULL.
ALTER TABLE cabin_jobs ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE cabin_jobs ADD COLUMN IF NOT EXISTS reviewed_note text;

UPDATE cabin_jobs SET reviewed_at = now() WHERE reviewed_at IS NULL;
