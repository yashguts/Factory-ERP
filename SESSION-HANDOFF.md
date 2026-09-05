# Session Handoff — 2026-09-05 (Factory ERP)

Live: **https://lt-factory-erp.netlify.app** · `main` · Netlify auto-deploys ~1 min on push (hard-refresh tabs).
Owner is a **non-developer** — reviews the deployed app, not code. **`CLAUDE.md` is the deep reference**;
this file is quick orientation + what's fresh. Also read the auto-memory index
(`~/.claude/projects/H--Anthropic-Access-ERPFACTORY/memory/MEMORY.md`).

> **Read this first.** The previous version of this file was dated **2026-06-20** and led with the Auto Part
> List build. **352 commits landed between then and today**, so that headline stopped being "what's fresh"
> months ago — §2 replaces it. The June→September span in §1–§2 is reconstructed from commit history and the
> current source tree; it is *not* re-verified feature by feature. Treat §0 and §4 as the checked parts.

---

## 0 — This session (2026-09-05): SS Grade 316 sheets

Small, self-contained data change. Already live on `main` — commit `4be3dc6`, migration `071_ss_grade_316_category.sql`.

- `SS Sheet` had grade buckets for **304 / 430 / 441 / J1** but **not 316**, so the two Grade-316 sheets sat
  loose under the parent and showed as plain "SS Sheet" in the inventory list — unfilterable by grade.
- Created **`SS Sheet > SS Grade 316`** (Trade) and refiled **RM-218** (1.2mm) and **RM-219** (1mm) into it.
  Stock and costs untouched (RM-219 still 6 pcs @ ₹11,800).
- Created **RM-222 — `2500x1250x1.5mm/SS/Grade 316`** · raw_material · Pieces · Trade (inherited) · stock 0.
- The owner also asked for a 1.2mm sheet: that **already exists as RM-218**. Active item names are unique
  (`items_active_name_unique_idx`), so nothing new was created for it — worth re-confirming they didn't mean
  a *different* 1.2mm sheet (other width, or a finish variant).
- **Deliberately left blank on RM-222: suppliers and cost price.** Both sibling 316 sheets list
  *Indinox Stainless & Alloys LLP*, but purchasing data is the owner's call. **Still needs filling in.**

`item_change_log` rows are written by hand inside the migration, so the create + the two category moves appear
on `/inventory/changes` like any in-app edit. Follow that pattern for future SQL-side item edits.

---

## 1 — What the app is now (current sidebar IA)

Four nav groups (`src/components/layout/sidebar.tsx`), collapsed to a hover-expanding icon rail:

| Group | Pages |
|---|---|
| **Inventory** | Inventory · Cabin Inventory · Sub-assemblies · Daily Changes |
| **Production** | Programs · Program Runs · Child Parts |
| **Orders** | Job Orders · Status Alerts · CRM Payments · Cabin Jobs · BOM (old) |
| **Planning** | Make MRP · Trade MRP · Cabin MRP · Job Shortfall · Demand Rules · Procurement |

Not in the nav but live: `/packing-list-r1` (+ `/template`, `/[jobId]`), `/jobs/[id]/packing-list`,
`/jobs/gad-alerts`, `/inventory/atlas`, `/inventory/health`, `/mrp/plan`, `/mrp/make-plan`, `/mrp/weekly`,
`/mrp/trade/buy`, `/mrp/cabin/programs`, `/mrp/cabin/weekly`, `/cabin-programs`, `/settings`,
`/print/packing-list/[jobId]`.

Badges on the rail are live counts: **red** = GAD drawing drift (Job Orders), **amber** = open status alerts,
**blinking emerald** = unacknowledged CRM payment events.

Server actions have grown to ~50 domain files under `src/lib/actions/` — one per domain, still no monolith.

## 2 — Biggest shift since the June handoff: **Packing List R1 is the BOM**

Migration `058_r1_is_the_bom_foundation.sql` (cutover ~2026-07-03) made **Packing List R1 the primary editor**
for what a job needs. It **mirrors into `job_bom_lines`**, which stays the demand/dispatch backbone, so every
downstream consumer (MRP, weekly, dispatch, cabin, procurement) reads the same rows as before. Sync logic:
**`src/lib/actions/r1-bom-sync.ts`**.

- `job_bom_lines.source` = `'r1'` for mirrored lines, `NULL` for legacy lines from the old BOM form (reviewed
  and crossed off via R1's **Unmapped Items** panel; removals snapshot into `removed_bom_lines` so they're
  reversible).
- `packing_r1_lists.audited_at` / `audited_by` record who marked a list final.
- **`/bom` is now "BOM (old)"** — a read-only archive of the pre-cutover Job Order BOMs, kept as a transition
  reference. The sidebar comment says to remove it once the team stops needing it.

