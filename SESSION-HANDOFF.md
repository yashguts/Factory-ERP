# Session Handoff — 2026-06-20 (Factory ERP)

Live: **https://lt-factory-erp.netlify.app** · deployed commit `f11b714` · `main` · Netlify build clean.
Local == repo (`npm install` done, `tsc` + `npm run build` pass). Owner is **non-developer** — they review the deployed app, not code. **Read `CLAUDE.md` first** (deep reference); this file is the quick orientation.

---

## 0 — What this is

ERP for an **elevator-manufacturing** business in India (the owner makes lifts +
a car-parking product). Tracks **inventory, BOMs, job orders, packing/part lists,
MRP/planning, programs (CNC recipes), procurement, dispatch**. Built incrementally
with the owner over many sessions. Next.js app, Supabase backend, auto-deploys to
Netlify on push to `main`.

## 1 — Stack & infra

- **Frontend**: Next.js 15.5 App Router, React 19, TypeScript, Tailwind 4.
- **DB**: Supabase Postgres — project `qwzisnmueuqnzzokkpmn`, region ap-south-1.
- **Storage**: Supabase buckets `gad-drawings` (job drawings), `program-sketches`,
  `po-invoices`.
- **Hosting**: Netlify, auto-deploys `main` (~1 min). Hard-refresh tabs after deploy.
- **Auth**: NOT wired yet. Anon key used everywhere; RLS is permissive (`Allow all
  for anon`, `FOR ALL TO anon USING(true) WITH CHECK(true)`) on every table. New
  tables: enable RLS + add that policy to match.

## 2 — Daily commands

```bash
npm run dev          # local dev (OneDrive makes this flaky — see gotchas)
npx tsc --noEmit     # the gate — must be clean before every commit
rm -rf .next && npm run build   # the prod build Netlify runs; clear .next first (OneDrive)
```

## 3 — Tools you have

- **Supabase MCP** (`mcp__ea97…__*`): `execute_sql` (reads + ad-hoc writes),
  `apply_migration` (DDL), `get_logs`, `get_advisors`. Times out intermittently →
  just retry. **Confirm with owner before any data-mutating SQL > 1 row**; preview
  a count first.
- **Claude Preview MCP** (`mcp__Claude_Preview__*`): real browser to verify UI.
  Quirk: it intermittently bounces the tab to `/jobs`; re-`location.href` and wait.
  Screenshots sometimes downscale — read the DOM (`preview_eval`) to confirm content.
- **Netlify MCP**: deploy state / env vars (rarely needed; push is enough).

## 4 — Codebase map

```
src/app/(app)/        Route group with the shared sidebar (AppShell)
  inventory/          Main inventory list (server-paginated RPC) + item detail [id] + import
  cabin-inventory/    Cabin items by type (11 types under "Cabin" category) — kept OUT of /inventory
  subassemblies/      Items that have a parts list
  inventory/changes/  Daily Changes feed (edits + stock moves + undo)
  jobs/               Job Orders: list, new, [id] detail, [id]/edit, [id]/packing-list, unmatched, import
  cabin-jobs/         Cabin job orders
  programs/           Programs (CNC/assembly recipes) + [id]
  cabin-programs/     Finish-aware cabin cutting programs
  program-runs/       Daily program-run logbook
  mrp/                Make MRP (req/programs/weekly) ; mrp/trade (buy) ; mrp/cabin ; mrp/shortfall
  procurement/        Purchase orders + receipts
  demand/, settings/, assistant/
src/components/<area>/ Client components per area (jobs/, inventory/, cabin/, mrp/, ui/)
src/lib/
  actions/<domain>.ts  Server actions, one file per domain (jobs, inventory, mrp, dispatch, cabin, …)
  bom/bom-sections.ts        BOM section config for the job form (single source of truth)
  packing-list/              Part-list template (packing-list-sections.ts) + helpers.ts
  supabase/{server,cache-client,types}.ts   SSR client (mutations) / anon cached client (reads) / hand types
  hooks/use-url-list-state.ts  URL-backed list state (every list keeps filters/sort/page in the URL)
supabase/migrations/   SQL migrations (latest applied: 039_packing_lists)
scripts/               Dev/data scripts (gen-*, seed-*, analysis) — mostly untracked scratch
```

## 5 — Conventions that bite if ignored

