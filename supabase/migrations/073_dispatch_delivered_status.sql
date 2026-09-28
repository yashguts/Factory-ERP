-- =====================================================================
-- 073: "Delivered" completion status on a dispatch.
--
-- Why. The delivery CONFIRMATION (072) is a scheduling signal — "the driver
-- will deliver on <date>". The factory also needs the COMPLETION signal — the
-- material was actually received on site. That is a separate, later event, so
-- it gets its own field, set either by the office (in the ERP) or by the
-- Construction team (LT AMC) via cx_mark_dispatch_delivered.
--
-- Additive. cx_erp_snapshot is redefined (create or replace) to carry the new
-- fields; unknown consumers ignore them.
-- =====================================================================

-- ---- a. Delivered fields on the dispatch header ---------------------------
alter table public.job_dispatches
  add column if not exists delivered_date date,
  add column if not exists delivered_by   text;

comment on column public.job_dispatches.delivered_date is 'Date the material was actually received on site (NULL = not delivered yet). Set by the office or by Construction; distinct from a scheduled delivery confirmation.';
comment on column public.job_dispatches.delivered_by   is 'Who recorded the delivery (office operator name, or the Construction supervisor).';

-- ---- b. WRITE: Construction marks a dispatch delivered ---------------------
create or replace function public.cx_mark_dispatch_delivered(
  p_secret         text,
  p_dispatch_id    uuid,
  p_delivered_date date default null,   -- defaults to today when omitted
  p_delivered_by   text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job_id uuid;
  v_date   date;
begin
  if not exists (select 1 from cx_integration_config c where c.shared_secret = p_secret) then
    raise exception 'invalid integration secret' using errcode = '42501';
  end if;
  if p_dispatch_id is null then
    return jsonb_build_object('status', 'REJECTED', 'detail', 'p_dispatch_id is required');
  end if;

  select d.job_id into v_job_id from job_dispatches d where d.id = p_dispatch_id;
  if v_job_id is null then
    return jsonb_build_object('status', 'REJECTED', 'detail', 'no dispatch for id');
  end if;

  v_date := coalesce(p_delivered_date, current_date);
  update job_dispatches
     set delivered_date = v_date,
         delivered_by   = p_delivered_by
   where id = p_dispatch_id;

  return jsonb_build_object('status', 'APPLIED', 'dispatch_id', p_dispatch_id,
                            'job_id', v_job_id, 'delivered_date', v_date);
end $function$;

comment on function public.cx_mark_dispatch_delivered(text, uuid, date, text) is
  'Construction bridge: marks a dispatch as delivered (material received on site) on a date (default today). Secret-gated; 42501 without it. Idempotent (re-setting is a no-op overwrite).';

revoke all on function public.cx_mark_dispatch_delivered(text, uuid, date, text) from public;
grant execute on function public.cx_mark_dispatch_delivered(text, uuid, date, text) to anon, authenticated;

-- ---- c. READ: cx_erp_snapshot now carries the delivered status -------------
-- Full body copied from 072, with delivered_date / delivered_by added to the
-- dispatches object.
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
              'delivered_date', d.delivered_date,
              'delivered_by',   d.delivered_by,
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
