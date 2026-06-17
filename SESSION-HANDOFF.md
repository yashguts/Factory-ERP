# Session Handoff — 2026-06-17 (Factory ERP)

Read this top-to-bottom, then continue at **"What's left to do"**. Read
**CLAUDE.md** first. Working dir is on **`main`**. Confirm before any
data-mutating step. The Supabase MCP connector was intermittently timing out
during this session — just retry the same call.

---

## TL;DR

1. **Deploy was failing** → root-caused and **fixed + pushed to `main`**
   (commit `99bf3fa`). Netlify should be green now.
2. **Dispatch "0 dispatched" bug** (owner reported on job **4802**, Guide Rail
   9X65X70) → root-caused, and **4 jobs' data already repaired via SQL**
   (no inventory touched, per owner instruction).
3. **NOT yet done:** the durable code-level *prevention* so the bug can't
   recur, and a final SQL verification pass. Details below.

---

## 1. Deploy failure — DONE (committed `99bf3fa`, pushed to main)

**Root cause:** a separate contributor's commit `6fabef0`
("feat(inventory): item purchase UOM + conversion (foundation)") added
`items.purchase_uom_id` as a **second FK from `items` to
`units_of_measurement`**. That made every PostgREST embed of the form
`uom:units_of_measurement(...)` **ambiguous** → PostgREST throws `PGRST201`
("more than one relationship was found"). The production build died while
**prerendering `/settings`** (it exits at the first failing prerender; other
items+uom reads would also fail at runtime).

**Fix applied:** qualified all **27 embeds across 12 action files** with the
explicit FK name: `uom:units_of_measurement!items_uom_id_fkey(...)`. The
item's own UOM is always `uom_id`, so the transform was uniform. Files:
`bom-predict, cabin-jobs, cabin-programs, dispatch, inventory, item-bom,
items, jobs, mrp-weekly, mrp, operations, procurement` (all in
`src/lib/actions/`). Full `npm run build` is **green**; `/settings`
prerenders again.

> If you ever add another items↔units_of_measurement embed, you MUST name the
> FK (`!items_uom_id_fkey`, or `!items_purchase_uom_id_fkey` for the purchase
> unit) or the build breaks again.

**Owner's UOM question — answer to relay:** "Do items now have a different
Inventory UOM and Purchase UOM?" → The purchase-UOM feature (commit `6fabef0`,
**not** my deploy fix) added an **optional** Purchase UOM + conversion factor
per item. Default is **"Same as stock"** (`purchase_uom_id` NULL = bought and
stocked in the same unit). Every item's **Inventory/stock UOM is unchanged**.
It's foundation-only — the commit says *"everything stored stays in the stock
UOM; PO/receipt wiring comes in the next phases."* My deploy fix changed **no**
UOM data — it only told the query which relationship to follow (still the
stock UOM). (Couldn't confirm how many items have a purchase UOM set yet —
connector was down; run the verify query in section A.)

---

## 2. Dispatch "0 dispatched" bug — ROOT CAUSE + data repaired (no inventory)

**Symptom:** owner dispatched job 4802 (incl. Guide Rail 9X65X70 qty 6) but the
Dispatch modal showed "0 dispatched" for it.

**Root cause (NOT a regression from recent dispatch features):**
- `job_dispatch_lines.job_bom_line_id` is an FK **`ON DELETE SET NULL`**.
- `saveBomSection` (`src/lib/actions/jobs.ts:614`) **deletes + reinserts** all
  BOM lines for the saved categories ("picker is source of truth").
- So **editing/re-saving a job's BOM *after* dispatching it** deletes the old
  BOM lines → the FK nulls every dispatch→line link → dispatched reads as
  **0** and **stops netting in MRP** (MRP also nets via that FK).
- Proven on 4802: dispatch created `11:17:15`; all 48 current BOM lines created
  `11:38:08` (21 min later) → all 11 dispatch links nulled.

