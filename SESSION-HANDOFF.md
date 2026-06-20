# Session Handoff — 2026-06-20 (Factory ERP)

Live: **https://lt-factory-erp.netlify.app** · `main` · auto-deploys ~1 min on push (hard-refresh tabs).
Owner is a **non-developer** — reviews the deployed app, not code. **Read `CLAUDE.md`** (deep reference) and
the auto-memory index (`~/.claude/.../memory/MEMORY.md`); this file is the quick orientation + what's fresh.

This session built one big feature end-to-end: the **Auto Part List generator**. Everything below is the state of it.

---

## 0 — Headline: Auto Part List (the per-job "Part List" tab) — LIVE

**What it does.** On a job's **Part List** tab (`/jobs/[id]/packing-list`), the engineer clicks **Generate**
and the system drafts the full Mechanical Part List from **rules + the job's BOM + the GA drawing**, each line
linked to a real inventory item (or marked non-stock). It's a **watertight checklist**: the whole universe of
~501 particulars is shown in order (not-applicable ones greyed, click to add), every active line must be
**✓ checked**, every part-group **confirmed**, every BOM item placed, before it can be **Marked Ready**.

**How it generates (RULES-ONLY — important):**
- **Presence**: the door/drive **template skeleton** (`templates.json`) + a door-independent core.
- **Spec/size**: **band-conditioned mined sizing** (`sizing-bands.json` — most-common size per part per
  capacity band) + the drawing's door-opening width; falls back to each particular's standard spec.
- **Quantity**: mined formulas (`quantity-models.json`: header=stops+1, sill=stops, …) and **travel-scaled**
  models (`travel-models.json`) when the drawing gives travel.
- **Inventory link**: `resolve.ts` matches (category + size). Category corrections + genuine non-inventory
  flags come from `partlist-overrides.json` (research-grounded). **BOM is read-only** and blended on top
  (BOM item wins; conflicts flagged).
- The old **"similar jobs" (k-NN neighbour copy) was removed** — it produced wrong/bloated lists. Evidence
  it was right to drop: `scripts/partlist-brain/compare-rules-vs-neighbor.js` (band-mode ties/beats neighbour
  on specs, e.g. counter rail 23%→90%; rules win on quantities 79% vs 62%).

**Drawing reads are cached.** On drawing upload, `ensureDrawingRead` fires (background) and stores the vision
read in `job_drawing_extractions`; Generate uses the **cached** read (NEVER inline vision — that caused a
serverless-timeout "unexpected response" bug). All 151 drawing-jobs are pre-cached. Needs `ANTHROPIC_API_KEY`
in Netlify for *new* reads (graceful spec+BOM fallback if absent). A "Read drawing" button is the catch-up.

**Re-upload = spec change**: replacing a drawing wipes the cached read + the existing Part List, then re-reads
(panel confirms first).

### Files
- Runtime brain: `src/lib/partlist/` — `predict.ts` (rules), `resolve.ts` (inventory match), `types.ts`,
  + committed JSON artifacts (`sizing-bands`, `quantity-models`, `travel-models`, `templates`,
  `section-groups`, `partlist-overrides`; `rules.json` is legacy, superseded by sizing-bands).
- Server actions: `src/lib/actions/partlist.ts` (getPartList, savePartList, **savePartListSection**,
  markPartListReady, reopenPartList, searchPartItems, **resetPartListForNewDrawing**) and
  `partlist-generate.ts` (`generatePartListDraft` — the blend engine). `spec-vision.ts` has
  `extractDrawingData` + `ensureDrawingRead`.
- UI: `src/components/jobs/partlist-client.tsx` (the checklist) + the route `page.tsx`.
  `gad-drawing-panel.tsx` auto-reads on upload.
- DB: `packing_lists` / `packing_list_lines` (migrations 039 + **040 watertight** + **041 non_inventory**).
- Offline pipeline (`scripts/partlist-brain/`, run in order): `parse-corpus` → `mine-quantities` →
  `mine-sizing` → `extract-rules` → `gen-compact-corpus` (copies artifacts to `src/lib/partlist/`).
  Research/aliases: `dump-research-inputs` → (Workflow) → `build-overrides`. Drawing backfill:
  `dl-pending-drawings` → (Workflow) → `cache-extractions`. Evidence: `compare-rules-vs-neighbor`,
  `backtest`. Merge-time: `wipe-old-partlists`. Full write-up: `scripts/partlist-brain/ACCURACY-REPORT.md`
  + memory `project_auto_partlist.md`.

### Locked design decisions (owner)
Blend per line (no single backbone) · on-demand Generate · replace-from-scratch with confirm · cached drawing
read · **RULES not similar-jobs** · non-inventory lines allowed (engineer marks "non-stock"; not every line
needs a SKU).

---

## 1 — Stack / commands / tools (condensed; see CLAUDE.md)
- Next.js 15.5 App Router · React 19 · TS · Tailwind 4. Supabase Postgres (`qwzisnmueuqnzzokkpmn`, ap-south-1).
- `npx tsc --noEmit` (the gate) · `rm -rf .next && npm run build` (OneDrive corrupts `.next`; clear first).
- Supabase MCP (`execute_sql`/`apply_migration`/`get_logs`); confirm >1-row writes with a count first.
- Preview MCP for verifying UI — but flaky here (see gotchas); prefer the **prod** launch config over dev.

## 2 — Open / carried forward
- **Verify on the live deploy** (couldn't fully click-test locally — preview bounces to `/jobs`): Save,
  Mark Ready (gate), the **non-stock** toggle, **Save section**, and **re-upload reset**. Generate itself is
  verified (job 4732: 98 lines, counter rail 5X45X45, fish plate→non-stock, BOM 52/53).
- **Confirm `ANTHROPIC_API_KEY` is set in Netlify** (for reading newly-uploaded drawings).
- **Flywheel not built yet**: a `mine-from-ready.js` to re-mine rules (sizing/quantity/presence) from Part
  Lists the engineers mark **Ready**, so accuracy compounds over months. Owner explicitly wants this.
- ~7 unscoped particulars still have no category mapping (engineer links or marks non-stock at review).
- **Pre-existing, still undone** (from the prior handoff, unrelated to part list): `saveBomSection`
  (`lib/actions/jobs.ts`) delete+reinserts BOM lines, nulling dispatch→line FK links; a
  `relinkOrphanedDispatchLines` helper was drafted but never added. Grep confirms still missing.

## 3 — Gotchas (recurring)
- **OneDrive** corrupts `.next` and makes dev/preview flaky; the Preview tool intermittently bounces the tab
  to `/jobs` (re-`location.href` + poll fast to catch state). Prefer verifying on the deploy.
- **Shared DB**: SQL/wipes hit the live site immediately (the old part-list data was wiped at this merge).
- **Generate must stay serverless-fast** — never call inline Claude vision inside it (timeout). Use cached
  `job_drawing_extractions`; parallelise item fetches.
- Staging: many untracked scratch files (`scripts/_*`, `_*.png`, `*.xlsx`, `scripts/partlist-brain/_*`
  gitignored) — `git add` explicit paths, never `-A`.
- Co-author trailer: `Claude Opus 4.8 <noreply@anthropic.com>`.

---
**Next obvious step:** owner verifies the flow on the live job pages; then build the **Ready→rules flywheel**.
