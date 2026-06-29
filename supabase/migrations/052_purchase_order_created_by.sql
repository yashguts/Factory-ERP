-- =====================================================================
-- 052: Purchase-order creator (audit "who created this PO").
--
-- The Stock Ledger's traceability shows, per movement, the source document
-- and the responsible person. For a Purchase In that person is whoever
-- CREATED the PO — but purchase_orders only ever stored `audited_by` (who
-- reviewed it), never a creator. This app has no auth; the actor is the
-- operator NAME string (factory.operator), the same identity already on
-- inventory_transactions.created_by_name and packing_r1_lists.created_by_name.
--
-- createPurchaseOrder() (manual "Add PO") and the shortfall auto-generate
-- path stamp this from the operator cookie, so every NEW PO records its
-- creator. Pre-existing POs stay null — never captured, cannot be backfilled.
-- =====================================================================

alter table public.purchase_orders
  add column if not exists created_by_name text;
