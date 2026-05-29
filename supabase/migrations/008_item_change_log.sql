-- Inventory change log
--
-- Records every create / update / delete on an item so the
-- Inventory → Daily Changes page can show what was edited on a given
-- date (with before→after diffs) and offer one-click undo. Item edits
-- previously had no history at all; stock moves already live in
-- inventory_transactions, which the Daily Changes page reads alongside
-- this table.
--
-- Already applied to the hosted project via the Supabase MCP; this file
-- exists so the schema is reproducible from the repo.

CREATE TABLE IF NOT EXISTS public.item_change_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable + ON DELETE SET NULL: a later hard-delete of the item leaves
  -- the log row intact (and a null item_id marks it "not undoable").
  item_id     uuid REFERENCES public.items(id) ON DELETE SET NULL,
  -- Code/name snapshot so the entry stays readable after rename/delete.
  item_code   text,
  item_name   text,
  action      text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  -- Array of { field, old, new } describing exactly what changed.
  changes     jsonb NOT NULL DEFAULT '[]'::jsonb,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  -- Set when this entry has been undone (prevents double-undo).
  reverted_at timestamptz,
  -- When this entry IS itself an undo, points at the entry it reversed.
  revert_of   uuid REFERENCES public.item_change_log(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_item_change_log_created_at
  ON public.item_change_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_change_log_item_id
  ON public.item_change_log USING btree (item_id);

-- Permissive RLS, consistent with every other table (auth not yet wired).
ALTER TABLE public.item_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for anon" ON public.item_change_log;
CREATE POLICY "Allow all for anon" ON public.item_change_log
  FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT ALL ON public.item_change_log TO anon, authenticated, service_role;