- **Branch strategy** (CLAUDE.md §0): typos/small fixes/new-column features → `main`.
  Risky schema change / big refactor / speculative → feature branch + tell the owner.
  Owner reviews the **deployed app**; default to merging to `main` so they can see it.
- **Cache**: cached reads use `unstable_cache` + tags (`items`, `jobs`, `bom-lines`,
  `inventory-stock`, `categories`, `operations`, `packing-lists`, …) via the anon
  `cache-client`. Mutations use the cookies-aware `server` client + must
  `revalidateTag()`. After raw SQL (outside the app), push an empty commit to wipe
  the build-tier cache, or wait for the 60–600s TTL.
- **Server-action errors are stripped in prod** → return a discriminated
  `{ ok:false, error }` for user-facing validation, don't throw.
- **`items.name` is the display name everywhere**; `lookup_key` is synced = name
  (legacy search fallback) — never show `lookup_key || name`.
- **Make vs Trade**: effective = `item.procurement_type ?? category.procurement_type`.
- Every route needs a `loading.tsx`. Use `useToast()` for all mutation feedback.
- DB category names have intentional typos (`Pannel`, `Miscallaneous`, `Thimbel`,
  `Pully`) — match them exactly, don't "fix".

## 6 — Recent work (context for what's fresh)

- **Part List / Packing List** (per job, `/jobs/[id]/packing-list`): rebuilt 06-20
  around the real **Mechanical Part List** format (corpus `~/Downloads/Part List.xlsx`,
  238 jobs). Template = **501 "Particulars" (Col C = category) in canonical order**,
  each `item` (inventory search, scoped to a category) or `free` (fastener/kit/
  consumable free-text). Generated by `scripts/gen-partlist-template.js` →
  `src/lib/packing-list/packing-list-sections.ts` + `scripts/_packing_sections.json`.
  Seeded from each job's BOM (`scripts/seed-packing-lists.js --reseed`). To change it:
  edit the generator's OVERRIDES/classify, re-run, then `--reseed`. Migration 039 =
  `packing_lists` + `packing_list_lines`. Memory: `project_packing_list.md`.
- **Cabin inventory stock now hand-editable** (06-20): the same `InlineStockAdjust`
  widget as `/inventory` is on each cabin-type row (`cabin-type-client.tsx`).
- **Parallel session also shipped** (already merged): per-item **stock ledger**
  (hover + PDF via jspdf) and **program-count-per-item** hover on inventory.

## 7 — Gotchas (real, recurring)

- **OneDrive** corrupts `.next` (`readlink EINVAL`) and makes local dev/preview
  flaky → `rm -rf .next` before a local build; prefer verifying via deployed or
  short preview sessions. (Memory: `env_preview_caveat.md`.)
- **PostgREST 1000-row cap**: any read that can exceed 1000 rows MUST page with
  `.range()` (cabin/inventory/MRP do). `unstable_cache` silently won't cache
  entries > ~2 MB — project to the few fields you need on hot pages.
- **Stale deploy guard** prompts reload when a long-open tab hits a stale server
  action after a deploy — expected, not a bug.
- **Staging**: repo has many untracked scratch files (`scripts/_*.js`, `_*.png`,
  `*.xlsx`) — `git add` explicit paths only, never `git add -A`.
- Co-author trailer on commits: `Claude Opus 4.8 <noreply@anthropic.com>`.

## 8 — Deeper docs

- **`CLAUDE.md`** — full schema, every feature, all conventions. Read first.
- **Auto-memory** (`~/.claude/.../memory/MEMORY.md` index) — per-feature project
  notes (packing list, cabin programs, MRP rules, procurement, inventory movements,
  UX rules, optimiser-locked, etc.). Loaded automatically each session.

---

## OPEN / carried forward

- **Part List polish** (optional): ~123 of the 501 item-particulars search ALL
  inventory (no category scope) — tighten `OVERRIDES` in
  `gen-partlist-template.js` over time. Owner has the reviewable
  `Desktop/Proposed Part List Master Template.xlsx` and can edit order/rows; rebuild
  from their edits if sent.
- **Durable fix not yet done** (from prior handoff): `saveBomSection`
  (`lib/actions/jobs.ts`) deletes+reinserts BOM lines, nulling dispatch→line FK
  links (`ON DELETE SET NULL`). A `relinkOrphanedDispatchLines` helper was drafted
  to re-link orphans at the end — verify it's still missing (grep) and add if so.

**Ready for the next big feature — describe it and I'll scope + build.**
