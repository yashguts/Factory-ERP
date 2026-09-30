-- =====================================================================
-- 075: Construction can REVOKE a dispatch clearance.
--
-- Why. A CX Manager or admin in the LT AMC Construction module can revoke a
-- dispatch clearance they gave earlier (069's cx_record_clearance). Operator,
-- 30 Sep 2026: the revocation must reach the ERP "just as a notification". It
-- never blocks anything; the factory sees it on the job, and a revoked
-- clearance stops counting as given, so the soft "site clearance pending"
-- warning before a dispatch comes back.
--
--   a. cx_dispatch_clearances gains the clearance code (e.g. 'DCL-12') and the
--      revocation fields (+ the factory's acknowledgement of the revocation).
--   b. cx_record_clearance gains an OPTIONAL trailing p_code (default null).
--      The old 7-argument signature is dropped first: keeping both overloads
--      would make PostgREST's named-argument call from Construction (which
--      sends no p_code) ambiguous. With one function, calls without p_code
--      keep working and the code simply stays null until Construction sends
--      it. Same body otherwise, same grants.
--   c. cx_record_clearance_revocation(...): Construction's outbox calls it the
--      same way as cx_record_clearance (secret-gated, idempotent, APPLIED /
--      NOOP / REJECTED). It marks the original clearance (found by its
--      event_id) revoked. If that clearance hasn't arrived yet, it records a
--      revoked row under the clearance's event_id; the late clearance then hits
--      cx_record_clearance's "on conflict (event_id) do nothing" and stays
--      revoked, so the order of arrival doesn't matter.
--
-- Rerunnable. No existing row changes; cx_record_clearance is replaced by a
-- call-compatible version (apply the file as one transaction, as
-- apply_migration does, so there is no moment without it).
-- =====================================================================

-- ---- a. Code + revocation fields ------------------------------------------
alter table public.cx_dispatch_clearances
  add column if not exists code                   text,
  add column if not exists revoked_at             timestamptz,
  add column if not exists revoked_by             text,
  add column if not exists revoke_reason          text,
  add column if not exists revoke_event_id        uuid,
  add column if not exists revoke_acknowledged_at timestamptz,
  add column if not exists revoke_acknowledged_by text;

-- One revocation event revokes at most one clearance; a replay is a NOOP.
create unique index if not exists uq_cxdc_revoke_event
  on public.cx_dispatch_clearances(revoke_event_id);

comment on column public.cx_dispatch_clearances.code                   is 'Construction''s clearance code, e.g. DCL-12 (from cx_record_clearance p_code or the revocation).';
comment on column public.cx_dispatch_clearances.revoked_at             is 'When Construction revoked this clearance (NULL = in force). A revoked clearance no longer counts as given.';
comment on column public.cx_dispatch_clearances.revoked_by             is 'Who revoked it in Construction (a name).';
comment on column public.cx_dispatch_clearances.revoke_reason          is 'Why it was revoked.';
comment on column public.cx_dispatch_clearances.revoke_event_id        is 'Construction revocation event id (idempotency key for cx_record_clearance_revocation).';
comment on column public.cx_dispatch_clearances.revoke_acknowledged_at is 'When the factory office acknowledged the revocation notice.';
comment on column public.cx_dispatch_clearances.revoke_acknowledged_by is 'Who acknowledged it (ERP operator name).';

-- ---- b. cx_record_clearance: optional p_code --------------------------------
drop function if exists public.cx_record_clearance(text, uuid, text, text, text, text, timestamptz);

create or replace function public.cx_record_clearance(
  p_secret     text,
  p_event_id   uuid,
  p_job_key    text,
  p_phase      text,
  p_note       text default null,
  p_cleared_by text default null,
  p_cleared_at timestamptz default now(),
  p_code       text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job_id uuid;
  v_scope  text;
  v_id     uuid;
begin
  if not exists (select 1 from cx_integration_config c where c.shared_secret = p_secret) then
    raise exception 'invalid integration secret' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'p_event_id is required' using errcode = '22023';
  end if;

  v_scope := case p_phase
               when 'FIRST'        then 'first'
               when 'FIRST_SECOND' then 'first_and_second'
               when 'COMPLETE'     then 'full'
               else null
             end;
  if v_scope is null then
    return jsonb_build_object('status', 'REJECTED',
                              'detail', 'unknown phase: ' || coalesce(p_phase, '(null)'));
  end if;

  select j.id into v_job_id
  from jobs j
  where cx_job_key_of(j.job_number) = p_job_key
  order by j.created_at
  limit 1;
  if v_job_id is null then
    return jsonb_build_object('status', 'REJECTED',
                              'detail', 'no ERP job for key ' || coalesce(p_job_key, '(null)'));
  end if;

  insert into cx_dispatch_clearances (event_id, job_id, recommended_scope, note, cleared_by, cleared_at, code)
  values (p_event_id, v_job_id, v_scope, p_note, p_cleared_by, coalesce(p_cleared_at, now()), p_code)
  on conflict (event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from cx_dispatch_clearances where event_id = p_event_id;
    return jsonb_build_object('status', 'NOOP', 'detail', 'event already recorded', 'id', v_id);
  end if;

  return jsonb_build_object('status', 'APPLIED', 'id', v_id, 'job_id', v_job_id, 'scope', v_scope);
end $function$;

comment on function public.cx_record_clearance(text, uuid, text, text, text, text, timestamptz, text) is
  'Construction bridge: records a dispatch clearance as an open alert against the matched ERP job. Optional p_code stores Construction''s clearance code. Idempotent on event_id (APPLIED / NOOP / REJECTED); a clearance whose revocation arrived first stays revoked. 42501 without the shared secret.';

revoke all on function public.cx_record_clearance(text, uuid, text, text, text, text, timestamptz, text) from public;
grant execute on function public.cx_record_clearance(text, uuid, text, text, text, text, timestamptz, text) to anon, authenticated;

-- ---- c. WRITE: cx_record_clearance_revocation -------------------------------
create or replace function public.cx_record_clearance_revocation(
  p_secret             text,
  p_event_id           uuid,
  p_clearance_event_id uuid,
  p_job_key            text,
  p_phase              text,
  p_code               text default null,
  p_revoked_by         text default null,
  p_revoked_at         timestamptz default now(),
  p_reason             text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job_id uuid;
  v_scope  text;
  v_id     uuid;
begin
  if not exists (select 1 from cx_integration_config c where c.shared_secret = p_secret) then
    raise exception 'invalid integration secret' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'p_event_id is required' using errcode = '22023';
  end if;
  if p_clearance_event_id is null then
    raise exception 'p_clearance_event_id is required' using errcode = '22023';
  end if;

  v_scope := case p_phase
               when 'FIRST'        then 'first'
               when 'FIRST_SECOND' then 'first_and_second'
               when 'COMPLETE'     then 'full'
               else null
             end;
  if v_scope is null then
    return jsonb_build_object('status', 'REJECTED',
                              'detail', 'unknown phase: ' || coalesce(p_phase, '(null)'));
  end if;

  -- The same revocation event again: already recorded.
  select id into v_id from cx_dispatch_clearances where revoke_event_id = p_event_id;
  if v_id is not null then
    return jsonb_build_object('status', 'NOOP', 'detail', 'revocation already recorded', 'id', v_id);
  end if;

  -- 1. The clearance is here: revoke it (once). It is found by its own unique
  --    event id, so no job lookup is needed on this path.
  update cx_dispatch_clearances
     set revoked_at      = coalesce(p_revoked_at, now()),
         revoked_by      = p_revoked_by,
         revoke_reason   = p_reason,
         revoke_event_id = p_event_id,
         code            = coalesce(code, p_code)
   where event_id = p_clearance_event_id
     and revoked_at is null
  returning id, job_id into v_id, v_job_id;
  if v_id is not null then
    return jsonb_build_object('status', 'APPLIED', 'detail', 'clearance revoked',
                              'id', v_id, 'job_id', v_job_id);
  end if;

  select id into v_id from cx_dispatch_clearances where event_id = p_clearance_event_id;
  if v_id is not null then
    return jsonb_build_object('status', 'NOOP', 'detail', 'clearance already revoked', 'id', v_id);
  end if;

  -- 2. The clearance hasn't arrived (yet, or ever): record it as already
  --    revoked under the clearance's event id, with the same job lookup as
  --    cx_record_clearance.
  select j.id into v_job_id
  from jobs j
  where cx_job_key_of(j.job_number) = p_job_key
  order by j.created_at
  limit 1;
  if v_job_id is null then
    return jsonb_build_object('status', 'REJECTED',
                              'detail', 'no ERP job for key ' || coalesce(p_job_key, '(null)'));
  end if;

  insert into cx_dispatch_clearances (
    event_id, job_id, recommended_scope, code,
    revoked_at, revoked_by, revoke_reason, revoke_event_id
  )
  values (
    p_clearance_event_id, v_job_id, v_scope, p_code,
    coalesce(p_revoked_at, now()), p_revoked_by, p_reason, p_event_id
  )
  on conflict (event_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- The clearance landed in between: revoke it now.
    update cx_dispatch_clearances
       set revoked_at      = coalesce(p_revoked_at, now()),
           revoked_by      = p_revoked_by,
           revoke_reason   = p_reason,
           revoke_event_id = p_event_id,
           code            = coalesce(code, p_code)
     where event_id = p_clearance_event_id
       and revoked_at is null
    returning id, job_id into v_id, v_job_id;
    if v_id is not null then
      return jsonb_build_object('status', 'APPLIED', 'detail', 'clearance revoked',
                                'id', v_id, 'job_id', v_job_id);
    end if;
    select id into v_id from cx_dispatch_clearances where event_id = p_clearance_event_id;
    return jsonb_build_object('status', 'NOOP', 'detail', 'clearance already revoked', 'id', v_id);
  end if;

  return jsonb_build_object('status', 'APPLIED', 'detail', 'revoked before the clearance arrived',
                            'id', v_id, 'job_id', v_job_id, 'scope', v_scope);
end $function$;

comment on function public.cx_record_clearance_revocation(text, uuid, uuid, text, text, text, text, timestamptz, text) is
  'Construction bridge: a dispatch clearance was revoked. Marks the clearance (by its event_id) revoked, or records it already revoked if the clearance has not arrived. Informational for the factory; a revoked clearance no longer counts as given. Idempotent on p_event_id (APPLIED / NOOP / REJECTED). 42501 without the shared secret.';

revoke all on function public.cx_record_clearance_revocation(text, uuid, uuid, text, text, text, text, timestamptz, text) from public;
grant execute on function public.cx_record_clearance_revocation(text, uuid, uuid, text, text, text, text, timestamptz, text) to anon, authenticated;
