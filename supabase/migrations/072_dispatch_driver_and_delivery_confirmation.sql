-- =====================================================================
-- 072: Driver details on a dispatch + construction delivery confirmation.
--
-- Why. When material leaves the factory for installation, the office needs to
-- record WHO is driving it and their PHONE so the Construction team (LT AMC /
-- "LT ONE", project njeuyzjezbdpkcrhlkkn) can call the driver and confirm when
-- the order will actually reach site. That confirmed date must come back so the
-- factory office sees it.
--
-- Two lanes, both riding the existing 069/070 Construction bridge:
--   READ  — cx_erp_snapshot now carries driver_name / driver_phone /
--           vehicle_number on each dispatch (additive keys; unknown consumers
--           ignore them, exactly as 070's 'gad' key does).
--   WRITE — cx_record_delivery_confirmation(...): the Construction supervisor's
--           "driver will deliver on <date>" lands in cx_delivery_confirmations
--           as an alert-until-acknowledged row (same shape as 069's
--           cx_dispatch_clearances), so the factory office sees it on the job.
--
-- Strictly additive. job_dispatches gets its first ALTER since 014; no existing
-- function/policy is dropped except the cx_erp_snapshot body it replaces.
-- =====================================================================

-- ---- a. Driver details on the dispatch header -----------------------------
alter table public.job_dispatches
  add column if not exists driver_name    text,
  add column if not exists driver_phone   text,
  add column if not exists vehicle_number text;

-- Mirror jobs.mobile_number: NULL or exactly 10 digits.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'job_dispatches_driver_phone_chk'
  ) then
    alter table public.job_dispatches
      add constraint job_dispatches_driver_phone_chk
      check (driver_phone is null or driver_phone ~ '^[0-9]{10}$');
  end if;
end $$;

comment on column public.job_dispatches.driver_name    is 'Driver name for this shipment (fed to the Construction module).';
comment on column public.job_dispatches.driver_phone   is 'Driver phone; NULL or exactly 10 digits. Construction calls this to confirm delivery.';
comment on column public.job_dispatches.vehicle_number is 'Vehicle number for this shipment.';

-- ---- b. WRITE: delivery confirmations (alert-until-acknowledged) -----------
-- Same model as cx_dispatch_clearances (069) and job_status_changes (047).
create table if not exists public.cx_delivery_confirmations (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid unique not null,
  dispatch_id     uuid references public.job_dispatches(id) on delete cascade,
  job_id          uuid not null references public.jobs(id) on delete cascade,
  confirmed_date  date,
  confirmed_time  text,
  driver_name     text,
  driver_phone    text,
  note            text,
  confirmed_by    text,
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by text
);

comment on table public.cx_delivery_confirmations is
  'Delivery confirmations raised by the LT AMC Construction module (driver will deliver on <date> — from the driver phone the factory recorded on the dispatch). Alert-until-acknowledged, same model as cx_dispatch_clearances (069).';

create index if not exists idx_cxdcf_job      on public.cx_delivery_confirmations(job_id, created_at desc);
create index if not exists idx_cxdcf_dispatch on public.cx_delivery_confirmations(dispatch_id);
-- Open alerts only (job panel indicator / any future sidebar count).
create index if not exists idx_cxdcf_open     on public.cx_delivery_confirmations(acknowledged_at)
  where acknowledged_at is null;

-- Permissive anon RLS, matching this app's pre-auth model (the ERP web app
-- lists + acknowledges these).
alter table public.cx_delivery_confirmations enable row level security;
drop policy if exists "Allow all for anon" on public.cx_delivery_confirmations;
create policy "Allow all for anon" on public.cx_delivery_confirmations for all to anon using (true) with check (true);
grant all on public.cx_delivery_confirmations to anon, authenticated, service_role;

