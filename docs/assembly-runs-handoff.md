# Assembly Runs — Build Handoff

Self-contained spec to continue the **Assembly Runs** feature from a fresh session.
Branch: **`feature/assembly-runs`** (base: `main`). Supabase project `qwzisnmueuqnzzokkpmn`.

---

## 1. Why this exists (the problem)

Program runs (Daily Program Runs → inventory, `operation_runs`) only stock a program's
**`component`** outputs. They **skip** `cut_part` / `tooling` / `scrap` outputs. Many
finished sub-assemblies are *built from loose `cut_part` (phantom) children*, and there
is **no mechanism to assemble children into the parent**, so the finished item's stock
never increases.

**Concrete case the owner hit (23 June):** programs `121 ACO DOOR FRAME 2000 (SS Rose
Gold Mirror)` and `121A …` cut the loose parts **LP-059** (Auto Door Post … LEFT) and
**LP-065** (… RIGHT), which are `cut_part` + `phantom`. The parent **SA-HD-183 "Auto
Door Post CO/SS(STD) (Rose Gold Mirror)"** is `stocked` and its Built-from list
(`item_bom_lines`) is LP-059 ×1 + LP-065 ×1. Recording the runs produced the
*components* (Read Channel SA-BF-114, Dead Weight Channel SA-HD-062) and consumed the
sheet (RM-191), but **never the Auto Door Post** — because the loose parts are skipped
and nothing assembles them. Stock of SA-HD-183 stayed 0.

## 2. The model — a real production chain

```
raw sheet --[program run]--> loose parts in stock --[ASSEMBLY RUN]--> parent
sub-assembly in stock --[dispatch]--> out
```

Two changes make it work: **(a)** loose parts get stocked when a program runs;
**(b)** a new **Assembly Run** consumes the children and produces the parent.

## 3. Owner's cutover plan — CRITICAL, do NOT retrofit history

The owner enters all programs through **29 Jun**, takes a **full physical inventory
count on the morning of 30 Jun 2026** (the baseline), and only runs from **30 Jun
onward** use the new method.

- Loose-part stocking on program runs MUST be gated by a **hard date cutoff:
  `run_date >= '2026-06-30'`**. Runs ≤ 29 Jun keep today's behaviour (cut_part skipped).
- **NO backfill of historical runs. Ever.**
- Assembly runs are forward-only by nature.

## 4. Locked decisions (from the owner)

1. **UI:** new **"Assembly Runs" sidebar page** (mirrors `/program-runs`) **+** a
   **Build** button on each sub-assembly's detail page (`/inventory/[id]`).
2. **Insufficient child stock → BLOCK the build** (already enforced in the action).
3. **MRP:** eventually **net against loose-part stock** — do this LAST and carefully;
   it's a no-op while loose stock is 0 (so safe to ship before the cutover), and it
   touches the **owner-locked** make-plan/weekly optimiser, so verify output is
   unchanged (diff before/after on a few jobs).

## 5. Scope (small & clean)

- 77 phantom items; **66 are children of a sub-assembly** (loose parts feeding a parent).
- 68 distinct phantom items appear as `cut_part` program outputs.
- ~315 items have a parts list (`item_bom_lines`).
- **All `item_bom_lines` are `finish_rule='neutral'`** → `child_item_id` is the exact
  item to consume; **no finish resolution needed** (confirmed by the comment in
  `src/lib/actions/mrp.ts` ~line 269).
- Warehouses by name: **"Main Store"** (finished/components) and **"Raw Material Store"**
  (sheets). Resolve by name (see `operation-runs.ts` `resolveStores`).

## 6. Status

### DONE — Phase 1 backend (committed `78e59c4` on `feature/assembly-runs`)
- **migration `supabase/migrations/051_assembly_runs.sql`** (APPLIED to the DB):
  `assembly_runs(id, item_id→items, build_date, qty>0, note, created_by_name,
  created_at, updated_at)`, indexes on date/item, anon RLS.
