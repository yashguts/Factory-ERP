# Session Handoff — 2026-09-23 (Factory ERP)

Live: **https://lt-factory-erp.netlify.app** · `main` · Netlify auto-deploys ~1 min on push (hard-refresh tabs).
Owner is a **non-developer** — reviews the deployed app, not code. **`CLAUDE.md` is the deep reference**;
this file is quick orientation + what's fresh. Also read the auto-memory index
(`~/.claude/projects/E--Anthropic-Access-ERPFACTORY/memory/MEMORY.md`).

> **Read this first.** §0 is this session and is fully verified. §1–§2 describe the June→September span and
> are reconstructed from commit history and the source tree; they are *not* re-verified feature by feature.
> Treat §0 and §4 as the checked parts. The previous §0 (SS Grade 316 sheets, `4be3dc6`, 2026-09-05) shipped
> and is done apart from the RM-222 supplier/cost gap still listed in §4.
>
> **The project moved from `H:` to `E:`.** Paths in older docs that say `H:\Anthropic Access\ERPFACTORY`
> mean `E:\…` now; the memory folder likewise moved to `E--Anthropic-Access-ERPFACTORY`.

---

## 0a — Update 2026-09-29: `/ralph400` follows the owner's workbook revision R1

The owner sent a revised workbook, `RALPH 400 BOM _ R1.xlsx`. It is a Google Sheets export of **their own
copy of the original**, so it carried none of the workbook fixes; RALPH400_BOM merged it the other way (R1 as
the base, fixes re-applied) and this commit ports the result. Full record: RALPH400_BOM's README ("Owner
revision R1") and `docs/HANDOFF-2026-09-29.md` in that repo.

- **What the page gained:** 7 new channel rows (every channel with a sheet cover now has its own
  `COVER (1.2MM)` row), every cover length = channel length **+40**, two fixing plates (`122` flat 2, `124`
  = 6F−2), `SHEET COVER` → `SHEET CLADDING`, door opening now carries the door type (`AT 700 R`, `600 CO`, …).
  The owner fixed the glass drift the audit flagged, and the `+35/+30` cover-offset question is settled.
- **Two defects new in R1, fixed in the workbook and mirrored here:** `135 BACK` quantity gave `#VALUE!` for
  CWT=BACK (`-1` written outside an `IF` that returns `"NO"`), and `G30` tested the empty cell `C20`.
- **Source audit** now asks three new owner questions (`I26/I29/I39`, `I29`, `G37`) in place of the two R1 closed.
- **Verified:** `model.ts` ≡ `web/model.js` over 13,200 scenarios / 4,072,480 values, 0 diffs; the workbook,
  evaluated in real Excel over 96 scenarios, matches the model on all 22,212 values.
- Saved inputs holding the old door opening (`700 R`) fall back to the default instead of blanking the select.

---

## 0 — This session (2026-09-23): RALPH 400 BOM moved into the ERP

New page **`/ralph400`** — sidebar **Orders → RALPH 400 BOM**, after "BOM (old)". Commits `562f22f` (port),
`c6c3d39`, `ac93ef7`, `29c9d59`, `c36b810`, `d05a6bd`. All on `main`, all deployed.

