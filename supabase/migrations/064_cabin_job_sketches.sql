-- Save the hand sketch used to create a cabin job (owner, 2026-07-09).
-- Engineers upload a photo of a hand cabin sketch to auto-fill the job; until now
-- the image was read by the AI and discarded. Persist it like a GAD drawing so
-- each cabin job keeps its source sketch for reference/audit.

alter table public.cabin_jobs
  add column if not exists sketch_url text,
  add column if not exists sketch_filename text,
  add column if not exists sketch_uploaded_at timestamptz;

-- Storage bucket (public, 50MB, PDF + common images) — mirrors gad-drawings.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cabin-sketches', 'cabin-sketches', true, 52428800,
        array['application/pdf','image/png','image/jpeg','image/jpg','image/webp'])
on conflict (id) do nothing;

-- Anon RLS on storage.objects for this bucket (same permissive shape as gad-drawings;
-- the app has no auth yet). Drop-first makes the migration re-runnable.
drop policy if exists cabin_sketches_select on storage.objects;
drop policy if exists cabin_sketches_insert on storage.objects;
drop policy if exists cabin_sketches_update on storage.objects;
drop policy if exists cabin_sketches_delete on storage.objects;

create policy cabin_sketches_select on storage.objects
  for select to anon, authenticated using (bucket_id = 'cabin-sketches');
create policy cabin_sketches_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'cabin-sketches');
create policy cabin_sketches_update on storage.objects
  for update to anon, authenticated using (bucket_id = 'cabin-sketches') with check (bucket_id = 'cabin-sketches');
create policy cabin_sketches_delete on storage.objects
  for delete to anon, authenticated using (bucket_id = 'cabin-sketches');
