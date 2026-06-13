-- =====================================================================
-- 022: schedule the unattended daily AI-autofill maintenance with pg_cron.
-- SEPARATE from 021 on purpose: pg_cron may be unavailable/permission-gated
-- on some projects, and a failure here must NOT roll back the 021 schema.
-- If this errors on a given environment, fall back to a Netlify scheduled
-- function calling: select public.nightly_ai_maintenance();
-- 19:30 UTC = 01:00 IST (after the factory day; pg_cron schedules in UTC).
-- =====================================================================
create extension if not exists pg_cron;

select cron.unschedule('nightly-ai-maintenance')
  where exists (select 1 from cron.job where jobname = 'nightly-ai-maintenance');

select cron.schedule(
  'nightly-ai-maintenance',
  '30 19 * * *',
  $$ select public.nightly_ai_maintenance(); $$
);
