-- =====================================================================
-- 070: Send the current GAD drawing along with the Construction feed.
--
-- Why. A technician standing at the site opens LT ONE, not the Factory ERP,
-- and the drawing they must build to is the one the FACTORY holds — the
-- CRM portal's copy is not the same file and is not the one that gets
-- revised. cx_erp_snapshot already carries the job header, the packing list
-- and the dispatches; this adds the drawing to that same object.
--
-- What. One extra key per job, 'gad':
--
--   { id, revision_no, filename, url, storage_path, is_current, uploaded_at }
--
-- or JSON null when the job has no drawing yet (316 of the ERP's 327 jobs
-- hold one today). The newest UPLOAD wins — order by uploaded_at, then revision —
-- which on every one of the 316 jobs holding a drawing today picks exactly
-- the row the ERP itself flags is_current; is_current rides along so the
-- consumer can say so rather than having to trust the ordering.
--
-- The bucket (gad-drawings) is public, so the URL works from a phone that
-- holds no Factory ERP credentials — the file is fetched straight from
-- storage, and nothing about this migration grants a wider read than the
-- ERP's own UI already publishes.
--
-- Additive: consumers that do not know the key ignore it, so LT AMC's
-- cx_sync_collect keeps working unchanged until its own migration lands.
-- =====================================================================

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
              'id',            d.id,
              'dispatch_date', d.dispatch_date,
              'phase_scope',   d.phase_scope,
              'note',          d.note,
              'created_at',    d.created_at,
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
