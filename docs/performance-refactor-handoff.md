# ERP Performance Refactor — Session Handoff (for Fable 5)

**Goal:** the app has gotten slow, **especially opening a new section** (clicking
a sidebar item and waiting). This doc explains the ERP end-to-end and then gives
a **grounded, prioritised plan to make it fast** — with the real numbers measured
2026-07-02. Read §1–2 to understand the system, §3 is the performance work.

---

## 1. What the product is

**LT Factory ERP** — inventory / BOM / jobs / MRP for an elevator manufacturer in
India. Non-developer owner, built incrementally. Live at
`lt-factory-erp.netlify.app`.

**Stack**
- **Next.js 15.5 App Router**, React 19, TypeScript, Tailwind 4.
- **Supabase Postgres** (project `qwzisnmueuqnzzokkpmn`, region **ap-south-1 /
  Mumbai**). Anon key everywhere; permissive RLS; **no auth yet**.
- **Netlify** hosting (`@netlify/plugin-nextjs`), auto-deploys `main`.
- Storage buckets `gad-drawings`, `program-sketches`.

**The golden rule for a refactor:** the owner reviews the **deployed app, not
code**. Ship behind the same behaviour; don't change business semantics (see §4).

---

## 2. Architecture & the patterns that drive performance

**Rendering model.** Almost every page is a **Server Component** under
`src/app/(app)/…/page.tsx` that **awaits data server-side, then renders**. So
"opening a section" = a server round-trip: run the page's data fetch → render RSC
→ stream to the browser. **If that fetch is slow, the section opens slowly.** A
sibling `loading.tsx` is what paints an instant skeleton while the server works —
without one the screen shows **nothing** until the server responds (reads as a
freeze).

**Data layer (`src/lib/`)**
- **Reads** wrapped in `unstable_cache` with tags (`items`, `jobs`, `bom-lines`,
  `inventory-stock`, `categories`, `operations`, `purchase-orders`). Use
  `createCacheClient()` (anon, no cookies).
- **Mutations** use `createClient()` (cookies) and `revalidateTag()` /
  `revalidatePath()`.
- **Server actions** one file per domain in `src/lib/actions/*` (jobs, inventory,
  mrp, operations, item-bom, dispatch, procurement, …).
- **The stock chokepoint:** `recordTransaction` (`inventory.ts`) — every stock
  move; idempotent by `reference_type`+`reference_id`.
- **Postgres RPCs** for the heavy list reads, e.g. `search_inventory` (the
  `/inventory` grid — server-side paginated + filtered + trigram search) and
  `search_operations`.

**Two hard limits the codebase already fights (keep fighting them):**
- `unstable_cache` silently **won't cache results > ~2 MB** → the function re-runs
  on **every** request (feels broken-slow). The full item read (~2.2 MB) hit this;
  its cached wrapper was removed and it only survives as `_getItemsWithStockUncached`.
- PostgREST returns **≤ 1000 rows** per select → big reads page with `.range()`
  (see `fetchAllRanged`). Each page is a **separate round-trip** (matters — see §3).

**Data volumes (2026-07-02)** — what the reads are up against:
| table | rows |
|---|--:|
| **items** | **24,895** |
| job_bom_lines | 7,184 |
| inventory_transactions | 6,762 |
| operation_outputs | 3,121 |
| inventory | 2,842 |
| operations | 1,266 |
| operation_inputs | 1,245 |
| item_categories | 515 |
| item_bom_lines | 438 |
| jobs | 182 |

**Route map:** ~47 pages under `src/app/(app)/`. Biggest surfaces: `/inventory`
(RPC-paginated), `/mrp` + `/mrp/make-plan` + `/mrp/plan` + `/mrp/trade` +
`/mrp/weekly` (the optimiser), `/programs`, `/cabin-inventory` (~9k cabin items),
`/jobs`, `/procurement`.

---

## 3. Performance — root causes (measured) and the fix plan

**The DB is NOT the bottleneck.** Every hot join/filter column is indexed
(`inventory.item_id`, `operation_outputs.(item_id,operation_id)`,
`item_bom_lines.(parent,child)`, `job_bom_lines.(job_bom_id,item_id)`,
`items` has btree + **trigram** indexes for search). **Do not spend time adding
indexes** — the slowness is the app/serverless/latency layer. In order of expected
payoff:

### (1) Cross-region latency — FIXED 2026-07-03
**Measured** via `/api/debug-region` (left deployed as a permanent probe):
functions were in **us-east-2 (Ohio)** vs Supabase in ap-south-1 (Mumbai) —
**~273 ms per query**. Moved to **Singapore (`sin` / ap-southeast-1)** after
owner-authorized `netlify login` (Mumbai is not self-serve): now **~81–111 ms
per query**; cold section opens roughly halved, warm mostly under 1 s.
API note for next time: the writable knob is TOP-LEVEL `functions_region`
(airport code) via `netlify api updateSite`; `build_settings.functions_region`
is silently ignored; a redeploy applies it. The CLI stays logged in on the
owner's machine.
- **Compounding fix (SHIPPED 2026-07-03, d99a291):** the render-path audit
  found 64 sequential-await / fat-read / serial-paging findings across ~20
  files; independent reads are now `Promise.all`'d, twice adversarially
  reviewed, smoke-tested live.