**What it is.** `RALPH400_BOM` is a **separate repo** at `E:\Anthropic Access\RAPLH400 BOM\`
(GitHub `KCodesbabinmaj/RALPH400_BOM`) whose README calls it "a sub program of Factory ERP": a shaft
bill-of-materials calculator for the RICARDO RALPH 400 lift. It existed as `RALPH 400 BOM.xlsx` plus a
standalone browser app run by hand from `python web/serve.py` on localhost:8765. It is now also a page in
this app. **Pure client-side arithmetic — it opens no Supabase connection and writes nothing**, so it cannot
affect jobs, items or MRP. Inputs persist to `localStorage` under `ralph400.inputs`.

Code: `src/lib/ralph400/model.ts` (the calculation), `src/components/ralph400/ralph400-client.tsx` (all UI),
`src/app/(app)/ralph400/` (route + `loading.tsx`).

**THREE COPIES OF THE SAME CALCULATION NOW EXIST** — the workbook, that repo's `web/model.js`, and this
repo's `model.ts`. **A change to one must go to all three.** This is the single most important fact about
this feature.

**How to verify a change to it** (none of this is committed; rebuild it in the scratchpad when needed):
1. *model vs model* — run both `web/model.js` and a `tsc`-compiled `model.ts` over a scenario sweep and diff
   every cell. Current baseline: 36,000 scenarios / 9,960,675 numeric cells / **0 diffs, 0 negatives**.
2. *app vs workbook* — evaluate the `.xlsx` formulas directly and compare against the model. Baseline: 768
   values across 3 counterweights × 4 shaft/floor configurations, **0 mismatches**.
   Note the evaluator must handle arithmetic *after* a call (`IF(...)-1`, as `H31` has) — a naive version
   mis-parsed that and wrongly reported the app as off by one.

**Two fixes to the workbook itself this session**, both mirrored into both models:
- **Glass quantity ignored the counterweight.** Length cells (column I) were gated on `C15`; quantity cells
  (column H) were not. Every counterweight position shipped a quantity for a face that does not exist — at 3
  floors with CWT=BACK, 1 + 5 pieces of back glass and 6 right-hand covers. `H53:H58`, `H61`, `H62` now carry
  their length cell's gate. **`H60` must stay ungated** — its length reads `GLASS`, meaning those pieces are
  glass rather than sheet, so its quantity is real.
- **The owner's own Excel edits were merged in** — two new channel rows, `H29` filled in, `I26` +30, `H37`
  text cleaned. See §4 for the trap that came with them.

**UI shape**: inputs down the left; Corner verticals / Glass panels / Sheet cladding / Horizontal channels /
2450 console module / Doors & fasteners / Source audit as separate cards. Two modes in the toolbar —
"Match workbook" reproduces the sheet including its drift, "Apply consistent geometry" applies the consistent
value to the cells in the Source audit table. Export is a multi-sheet `.xlsx` via `exportSheetsToXlsx`.

---

## 1 — What the app is now (current sidebar IA)

Four nav groups (`src/components/layout/sidebar.tsx`), collapsed to a hover-expanding icon rail:

| Group | Pages |
|---|---|
| **Inventory** | Inventory · Cabin Inventory · Sub-assemblies · Daily Changes |
| **Production** | Programs · Program Runs · Child Parts |
| **Orders** | Job Orders · Status Alerts · CRM Payments · Cabin Jobs · BOM (old) · RALPH 400 BOM |
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

## 4 — Open / carried forward

### From this session (RALPH 400)

- **The owner edits the WRONG WORKBOOK.** `RALPH 400 BOM.BACKUP-2026-09-22.xlsx` is the **pre-fix original
  and must never be edited**, but it is the file Excel has open, and this session's owner changes were typed
  into it. An exact three-way diff found **88 corrected cells missing from it** — taking it as the new working
  copy would have silently reverted every fix. The changes were merged the other way instead. **Check
  `ls -a | grep '^~\$'` in that repo to see which file Excel holds a lock on before trusting any formula.**
  That backup was restored to pristine on 2026-09-29. **And the owner also keeps their own Google Sheets
  copy** (R1 came from it) — so every revision they send will lack the fixes until that copy gets them.
- **Cover-row offsets: resolved 2026-09-29.** R1 made every cover length `+40`, retiring audit entry
  `I33 / I35`. Three new owner questions replace it in the Source audit table: with CWT=BACK, `I26`, `I29`
  and `I39` measure left/right channels against the width `C4` (R1 fixed that same pattern in glass);
  `I29` with CWT=LEFT is the only cover without `+40`; `G37` (`135 RIGHT`) has no BRACKET flag while its
  LEFT and BACK twins do. **Reproduced exactly as written** in "Match workbook" mode, pending the owner.
- **The glass-quantity defect is still open in steel.** Cell refs as of R1: **`H42`**
  (`HZ TOP CHANNEL FRONT`) holds a flat `1` with no counterweight test while `I42` reads `NO` for
  CWT=BACK; **`H41`** (`HZ TOP CHANNEL BACK`) *is* gated but returns the text `"BRACKET,  1"` where
  `I41` reads `NO`. Deliberately out of scope — different material, different order sheet. **Ask before
  widening.** (Separately, `H39` still holds `" 1"` with a leading space — text in a quantity column, audit
  entry `H39 / H41`.)
- **`Qty / level` is not in the Excel export.** The Corner verticals sheet has Description + the seven level
  columns only; the `1/EACH` column is screen-only.
- **The verification sweeps are not committed anywhere.** Both the model-vs-model and app-vs-workbook checks
  are throwaway scratchpad scripts. The RALPH400_BOM handoff has asked twice for them to be made permanent.

### Carried forward

- **RM-222 has no supplier and no cost price.** Owner needs to supply both.
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

- **`npm run build` fails locally — the drive, not the repo.** The project now sits on `E:` and it still
  fails the same way: webpack's resolver gets `EISDIR` from `readlink` on
  `node_modules/next/dist/pages/_app.js` (a perfectly normal file) where it expects `EINVAL`, and aborts.
  **Re-confirmed 2026-09-23 by stashing all work and building a pristine `main` — it fails identically there,
  so never attribute it to your own changes.** `npm run dev` and
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
- **A dead dev server looks exactly like an app bug.** The Next dev server died mid-session and kept serving
  HTML that never hydrated: every input was inert, and a dropdown "doing nothing" was chased as a real defect
  for several rounds. **Before believing a React page is unresponsive, check
  `Object.keys(el).some(k => k.startsWith('__react'))` and read the console for `ERR_CONNECTION_REFUSED`/500s.**
  Clearing `.next` and restarting fixed it.
- **Stop the dev server before `git merge` or `npm run build`** — it holds locks on `.next` and on new
  directories, and both fail with bare "Permission denied" / `EPERM` that look like something else.
- **Verify a deploy by its commit, not by page text.** A grep for a phrase that existed in *both* versions
  reported a fix as live when the old build was still published. Read `commit_ref` from the Netlify API (or
  the MCP `get-deploy-for-site`) and compare it to `git rev-parse HEAD`.
- CRLF warnings on Windows: ignore.
- Co-author trailer: **`Claude Opus 5 <noreply@anthropic.com>`**.

---
**Next obvious step:** get the owner to answer the three RALPH 400 audit questions (§4) and to import the
corrected workbook into their own sheet, so their next revision arrives with the fixes. Then supplier +
cost onto RM-222, and the two long-carried items: the `saveBomSection` dispatch-relink fix and the Part List
Ready→rules flywheel.