create or replace function public.cx_record_delivery_confirmation(
  p_secret         text,
  p_event_id       uuid,
  p_dispatch_id    uuid    default null,
  p_job_key        text    default null,
  p_confirmed_date date    default null,
  p_confirmed_time text    default null,
  p_note           text    default null,
  p_confirmed_by   text    default null,
  p_confirmed_at   timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_dispatch_id  uuid;
  v_job_id       uuid;
  v_driver_name  text;
  v_driver_phone text;
  v_id           uuid;
begin
  if not exists (select 1 from cx_integration_config c where c.shared_secret = p_secret) then
    raise exception 'invalid integration secret' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'p_event_id is required' using errcode = '22023';
  end if;

  -- Resolve the job (and echo the driver we recorded) from the dispatch first,
  -- falling back to the normalised job key when only that is known. Capture the
  -- dispatch's OWN id so a stale/non-existent p_dispatch_id stores NULL (the FK
  -- is nullable) instead of raising a raw 23503 — the job still resolves by key.
  if p_dispatch_id is not null then
    select d.id, d.job_id, d.driver_name, d.driver_phone
      into v_dispatch_id, v_job_id, v_driver_name, v_driver_phone
    from job_dispatches d where d.id = p_dispatch_id;
  end if;
  if v_job_id is null and p_job_key is not null then
    select j.id into v_job_id
    from jobs j
    where cx_job_key_of(j.job_number) = p_job_key
    order by j.created_at
    limit 1;
  end if;
  if v_job_id is null then
    return jsonb_build_object('status', 'REJECTED',
      'detail', 'no ERP job for dispatch/key');
  end if;

  insert into cx_delivery_confirmations (
    event_id, dispatch_id, job_id, confirmed_date, confirmed_time,
    driver_name, driver_phone, note, confirmed_by, confirmed_at
  )
  values (
    p_event_id, v_dispatch_id, v_job_id, p_confirmed_date, p_confirmed_time,
    v_driver_name, v_driver_phone, p_note, p_confirmed_by, coalesce(p_confirmed_at, now())
  )
  on conflict (event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from cx_delivery_confirmations where event_id = p_event_id;
    return jsonb_build_object('status', 'NOOP', 'detail', 'event already recorded', 'id', v_id);
  end if;

  return jsonb_build_object('status', 'APPLIED', 'id', v_id, 'job_id', v_job_id);
end $function$;

comment on function public.cx_record_delivery_confirmation(text, uuid, uuid, text, date, text, text, text, timestamptz) is
  'Construction bridge: records a delivery confirmation (driver will deliver on <date>) as an open alert against the matched ERP job/dispatch. Idempotent on event_id (APPLIED / NOOP / REJECTED). 42501 without the shared secret.';

revoke all on function public.cx_record_delivery_confirmation(text, uuid, uuid, text, date, text, text, text, timestamptz) from public;
grant execute on function public.cx_record_delivery_confirmation(text, uuid, uuid, text, date, text, text, text, timestamptz) to anon, authenticated;

-- ---- d. READ: cx_erp_snapshot now carries the driver on each dispatch ------
-- Full body copied from 070, with driver_name / driver_phone / vehicle_number
-- added to the dispatches object (after 'note').
create or replace function public.cx_erp_snapshot(p_secret text, p_keys text[])
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_first_phase text[] := array[
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
          -- The drawing the site must build to: newest upload for this job.
          'gad', (
            select jsonb_build_object(
              'id',           g.id,
              'revision_no',  g.revision_no,
              'filename',     g.filename,
              'url',          g.url,
              'storage_path', g.storage_path,
              'is_current',   g.is_current,
              'uploaded_at',  g.uploaded_at
            )
            from job_gad_versions g
            where g.job_id = j.id
            order by g.uploaded_at desc, g.revision_no desc
            limit 1
          ),
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
              'id',             d.id,
              'dispatch_date',  d.dispatch_date,
              'phase_scope',    d.phase_scope,
              'note',           d.note,
              'driver_name',    d.driver_name,
              'driver_phone',   d.driver_phone,
              'vehicle_number', d.vehicle_number,
              'created_at',     d.created_at,
              'lines', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id',        dl.id,
                  'category',  dl.category,
                  'label',     dl.label,
                  'qty',       dl.qty,
                  'item_id',   dl.item_id,
                  'item_code', i.code,
                  'item_name', i.name
                ) order by dl.created_at)
                from job_dispatch_lines dl
                left join items i on i.id = dl.item_id
                where dl.dispatch_id = d.id), '[]'::jsonb)
            ) order by d.dispatch_date, d.created_at)
            from job_dispatches d where d.job_id = j.id), '[]'::jsonb)
        ) order by j.created_at)
        from jobs j
        where cx_job_key_of(j.job_number) = k.key), '[]'::jsonb)
    ))
    from unnest(p_keys) as k(key)
  ), '[]'::jsonb);
end $function$;
