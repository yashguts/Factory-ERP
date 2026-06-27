-- =====================================================================
-- 048: Inventory-transaction operator (audit "who did this movement").
--
-- The Stock Ledger lists every movement (PO receipt, dispatch, production,
-- adjustment, reversal/undo) but never recorded WHO performed it. This app
-- has no auth; the actor is the operator NAME string (factory.operator) —
-- the same identity already attached to GAD uploads (job_gad_versions.
-- uploaded_by) and job status changes (job_status_changes.changed_by). The
-- pre-existing inventory_transactions.created_by uuid column is always null
-- and unused (no auth users, no FK).
--
-- This adds a text column for the operator name. recordTransaction() stamps
-- it from an explicit arg or the operator cookie (mirrored from localStorage
-- by use-operator), so every NEW movement records its actor. Pre-existing
-- rows stay null — the name was never captured and cannot be backfilled.
-- =====================================================================

alter table public.inventory_transactions
  add column if not exists created_by_name text;
