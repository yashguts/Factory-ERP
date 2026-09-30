-- =====================================================================
-- 076: Site surveys from Construction.
--
-- Why. Operator-approved, 30 Sep 2026: when a site survey is submitted in the
-- LT AMC Construction module, the Factory ERP receives the survey details —
-- the overall result, each checkpoint (ready / not ready / not checked, with
-- its remark), who surveyed, when and how far from the site they were, the
-- expected ready date, and the photos and videos. A re-survey replaces what is
-- shown; the earlier surveys are kept as history.
--
--   WRITE — cx_record_site_survey(p_secret, p_event_id, p_job_key, p_survey,
--           p_lift_numbers): Construction's outbox calls it exactly as it calls
--           cx_record_clearance (secret-gated, APPLIED / NOOP / REJECTED).
--           p_survey is the whole survey (version 1) and is stored as-is in
--           cx_site_surveys.payload; the ERP ignores p_lift_numbers but must
--           declare it, or PostgREST won't match the call.
--   One row per (job, survey_ref): a reopened and re-submitted survey keeps
--   its ref and replaces the row, unless the stored copy is newer (an older
--   version arriving late is a NOOP). A revisit is a new ref, so a new row.
--
-- Additive and rerunnable. Nothing existing changes.
-- =====================================================================

create table if not exists public.cx_site_surveys (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs(id) on delete cascade,
  survey_ref     text not null,
  survey_no      integer,
  overall_result text,
  submitted_at   timestamptz not null,
  event_id       uuid not null,
  payload        jsonb not null,
  received_at    timestamptz not null default now(),
  updated_at     timestamptz,
  constraint cx_site_surveys_job_ref_key unique (job_id, survey_ref),
  constraint cx_site_surveys_event_id_key unique (event_id)
);

comment on table public.cx_site_surveys is
  'Site surveys submitted in the LT AMC Construction module (cx_record_site_survey). One row per (job, survey_ref); payload is the whole survey as sent (version 1). The newest by submitted_at is the one shown; the rest are history.';
comment on column public.cx_site_surveys.survey_ref     is 'Construction''s survey id (text). A reopened and re-submitted survey keeps its ref and replaces this row.';
comment on column public.cx_site_surveys.overall_result is 'READY | PARTIAL | NOT_READY (or NULL), copied from the payload.';
comment on column public.cx_site_surveys.event_id       is 'Construction outbox event id of the version stored (idempotency key).';
comment on column public.cx_site_surveys.payload        is 'The whole p_survey as Construction sent it: checkpoints, media links, counts, surveyor, distance, dates.';
comment on column public.cx_site_surveys.updated_at     is 'When a newer version of the same survey replaced this row (NULL = never replaced).';

create index if not exists idx_cxss_job on public.cx_site_surveys(job_id, submitted_at desc);

-- RLS: the ERP web app (pre-auth anon client) only READS the surveys; nothing
-- but cx_record_site_survey (security definer, the table owner) writes them.
-- So anon/authenticated get SELECT only — unlike 069's clearances, which the
-- office acknowledges in place. A browser holding the public anon key can
-- read the surveys (as every ERP table), but can't insert, change or delete one.
alter table public.cx_site_surveys enable row level security;
drop policy if exists "Allow all for anon" on public.cx_site_surveys;
drop policy if exists "Read for anon" on public.cx_site_surveys;
create policy "Read for anon" on public.cx_site_surveys for select to anon, authenticated using (true);
revoke all on public.cx_site_surveys from anon, authenticated;
grant select on public.cx_site_surveys to anon, authenticated;
grant all on public.cx_site_surveys to service_role;

create or replace function public.cx_record_site_survey(
  p_secret       text,
  p_event_id     uuid,
  p_job_key      text,
  p_survey       jsonb,
  p_lift_numbers jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job_id    uuid;
  v_ref       text;
  v_submitted timestamptz;
  v_no        integer;
  v_id        uuid;
begin
  if not exists (select 1 from cx_integration_config c where c.shared_secret = p_secret) then
    raise exception 'invalid integration secret' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'p_event_id is required' using errcode = '22023';
  end if;

  v_ref := nullif(btrim(p_survey->>'survey_ref'), '');
  if v_ref is null then
    return jsonb_build_object('status', 'REJECTED', 'detail', 'p_survey.survey_ref is required');
  end if;
  if nullif(btrim(p_survey->>'submitted_at'), '') is null then
    return jsonb_build_object('status', 'REJECTED', 'detail', 'p_survey.submitted_at is required');
  end if;
  begin
    v_submitted := (p_survey->>'submitted_at')::timestamptz;
  exception when others then
    return jsonb_build_object('status', 'REJECTED',
                              'detail', 'p_survey.submitted_at is not a timestamp: ' || (p_survey->>'submitted_at'));
  end;

  select j.id into v_job_id
  from jobs j
  where cx_job_key_of(j.job_number) = p_job_key
  order by j.created_at
  limit 1;
  if v_job_id is null then
    return jsonb_build_object('status', 'REJECTED',
                              'detail', 'no ERP job for key ' || coalesce(p_job_key, '(null)'));
  end if;

  -- The same event again: already stored.
  select id into v_id from cx_site_surveys where event_id = p_event_id;
  if v_id is not null then
    return jsonb_build_object('status', 'NOOP', 'detail', 'event already recorded', 'id', v_id);
  end if;

  v_no := case when (p_survey->>'survey_no') ~ '^[0-9]{1,9}$'
               then (p_survey->>'survey_no')::integer end;

  -- Insert, or replace the stored version of this survey unless the stored
  -- one is newer (an older version arriving late changes nothing).
  insert into cx_site_surveys (job_id, survey_ref, survey_no, overall_result, submitted_at, event_id, payload)
  values (v_job_id, v_ref, v_no, nullif(btrim(p_survey->>'overall_result'), ''), v_submitted, p_event_id, p_survey)
  on conflict (job_id, survey_ref) do update
     set survey_no      = excluded.survey_no,
         overall_result = excluded.overall_result,
         submitted_at   = excluded.submitted_at,
         event_id       = excluded.event_id,
         payload        = excluded.payload,
         updated_at     = now()
   where cx_site_surveys.submitted_at <= excluded.submitted_at
  returning id into v_id;

  if v_id is null then
    select id into v_id from cx_site_surveys where job_id = v_job_id and survey_ref = v_ref;
    return jsonb_build_object('status', 'NOOP', 'detail', 'older version', 'id', v_id);
  end if;

  return jsonb_build_object('status', 'APPLIED', 'detail', 'survey recorded', 'id', v_id, 'job_id', v_job_id);
end $function$;

comment on function public.cx_record_site_survey(text, uuid, text, jsonb, jsonb) is
  'Construction bridge: records a submitted site survey (p_survey, version 1) against the matched ERP job. One row per (job, survey_ref); a newer version replaces it, an older one is a NOOP. p_lift_numbers is accepted and ignored. Idempotent on p_event_id (APPLIED / NOOP / REJECTED). 42501 without the shared secret.';

revoke all on function public.cx_record_site_survey(text, uuid, text, jsonb, jsonb) from public;
grant execute on function public.cx_record_site_survey(text, uuid, text, jsonb, jsonb) to anon, authenticated;
