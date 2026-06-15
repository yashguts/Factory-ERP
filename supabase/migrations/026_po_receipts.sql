-- Goods receipts for purchase orders.
--
-- A PO can be received in several dated deliveries (partial receipts), each with
-- its own invoice + per-item quantity and the ACTUAL rate paid. Receiving posts
-- the received qty into stock (via recordTransaction), accumulates
-- purchase_order_lines.received_qty, and the rate feeds the item price book.
-- on_order (po-outstanding) already nets received_qty, so partials flow into MRP
-- automatically — no change there.

create table if not exists purchase_order_receipts (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  receipt_date date not null default current_date,
  invoice_number text,
  invoice_url text,
  invoice_filename text,
  invoice_uploaded_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_po_receipts_po on purchase_order_receipts(po_id);

create table if not exists purchase_order_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references purchase_order_receipts(id) on delete cascade,
  -- the PO line being fulfilled; SET NULL keeps receipt history if a line is later removed.
  po_line_id uuid references purchase_order_lines(id) on delete set null,
  item_id uuid not null references items(id),
  qty numeric not null check (qty > 0),
  unit_rate numeric, -- actual rate paid (optional); latest non-null feeds items.cost_price
  created_at timestamptz not null default now()
);
create index if not exists idx_po_receipt_lines_receipt on purchase_order_receipt_lines(receipt_id);
create index if not exists idx_po_receipt_lines_item on purchase_order_receipt_lines(item_id);

-- Permissive RLS, matching purchase_orders / purchase_order_lines (anon used app-wide until auth lands).
alter table purchase_order_receipts enable row level security;
alter table purchase_order_receipt_lines enable row level security;
create policy "purchase_order_receipts all" on purchase_order_receipts for all to public using (true) with check (true);
create policy "purchase_order_receipt_lines all" on purchase_order_receipt_lines for all to public using (true) with check (true);

-- Invoice storage bucket (mirrors gad-drawings / program-sketches).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('po-invoices', 'po-invoices', true, 52428800,
  array['application/pdf','image/png','image/jpeg','image/jpg','image/webp'])
on conflict (id) do nothing;

create policy "po_invoices_select" on storage.objects for select to anon, authenticated using (bucket_id = 'po-invoices');
create policy "po_invoices_insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'po-invoices');
create policy "po_invoices_update" on storage.objects for update to anon, authenticated using (bucket_id = 'po-invoices') with check (bucket_id = 'po-invoices');
create policy "po_invoices_delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'po-invoices');