Other significant arrivals in that window (from commit subjects): Ricardo **+ LT Elevator CRM** live financials
and payment notifications · **saved job sets** (e.g. "Urgent") usable across MRP · job-scope pickers on Make /
Trade / Cabin MRP · **Procurement** (POs, GST landed cost, PO photo/vision reading) · **Demand Rules** ·
cabin jobs mark-ready consuming stock + dispatch-time Cabin Glass movement · **Child Parts** · Inventory
**Atlas** and **Health** · assembly runs · run-sheet photo reading · line-level dispatch phases · R1 print tab.

The June headline (Auto Part List, rules-based, cached drawing reads) still exists at
`/jobs/[id]/packing-list`, with the brain in `src/lib/partlist/` and the pipeline in `scripts/partlist-brain/`.
Its **locked design decisions still stand**: blend per line · on-demand Generate · replace-from-scratch with
confirm · **cached** drawing read (never inline vision — that caused a serverless timeout) · **rules, not
similar-jobs** · non-inventory lines allowed.

## 3 — Stack / commands / tools

- Next.js 15.5 App Router · React 19 · TS · Tailwind 4 · Supabase Postgres (`qwzisnmueuqnzzokkpmn`, ap-south-1).
- **`npx tsc --noEmit` is the gate.** `npm run build` **cannot run locally** — see §5.
- Supabase MCP (`execute_sql` / `apply_migration` / `get_logs`). Always preview with a count before any write
  touching more than one row.
- Branch rubric is in `CLAUDE.md` §0. Typos, small fixes and small additions on `main`; risky schema changes,
  >10-file refactors and speculative work on a branch + PR. **Tell the owner when you start a branch.**
- After SQL run outside the app, **push a commit** to wipe the Netlify build-tier cache; otherwise cached
  reads stay stale for the 60s TTL.

## 4 — Open / carried forward (each re-verified 2026-09-05)

- **RM-222 has no supplier and no cost price** (§0). Owner needs to supply both.
- **`saveBomSection` still nulls dispatch links.** `src/lib/actions/jobs.ts` still does delete-then-reinsert
  over the affected categories, so `job_dispatch_lines.job_bom_line_id` (FK `ON DELETE SET NULL`) is cleared
  when a section is re-saved. A `relinkOrphanedDispatchLines` helper was drafted in a much earlier session and
  **still does not exist anywhere in `src/` or `scripts/`** — grep confirms. Carried forward since ~June.
  The R1 cutover (§2) reduced how often the old BOM form is the editor, but did not fix this path.
- **Part List flywheel still not built.** `scripts/partlist-brain/` has `mine-quantities.js`, `mine-sizing.js`
  and `remine-with-features.js`, but **no `mine-from-ready.js`** — nothing re-mines rules from Part Lists the
  engineers mark Ready, so accuracy doesn't compound over time. The owner explicitly asked for this.
- **`ANTHROPIC_API_KEY` on Netlify** was an open question in June. Six surfaces now depend on it
  (`spec-vision`, `run-sheet-vision`, `po-vision`, `cabin-autofill`, `demand-rules`, `partlist-client`), and
  the 2026-08-28 run-sheet fix implies it is working — but **this was not directly verified** this session.
- ~7 unscoped Part List particulars still have no category mapping (engineer links or marks non-stock at review).

## 5 — Gotchas (recurring)

- **`npm run build` fails locally — the drive, not the repo.** `H:` is **FAT32 on a removable disk**; webpack's
  resolver gets `EISDIR` from `readlink` where it expects `EINVAL` and aborts. `npm run dev` and
  `npx tsc --noEmit` work fine, and Netlify builds `main` on Linux, so nothing real is broken. Don't debug it
  as a dependency problem. For a genuine local production build, copy the project to an NTFS drive first.
  (`--turbopack` gets past the resolver but then trips a Turbopack-only check on a type-only re-export in
  `src/lib/actions/bom-predict.ts` — also not a real bug.)
- **Shared DB**: SQL runs against the live site immediately. There is no staging copy.
- **Generate must stay serverless-fast** — never call inline Claude vision inside it. Use the cached
  `job_drawing_extractions` read.
- **PostgREST caps a select at 1000 rows** — page with `.range()` on anything that can exceed it.
- **`unstable_cache` silently drops entries over ~2MB** — the read then re-runs on every request and the page
  feels broken-slow. Project to the fields the consumer actually needs.
- **Every route needs a `loading.tsx`**, or soft navigation paints nothing and reads as a freeze.
- Staging has many untracked scratch files (`scripts/_*`, `_*.png`, `*.xlsx`) — **`git add` explicit paths,
  never `-A`**.
- CRLF warnings on Windows: ignore.
- Co-author trailer: **`Claude Opus 5 <noreply@anthropic.com>`**.

---
**Next obvious step:** get supplier + cost onto RM-222, then pick up the two long-carried items — the
`saveBomSection` dispatch-relink fix and the Part List Ready→rules flywheel.