- **`src/lib/actions/assembly-runs.ts`** — all server actions, mirroring
  `operation-runs.ts`:
  - `getAssemblyRunsForDate(date)` → builds on a date + each parent's children & their
    Main-Store stock.
  - `searchBuildableItems(query)` → items that HAVE a parts list (the Build picker).
  - `getBuildPreview(parentId)` → children + per-build qty + current Main-Store stock
    (for the modal preview + block).
  - `recordAssemblyRun({item_id, build_date, qty, note})` → **blocks** if any child is
    short on Main-Store stock; else inserts + posts inventory.
  - `updateAssemblyRunQty(id, qty)` / `deleteAssemblyRun(id)` → reconcile/restore.
  - `syncAssemblyInventory(run, parent, qty)` → consume children (`production_out`,
    Main Store) + produce parent (`production_in`, Main Store), `reference_type=
    'assembly_run'`, idempotent delta-reconcile. Reuses `recordTransaction` from
    `inventory.ts`.

### TODO — Phase 1 UI
1. **`src/app/(app)/assembly-runs/page.tsx`** (server) + **`loading.tsx`** — read
   `?date=` (default today), call `getAssemblyRunsForDate`, render a client. Mirror
   `src/app/(app)/program-runs/page.tsx`.
2. **`src/components/.../assembly-runs-client.tsx`** — date logbook like
   `program-runs` client: list builds (parent + qty + children consumed), inline edit
   qty (`updateAssemblyRunQty`), delete (`deleteAssemblyRun`). A **Build** action:
   `searchBuildableItems` → pick parent → `getBuildPreview` shows children + stock +
   "max buildable" (= min over children of floor(stock/perBuild)) → enter qty (blocked
   client-side past max, server re-checks) → `recordAssemblyRun`. Use `useToast()` for
   feedback; URL-state for `date` (see `use-url-list-state.ts`).
3. **Sidebar** — add "Assembly Runs" in `src/components/layout/sidebar.tsx` (near
   Program Runs, PRODUCTION group).
4. **Build button on `/inventory/[id]`** (`ItemDetailClient`) — only for items that
   have a Built-from list; opens the same Build modal pre-set to that item.

### TODO — Phase 2 (loose-part stocking, cutover-gated)
- Reclassify the **66 phantom assembly-children → `stocked`** (SQL update on
  `items.stock_behaviour`). Decide whether to also stock the other ~11 phantoms (likely
  leave them).
- Make `operation-runs.ts` `syncRunInventory` **item-driven + cutoff-gated**: post an
  output to Main Store when its **item is `stocked`** (component OR cut_part), EXCEPT a
  `cut_part` only posts when the run's `run_date >= '2026-06-30'` (constant, e.g.
  `LOOSE_PART_STOCK_FROM`). Keep skipping `tooling`/`scrap` and phantom-non-stocked.
  Keep it idempotent (the delta-reconcile already handles re-syncs).
- **Verify make-plan / MRP output is UNCHANGED** after reclassifying (run a few jobs
  before/after; the optimiser is locked — see [[project_make_plan_optimizer]]).

### TODO — Phase 3 (MRP netting)
- Net on-hand loose-part stock into MRP/make-plan demand (don't re-cut what's cut).
  Careful: locked optimiser. No-op until loose stock exists (post-30th).

## 7. How to test / verify

- Re-seed/verify by hitting routes on a dev server, but **do NOT run two `next dev`
  in this repo folder at once** — they share `.next` and corrupt it (caused 500s/404s).
  For anything bulk, seed via the **Netlify deploy** (`https://lt-factory-erp.netlify.app`)
  once the branch is merged/deployed, or use a single clean local dev.
- OneDrive makes local preview flaky (see [[env_preview_caveat]]); verify via DB
  queries (Supabase MCP) over screenshots.
- Smoke test the build: pick SA-HD-183, ensure LP-059/LP-065 have Main-Store stock
  (post-cutover, via a program run ≥30 Jun), `recordAssemblyRun` ×N → check
  `inventory_transactions` (reference_type='assembly_run'): N×production_in SA-HD-183 +
  N×production_out each child; child & parent balances move correctly; delete restores.

## 8. Gotchas

- `inventory_transactions`: `reference_id` is `uuid`; outbound types are
  `production_out`/`scrap`/`dispatch_out` (see `recordTransaction` in `inventory.ts`).
- `createCacheClient()` (anon) for cached reads; cookies-aware `createClient()` for
  mutations.
- DB category-name typos exist (Miscallaneous, etc.) — irrelevant here but don't "fix".
- The `searchBuildableItems` query reads all `item_bom_lines` (~small) to find parents;
  fine at current scale.

## 9. Related memory

[[project_assembly_runs]], [[project_program_run_inventory]],
[[project_inventory_movements]], [[project_make_plan_optimizer]], [[project_factory_erp]].
