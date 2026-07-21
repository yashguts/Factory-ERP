-- Global acknowledgements for CRM payment-event notifications (the sidebar
-- "CRM Payments" blinker). The events themselves live in the CRMs — read at
-- poll time via the secret-gated erp_recent_payment_events RPC on each CRM
-- project (same contract as erp_job_financials) — so this table only records
-- which event ids the office has acknowledged. Same global-ack model as
-- Status Alerts: once anyone acknowledges, the blink clears for everyone.
create table if not exists public.crm_payment_event_acks (
  event_id text primary key,
  source text not null check (source in ('ricardo', 'ltcrm')),
  job_number text,
  acknowledged_by text,
  acknowledged_at timestamptz not null default now()
);
alter table public.crm_payment_event_acks enable row level security;
drop policy if exists "Allow all for anon" on public.crm_payment_event_acks;
create policy "Allow all for anon" on public.crm_payment_event_acks for all to anon using (true) with check (true);