**Data already repaired (pure FK re-link, ZERO inventory effect):**
- **4802** — re-linked its 11 orphaned lines by `item_id` (Guide Rail 9X65X70
  now 6 of 7 dispatched).
- **RNLKOL-0035 (34), RNLNAG011 (13), 4907 (5)** — same silent bug; re-linked by
  `item_id` preferring same `category`. Owner said **"mark dispatch but don't
  deduct from inventory"** — satisfied by construction: re-linking only sets
  `job_bom_line_id`, posts no stock transactions, and these dispatches predate
  the deduct-on-dispatch feature anyway.

The exact repair UPDATE used (for reference / re-runnable, idempotent):
```sql
UPDATE job_dispatch_lines dl
SET job_bom_line_id = (
  SELECT bl.id FROM job_bom_lines bl
  JOIN job_bom_headers h ON h.id = bl.job_bom_id
  JOIN job_dispatches d2 ON d2.id = dl.dispatch_id
  WHERE h.job_id = d2.job_id AND bl.item_id = dl.item_id
  ORDER BY (bl.category IS DISTINCT FROM dl.category), bl.sort_order, bl.id
  LIMIT 1)
WHERE dl.job_bom_line_id IS NULL AND dl.item_id IS NOT NULL
  AND dl.dispatch_id IN (SELECT d.id FROM job_dispatches d JOIN jobs j ON j.id=d.job_id
                         WHERE j.job_number IN ('RNLKOL-0035','RNLNAG011','4907'))
  AND EXISTS (SELECT 1 FROM job_bom_lines bl JOIN job_bom_headers h ON h.id=bl.job_bom_id
              JOIN job_dispatches d3 ON d3.id=dl.dispatch_id
              WHERE h.job_id=d3.job_id AND bl.item_id=dl.item_id);
```
> Caches (dispatch summary + MRP, ~600s TTL) won't reflect these repairs until
> they expire OR a redeploy wipes them. The `99bf3fa` push already triggers a
> Netlify redeploy → cache wiped → repairs should show.

---

## What's left to do

### A. VERIFY the repairs (connector was down — re-run this)
```sql
SELECT
  (SELECT COUNT(*) FROM job_dispatch_lines dl
     JOIN job_dispatches d ON d.id=dl.dispatch_id JOIN jobs j ON j.id=d.job_id
     WHERE dl.job_bom_line_id IS NULL AND dl.item_id IS NOT NULL
       AND j.job_number IN ('RNLKOL-0035','RNLNAG011','4907','4802')
       AND EXISTS (SELECT 1 FROM job_bom_lines bl JOIN job_bom_headers h ON h.id=bl.job_bom_id
                   WHERE h.job_id=d.job_id AND bl.item_id=dl.item_id)
  ) AS still_orphaned_relinkable,          -- expect 0
  (SELECT COUNT(*) FROM inventory_transactions
     WHERE reference_type='dispatch' AND reference_id IN (
       SELECT d.id FROM job_dispatches d JOIN jobs j ON j.id=d.job_id
       WHERE j.job_number IN ('RNLKOL-0035','RNLNAG011','4907','4802'))
  ) AS dispatch_inv_txns_for_these_jobs,   -- expect 0 (no inventory deducted)
  (SELECT COUNT(*) FROM items WHERE purchase_uom_id IS NOT NULL) AS items_with_purchase_uom,
  (SELECT COUNT(*) FROM items) AS total_items;
```

### B. CODE the durable prevention (NOT started) — the main remaining task
Make `saveBomSection` self-heal so a post-dispatch BOM edit can't orphan
dispatch links again. **Pure link repair — must NOT post any inventory
transaction.**

In `src/lib/actions/jobs.ts`, add a non-exported async helper and call it at
the **end of `saveBomSection`** (after the insert loop finishes ~line 676,
before the `revalidateTag` calls at ~678):