### (2) Missing `loading.tsx` — DONE 2026-07-02 (commit 0c09184)
All 11 uncovered routes got skeletons (`/mrp/make-plan`, the three
`/packing-list-r1` routes, `/jobs/new|import|unmatched|gad-alerts|status-alerts`,
`/procurement/new`, `/inventory/import`). `/mrp/plan` and the root page are pure
redirects and need none. CLAUDE.md's "every route needs a loading.tsx" rule is
accurate again — keep it that way for new routes.

### (3) Uncacheable fat reads (the 2 MB cap)
`_getItemsWithStockUncached` (~2.2 MB, all 24.9k items × ~30 fields) **re-runs
uncached on every load** of the make-plan / plan (and historically Settings). This
is a per-request full-table serialize+transfer.
- **Action:** stop reading the fat shape on hot paths. Project to the handful of
  fields each consumer needs; page; or push the aggregation into a Postgres RPC
  (like `search_inventory` already does). The make-plan only needs
  id/proc/stock/outputs — not descriptions/suppliers/etc.

### (4) Heavy CPU inside server components (the MRP optimiser)
`make-plan-core.ts` runs dominance pruning → 5 greedy strategies → local search on
every **cache miss** (cached 1800s). On a cold cache that's seconds of CPU inside
the request. Same for the weekly allocator.
- **Action:** keep the **algorithm** (it's owner-locked — see §4) but change
  **when/where** it runs: precompute on a schedule / background job and read the
  result; or stream the page shell first and load the plan client-side; or cache
  more aggressively keyed on the demand snapshot.

### (5) Serverless cold starts + over-broad revalidation
- Netlify function cold starts add to first-open latency; smaller route bundles +
  fewer heavy top-level imports help.
- Mutations call `revalidatePath("/inventory")` which **regenerates the 24.9k-item
  page**; several actions note this was slow/crashing. Narrow revalidation to the
  tags actually touched; avoid regenerating giant pages on unrelated writes.

### Quick "measure it" checklist for the next session
1. Netlify function region vs `ap-south-1`. (Likely the headline.)
2. Per-route: query count × RTT (add timing logs or read Netlify function logs).
3. Which routes lack `loading.tsx`.
4. Which server actions call `_getItemsWithStockUncached` / `fetchAllRanged` on the
   render path.
5. Bundle size per route (`next build` output).

---

## 4. Guardrails — do NOT break these while refactoring

- **The make-plan optimiser is owner-locked** (sheet-minimising portfolio: dominance
  prune → 5 greedy → trim → local search; `make-plan-core.ts`,
  `production-plan.ts`, `mrp-weekly.ts`). You may change *where/when* it runs and
  its caching, **never its output/objective**. Memory: `project_make_plan_optimizer`.
- **Mutation semantics are locked** (dispatch deducts stock, make/trade split,
  cutover gating, `recordTransaction` idempotency). Refactor structure, not rules.
  Memory: `feedback_ux_rules_locked`, `project_inventory_movements`,
  `project_inventory_cutover`.
- **Invariants:** `name = lookup_key` synced on write; **`items.part_role`** is the
  structural-kind field (cut_part/finished_good/sub_assembly/raw_material/tooling —
  memory `project_part_role`); every route needs a `loading.tsx`; unstable_cache
  2 MB cap; PostgREST 1000-row cap.
- **Verify with `npx tsc --noEmit`** (must be clean) before every commit; the
  owner reviews the deployed app, so ship in small verifiable steps.
- **Multi-session caveat:** this repo has had **parallel Claude sessions editing
  simultaneously** (files change under you; the `is_child_part`→`part_role`
  collision on 2026-07-02 is the cautionary tale). Re-read a file right before
  editing; coordinate before large sweeps.

---

## 5. Pointers
- **`CLAUDE.md`** (repo root) — the full project bible (structure, schema,
  conventions, pitfalls). Read it; note the "all routes have loading.tsx" claim is
  now stale.
- Memory index `MEMORY.md` — esp. `project_erp_refactor` (a prior compact/pro UI
  refactor), `project_ux_overhaul` (perf wave: URL-state nav, client-fetched
  sidebar badges), `env_preview_caveat` (OneDrive makes **local** dev/preview flaky
  — test on Netlify, not localhost), `project_make_plan_optimizer`, `project_part_role`.
- Heavy reads to scrutinise: `inventory.ts` (`_getItemsWithStockUncached`,
  `getInventoryPage`), `mrp.ts` (`getMrpData`, `getProductionPlan`),
  `make-plan-core.ts`, `operations.ts` (`getOperations`), `item-bom.ts`.
- Open functional threads (not perf): LP-001 bracket mapping + MFS-042
  classification (both have scheduled reminders for 2026-07-03); the broader
  inventory-flow work in `docs/inventory-flow-handoff.md`.
