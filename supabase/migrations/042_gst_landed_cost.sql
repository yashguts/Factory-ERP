-- =====================================================================
-- 042: GST + landed cost — exact product costing for procurement.
--
-- Records GST per line (rate varies item-wise) and PO/receipt additional
-- charges (freight, insurance, customs, etc.). The receipt's landed cost —
-- basic (net of discount) + NON-creditable tax + allocated non-creditable
-- charges, all in INR, divided by stock qty — becomes items.cost_price.
-- Creditable GST/IGST is recorded but EXCLUDED from cost (claimed as ITC).
--
-- Guarded with "if not exists" because some procurement columns (suppliers,
-- dual-UOM, PO pdf) were applied via the Supabase MCP, not via repo files.
-- =====================================================================

-- Item GST master ------------------------------------------------------
alter table public.items add column if not exists gst_rate numeric(5,2) not null default 0;
alter table public.items add column if not exists hsn_code text;
-- Default TRUE: a registered manufacturer claims input credit, so GST is
-- excluded from cost. Mark an item FALSE to fold its GST into landed cost.
alter table public.items add column if not exists gst_creditable boolean not null default true;

-- PO header: domestic/import classification + currency -----------------
alter table public.purchase_orders add column if not exists procurement_kind text not null default 'domestic';
alter table public.purchase_orders add column if not exists currency text not null default 'INR';
alter table public.purchase_orders add column if not exists fx_rate numeric not null default 1;
alter table public.purchase_orders add column if not exists incoterm text;
alter table public.purchase_orders add column if not exists supplier_gstin text;
alter table public.purchase_orders add column if not exists place_of_supply text;

-- PO line: discount + per-line GST overrides (null => inherit the item) -
alter table public.purchase_order_lines add column if not exists discount_pct numeric not null default 0;
alter table public.purchase_order_lines add column if not exists gst_rate numeric;
alter table public.purchase_order_lines add column if not exists gst_creditable boolean;

-- Receipt line: snapshot of the tax + landed cost actually applied -----
alter table public.purchase_order_receipt_lines add column if not exists discount_pct numeric not null default 0;
alter table public.purchase_order_receipt_lines add column if not exists gst_rate numeric;
alter table public.purchase_order_receipt_lines add column if not exists gst_amount numeric;        -- INR
alter table public.purchase_order_receipt_lines add column if not exists gst_creditable boolean;
alter table public.purchase_order_receipt_lines add column if not exists landed_unit_cost numeric;   -- INR / stock unit

-- Additional charges ---------------------------------------------------
-- receipt_id NULL  => PO-level ESTIMATE (never costed)
-- receipt_id SET   => receipt ACTUAL (allocated into cost_price)
create table if not exists public.po_charges (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  receipt_id uuid references public.purchase_order_receipts(id) on delete cascade,
  charge_type text not null,
  label text,
  amount numeric not null default 0,
  currency text not null default 'INR',
  fx_rate numeric not null default 1,
  creditable boolean not null default false,        -- only customs_igst defaults true (set in app)
  allocation_basis text not null default 'value',
  created_at timestamptz not null default now()
);
create index if not exists idx_po_charges_po on public.po_charges(po_id);
create index if not exists idx_po_charges_receipt on public.po_charges(receipt_id);

alter table public.po_charges enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'po_charges' and policyname = 'Allow all for anon'
  ) then
    create policy "Allow all for anon" on public.po_charges for all using (true) with check (true);
  end if;
end $$;
grant all on public.po_charges to anon, authenticated, service_role;