```ts
// type for the cookies-aware client:  Awaited<ReturnType<typeof createClient>>
async function relinkOrphanedDispatchLines(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  headerId: string,
) {
  const { data: dispatches } = await supabase
    .from("job_dispatches").select("id").eq("job_id", jobId);
  const ids = (dispatches ?? []).map((d) => d.id);
  if (ids.length === 0) return;

  const { data: orphans } = await supabase
    .from("job_dispatch_lines")
    .select("id, item_id, category")
    .in("dispatch_id", ids)
    .is("job_bom_line_id", null)
    .not("item_id", "is", null);
  if (!orphans?.length) return;

  const { data: lines } = await supabase
    .from("job_bom_lines")
    .select("id, item_id, category, sort_order")
    .eq("job_bom_id", headerId)
    .not("item_id", "is", null);

  const byItem = new Map<string, { id: string; category: string | null }[]>();
  for (const l of (lines ?? []).sort((a,b)=>(a.sort_order??0)-(b.sort_order??0))) {
    const arr = byItem.get(l.item_id) ?? [];
    arr.push({ id: l.id, category: l.category });
    byItem.set(l.item_id, arr);
  }
  for (const o of orphans) {
    const cands = byItem.get(o.item_id);
    if (!cands?.length) continue;                 // item no longer on BOM → leave as genuine "extra item"
    const match = cands.find((c) => c.category === o.category) ?? cands[0];
    await supabase.from("job_dispatch_lines")
      .update({ job_bom_line_id: match.id }).eq("id", o.id);
  }
}
```
Call site: `await relinkOrphanedDispatchLines(supabase, jobId, headerId);`
Notes:
- Restores the FK, so BOTH the dispatch summary AND MRP netting auto-correct
  (no change to their read logic). Going forward, *any* BOM save heals orphans.
- An "extra item" genuinely not on the BOM stays orphaned (correct) → still
  shows the "extra item" pill (`l.adhoc` is derived from null `job_bom_line_id`).
- Common case (job never dispatched) = 1 cheap query then early-return.
- `jobs.ts` is `"use server"` — only **exports** must be async functions; a
  non-exported async helper is fine.

### C. Verify + ship B
- `npx tsc --noEmit` (clean) → `npm run build` (green).
  - **OneDrive flake:** if build dies with `readlink EINVAL` on
    `.next/diagnostics/...`, run `rm -rf .next` then rebuild — it's not a code
    error.
- Branch: this is a localised bug-fix → `main` is fine (per CLAUDE.md rubric).
- `git add` ONLY `src/lib/actions/jobs.ts` (the repo root + `scripts/` are full
  of untracked scratch files — never `git add -A`).
- Co-author trailer: **`Claude Opus 4.8 <noreply@anthropic.com>`** (matches the
  repo's recent commits, incl. `6fabef0`).
- Tell the owner: which jobs were repaired, that no stock was touched, and that
  editing a dispatched job's BOM is now safe.

---

## Gotchas / environment
- **Supabase MCP** times out intermittently → just retry the same call.
- **OneDrive** corrupts `.next` (`readlink EINVAL`) → `rm -rf .next` before build.
- Repo working tree has MANY untracked scratch files (root `_*.png`, `a_copy.xlsx`,
  `scripts/_*`, `scripts/*.json`, `pdf-dxf-pilot/`, `.claude/`). Stage explicit
  paths only.
- `verify-trade-part-demand.ts` has a **pre-existing** stale assertion (fails on
  base commit too) — not a regression; ignore for this work.
- After SQL data changes, the cached dispatch/MRP reads lag until TTL (~600s) or
  a redeploy wipes the cache.

## Key files
- `src/lib/actions/jobs.ts` — `saveBomSection` (line ~614); add the helper here.
- `src/lib/actions/dispatch.ts` — `getJobDispatchSummary`, `createDispatch`,
  `postDispatchInventory`, `reverseDispatchInventory` (dispatch + its inventory).
- `src/components/jobs/dispatch-modal.tsx` / `dispatch-panel.tsx` — dispatch UI
  ("extra item" pill is driven by null `job_bom_line_id`).
