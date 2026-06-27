-- 050 — Packing List R1 (editable, job-wise packing-list module)
--
-- A NEW, parallel packing-list module, distinct from the existing per-job
-- packing_lists (039–041). R1 is driven by an EDITABLE, DB-backed template
-- (the owner's "PACKING LIST FORMAT" — 24 Parts, each pulling items from an
-- inventory category) that SEEDS each job's list. A job's list is then filled
-- both automatically (from its BOM) and by hand, and rolls up to a per-job
-- demand list (required vs stock). The existing packing_lists tables are
-- untouched.
--
--   packing_template_parts / packing_template_lines = the shared, editable template
--   packing_r1_lists / packing_r1_lines             = per-job instances

-- ---- Shared editable template ----------------------------------------------
create table if not exists packing_template_parts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists packing_template_lines (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references packing_template_parts(id) on delete cascade,
  -- category = pull/pick items from a category; item = a pinned specific item;
  -- hardware = the Nut-Bolts/Screws picker; free = free-text (GI Wire, …).
  kind text not null default 'category' check (kind in ('category','item','hardware','free')),
  category_id uuid references item_categories(id) on delete set null,
  item_id uuid references items(id) on delete set null,
  label text,                 -- display label; for the 6 unmapped categories it holds the name only
  spec_hint text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- Per-job instance (R1) -------------------------------------------------
create table if not exists packing_r1_lists (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','final')),
  note text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id)
);

create table if not exists packing_r1_lines (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references packing_r1_lists(id) on delete cascade,
  -- denormalised so later TEMPLATE edits never mutate already-saved job lines.
  part_title text not null default '',
  template_line_id uuid references packing_template_lines(id) on delete set null,
  kind text not null default 'category' check (kind in ('category','item','hardware','free')),
  category_id uuid references item_categories(id) on delete set null,
  item_id uuid references items(id) on delete no action,
  label text,
  spec text,
  qty numeric not null default 0,
  source text,                -- 'template' | 'auto' | 'manual'
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- Indexes ---------------------------------------------------------------
create index if not exists idx_pl_tmpl_lines_part on packing_template_lines(part_id, sort_order);
create index if not exists idx_pl_tmpl_lines_cat on packing_template_lines(category_id);
create index if not exists idx_pl_tmpl_parts_order on packing_template_parts(sort_order);
create index if not exists idx_pl_r1_lists_job on packing_r1_lists(job_id);
create index if not exists idx_pl_r1_lines_list on packing_r1_lines(list_id, sort_order);
create index if not exists idx_pl_r1_lines_item on packing_r1_lines(item_id);
create index if not exists idx_pl_r1_lines_cat on packing_r1_lines(category_id);

-- ---- RLS (permissive anon — matches every other table pre-auth) ------------
alter table packing_template_parts enable row level security;
alter table packing_template_lines enable row level security;
alter table packing_r1_lists enable row level security;
alter table packing_r1_lines enable row level security;
drop policy if exists "Allow all for anon" on packing_template_parts;
drop policy if exists "Allow all for anon" on packing_template_lines;
drop policy if exists "Allow all for anon" on packing_r1_lists;
drop policy if exists "Allow all for anon" on packing_r1_lines;
create policy "Allow all for anon" on packing_template_parts for all to anon using (true) with check (true);
create policy "Allow all for anon" on packing_template_lines for all to anon using (true) with check (true);
create policy "Allow all for anon" on packing_r1_lists   for all to anon using (true) with check (true);
create policy "Allow all for anon" on packing_r1_lines   for all to anon using (true) with check (true);
