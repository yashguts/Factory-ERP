-- =====================================================================
-- 069: Construction feed for LT AMC's Construction module.
--
-- LT AMC (Supabase project njeuyzjezbdpkcrhlkkn) tracks lift installation.
-- Two lanes touch the Factory:
--
--   READ  — cx_erp_snapshot(p_secret, p_keys): per normalised job key, the
--           job header, its Packing List R1 (final or draft-flagged, lines
--           with the RESOLVED dispatch phase) and its recorded dispatches.
--           Secret-gated, anon-reachable — the same contract as the CRMs'
--           erp_job_financials.
--   WRITE — cx_record_clearance(...): the Construction supervisor's dispatch
--           clearance lands here as an alert-until-acknowledged row
--           (cx_dispatch_clearances, the 047 job_status_changes pattern) so
--           the factory office sees "site is ready — dispatch phase X".
--
-- Job-key normalisation covers BOTH CRM grammars in one SQL function
-- (cx_job_key_of), re-implementing src/lib/ltcrm/job-number.ts and
-- src/lib/ricardo/job-number.ts: UPPER(prefix) || '|' || number without
-- leading zeros. Legacy formats ('4630', 'LTR&ML-343', 'BH - 180') return
-- NULL and never match.
--
-- Line-level dispatch phase resolution mirrors src/lib/bom/bom-sections.ts
-- linePhase(): an explicit template override (1|2) wins, otherwise the part
-- title's section default (FIRST_PHASE_SECTIONS) applies.
--
-- Strictly additive. No existing table, function or policy is modified.
-- =====================================================================

-- ---- Job-key normalisation ------------------------------------------------
create or replace function public.cx_job_key_of(p_job_number text)
returns text
language sql
immutable
as $function$
  select case
    when s ~ '^IN-[A-Z]{2,3}-0*[0-9]+$'
      then regexp_replace(s, '^(IN-[A-Z]{2,3})-0*([0-9]+)$', '\1|\2')
    when s ~ '^(AU|BD|BT|LK|MY|NP|NZ)-0*[0-9]+$'
      then regexp_replace(s, '^([A-Z]{2})-0*([0-9]+)$', '\1|\2')
    when s ~ '^(RNL|REB|ANZ|LKO)[A-Z]*[[:space:]-]*0*[0-9]+$'
      then regexp_replace(s, '^([A-Z]+)[[:space:]-]*0*([0-9]+)$', '\1|\2')
    else null
  end
  from (select upper(btrim(coalesce(p_job_number, ''))) as s) t;
$function$;

comment on function public.cx_job_key_of(text) is
  'Normalises an ERP job_number to the cross-system key UPPER(prefix)||''|''||number-without-leading-zeros, for both the LT ELEVATOR (IN-XX-#### / foreign CC-####) and Ricardo (RNL*/REB*/ANZ/LKO) grammars. NULL when neither grammar matches.';

-- Expression index so each snapshot key resolves by index probe instead of a
-- per-key sequential scan (the keyed pull sends up to 7 concurrent 100-key
-- pages; without this the small instance hit PostgREST''s statement timeout).
create index if not exists idx_jobs_cx_key on public.jobs (cx_job_key_of(job_number));

-- ---- Shared secret --------------------------------------------------------
-- The ONE table in this project anon must NOT read: RLS on, zero policies.
create table if not exists public.cx_integration_config (
  id            boolean primary key default true check (id),
  shared_secret text not null,
  created_at    timestamptz not null default now()
);
alter table public.cx_integration_config enable row level security;
revoke all on public.cx_integration_config from public, anon, authenticated;
-- deliberately NO policies.

insert into public.cx_integration_config (shared_secret)
select encode(gen_random_bytes(32), 'hex')
where not exists (select 1 from public.cx_integration_config);

-- ---- READ: cx_erp_snapshot ------------------------------------------------
create or replace function public.cx_erp_snapshot(p_secret text, p_keys text[])
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_first_phase text[] := array[
    -- section defaults (FIRST_PHASE_SECTIONS, src/lib/bom/bom-sections.ts)
    'RAIL','Stud Anchor','BRICK','MAIN BRACKET','COUNTER BRACKET','RAIL CLIP',
    'Buffer Channel Main','Buffer Channel Counter','Door Post / Frame','Door Sill',
    'Linton Panel','CONT. STAND','TROUGHING 50','TROUGHING 100','FIREMAN SWITCH',
    'Template Channel','Buffer Channel','Rail Brackets','Guide Rails','Troughing',
    'Controller Bracket','Door Frame','Rail Clip'
  ];
begin
  if not exists (select 1 from cx_integration_config c where c.shared_secret = p_secret) then
    raise exception 'invalid integration secret' using errcode = '42501';
  end if;
  if coalesce(array_length(p_keys, 1), 0) > 100 then
    raise exception 'too many keys: % (max 100 per call)', array_length(p_keys, 1)
      using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', k.key,
      'jobs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',                        j.id,
          'job_number',                j.job_number,
          'status',                    j.status,
          'stage',                     j.stage,
          'brand',                     j.brand,
          'floors',                    j.floors,
          'order_date',                j.order_date,
          'planned_start',             j.planned_start,
          'planned_end',               j.planned_end,
          'actual_start',              j.actual_start,
          'actual_end',                j.actual_end,
          'expected_delivery',         j.expected_delivery,
          'requirement_dispatch_date', j.requirement_dispatch_date,
          'created_at',                j.created_at,
          'updated_at',                j.updated_at,
          'packing_list', (
            select jsonb_build_object(
              'id',         pl.id,
              'status',     pl.status,
              'is_draft',   pl.status = 'draft',
              'note',       pl.note,
              'audited_at', pl.audited_at,
              'updated_at', pl.updated_at,
              'lines', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id',               ln.id,
                  'part_title',       ln.part_title,
                  'kind',             ln.kind,
                  'label',            ln.label,
                  'spec',             ln.spec,
                  'qty',              ln.qty,
                  'source',           ln.source,
                  'sort_order',       ln.sort_order,
                  'item_id',          ln.item_id,
                  'template_line_id', ln.template_line_id,
                  'dispatch_phase',   case
                                        when tl.dispatch_phase = 1 then 'first'
                                        when tl.dispatch_phase = 2 then 'second'
                                        when ln.part_title = any (v_first_phase) then 'first'
                                        else 'second'
                                      end
                ) order by ln.sort_order, ln.created_at)
                from packing_r1_lines ln
                left join packing_template_lines tl on tl.id = ln.template_line_id
                where ln.list_id = pl.id), '[]'::jsonb)
            )
            from packing_r1_lists pl where pl.job_id = j.id
          ),
          'dispatches', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',            d.id,
              'dispatch_date', d.dispatch_date,
              'phase_scope',   d.phase_scope,
              'note',          d.note,
              'created_at',    d.created_at,
              'lines', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id',       dl.id,
                  'category', dl.category,
                  'label',    dl.label,
                  'qty',      dl.qty,
                  'item_id',  dl.item_id
                ) order by dl.created_at)
                from job_dispatch_lines dl where dl.dispatch_id = d.id), '[]'::jsonb)
            ) order by d.dispatch_date, d.created_at)
            from job_dispatches d where d.job_id = j.id), '[]'::jsonb)
        ) order by j.created_at)
        from jobs j
        where cx_job_key_of(j.job_number) = k.key), '[]'::jsonb)
    ))
    from unnest(p_keys) as k(key)
  ), '[]'::jsonb);
end $function$;

comment on function public.cx_erp_snapshot(text, text[]) is
  'Secret-gated Construction feed: per normalised job key, the ERP job header(s), Packing List R1 (draft-flagged, lines with resolved dispatch phase) and recorded dispatches + lines. Max 100 keys per call; 42501 without the shared secret.';

revoke all on function public.cx_erp_snapshot(text, text[]) from public;
grant execute on function public.cx_erp_snapshot(text, text[]) to anon, authenticated;

-- ---- WRITE: dispatch clearances (alert-until-acknowledged, 047 pattern) ---
create table if not exists public.cx_dispatch_clearances (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid unique not null,
  job_id            uuid not null references public.jobs(id) on delete cascade,
  recommended_scope text check (recommended_scope in ('first', 'first_and_second', 'full')),
  note              text,
  cleared_by        text,
  cleared_at        timestamptz,
  created_at        timestamptz not null default now(),
  acknowledged_at   timestamptz,
  acknowledged_by   text
);

comment on table public.cx_dispatch_clearances is
  'Dispatch clearances raised by the LT AMC Construction module (site is ready — dispatch the recommended scope). Alert-until-acknowledged, same model as job_status_changes (047).';

create index if not exists idx_cxdc_job  on public.cx_dispatch_clearances(job_id, created_at desc);
-- Open alerts only (sidebar count / alerts page).
create index if not exists idx_cxdc_open on public.cx_dispatch_clearances(acknowledged_at)
  where acknowledged_at is null;

-- RLS matches how this app's tables work (pre-auth anon client): permissive
-- anon policy so the ERP web app can list + acknowledge.
alter table public.cx_dispatch_clearances enable row level security;
drop policy if exists "Allow all for anon" on public.cx_dispatch_clearances;
create policy "Allow all for anon" on public.cx_dispatch_clearances for all to anon using (true) with check (true);
grant all on public.cx_dispatch_clearances to anon, authenticated, service_role;

create or replace function public.cx_record_clearance(
  p_secret     text,
  p_event_id   uuid,
  p_job_key    text,
  p_phase      text,
  p_note       text default null,
  p_cleared_by text default null,
  p_cleared_at timestamptz default now()
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

  insert into cx_dispatch_clearances (event_id, job_id, recommended_scope, note, cleared_by, cleared_at)
  values (p_event_id, v_job_id, v_scope, p_note, p_cleared_by, coalesce(p_cleared_at, now()))
  on conflict (event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from cx_dispatch_clearances where event_id = p_event_id;
    return jsonb_build_object('status', 'NOOP', 'detail', 'event already recorded', 'id', v_id);
  end if;

  return jsonb_build_object('status', 'APPLIED', 'id', v_id, 'job_id', v_job_id, 'scope', v_scope);
end $function$;

comment on function public.cx_record_clearance(text, uuid, text, text, text, text, timestamptz) is
  'Construction bridge: records a dispatch clearance as an open alert against the matched ERP job. Idempotent on event_id (APPLIED / NOOP / REJECTED). 42501 without the shared secret.';

revoke all on function public.cx_record_clearance(text, uuid, text, text, text, text, timestamptz) from public;
grant execute on function public.cx_record_clearance(text, uuid, text, text, text, text, timestamptz) to anon, authenticated;
