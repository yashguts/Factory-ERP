# Handoff — Programs catalog & CNC Standard Programs import

> Session handoff (2026-05-29). The Programs (operations) catalog was built and
> the CNC Standard Programs were bulk-imported. Everything is **live on `main`**
> (Netlify). The owner's team begins **auditing the imported programs**. Full
> running detail lives in the agent memory files (see end); this doc is the
> durable summary in-repo. Complements `docs/production-visibility-roadmap.md`.

## Current state (live)
- **910 operation rows = 614 base programs** (75 have material/finish variants:
  MS / SS / designer) **+ 2** programs the owner entered manually.
- All labelled **"Standard Programs"** (`operations.program_label`).
- Raw-sheet **inputs ~88% mapped**; **~1,009 outputs matched** to inventory
  SKUs; the remainder are **"to-be-filled"** lines (item not chosen yet, but the
  original name + quantity are captured and searchable).
- The import is **reversible**: every imported row is tagged
  `import_source = 'cnc_std_v2'` →
  `DELETE FROM operations WHERE import_source='cnc_std_v2'` (cascades lines).
- ⚠️ **Do not bulk re-import once the team has started auditing** — it would
  overwrite their hand-fixes. A future re-import must first preserve
  audited/edited rows (e.g. skip families/rows where `audited_at` is set or the
  outputs were changed).

## What this feature does
- **`/programs`** — catalog of CNC programs (the "operation" = a nest: one run
  consumes a raw sheet and produces many parts). Two cutting machines
  (**Laser Cutting**, **Punching**) + an **Assembly** type (cut parts + bought
  parts → sub-assembly).
- A program has **inputs** (raw sheet) and **outputs** (parts), each line either
  pointing at an inventory item or "to-be-filled".
- **Material/finish families:** a thin (≤2mm) panel program fans out into
  variants (MS, SS, designer finishes) — each its own row with its own sheet +
  output SKUs — grouped under one `family_key` in the UI. This is deliberate:
  future MRP keys "need 50× SS Rose Gold panel" → the specific program variant.
- **Item modal** shows "Produced by / Consumed by" chips linking to programs.

## Curation tools (for the audit)
On `/programs`: per-row **audit checkbox**, header **progress count**,
**Pending / Audited filter**, **quick-edit** pencil (fill to-be-filled items by
search + fix quantities in place), **family grouping** (collapse variants), and
**search that looks inside programs** (matches output/input item names + the
to-be-filled labels, not just code/name). The program **detail page** also has a
**Mark audited / Audited** toggle.

**Team workflow:** Pending filter → open / quick-edit → fill each `Fill: <name>`
line by searching inventory + fix quantities → **Mark audited**.

## Schema (migrations 010–013, all applied)
- `010` operations + operation_inputs + operation_outputs (+ `program-sketches`
  storage bucket, mirrors `gad-drawings`).
- `011` `operations.family_key`, `material_label`, `import_source`;
  `operation_inputs/outputs.item_id` made **nullable** + `label` text
  (to-be-filled lines).
- `012` `operations.audited_at`, `audited_by`.
- `013` `operations.program_label` (all backfilled to "Standard Programs").

## Re-running the import (if ever needed)
Scripts preserved in `scripts/`:
- `cnc-parse-std-programs.py` — parses `CNC Standard Programs.xlsx` ("Std
  Program" sheet) → `std_programs.json` (programs, colors, outputs, sheet).
- `cnc-import.js` — improved matcher (abbrev expansion, material-aware,
  STD-preference) + **data-driven material/finish fan-out** (sibling SKUs via
  name-stem matching) + inserter. DRY RUN by default; `--commit` deletes the
  prior tagged import and re-inserts.

⚠️ These scripts use **absolute `C:\…\Temp\` paths** and read the Supabase anon
key from `.env.local`. Adjust paths before re-running. Decode of colors/machine
rules and the matcher logic are documented in the memory file
`project_cnc_std_programs_import.md`.

## What's next
- **Optional aids:** a `/programs/unmatched` bulk-fill screen (mirror
  `/jobs/unmatched`); true typo-tolerant search.
- Re-tag the 2 manual programs (435, 126) from legacy `cnc_cutting` →
  `cnc_punch`.
- **Phase 1+ (roadmap):** operation **runs** → post inventory transactions →
  job production plans → shop-floor kanban → MRP. **Before Phase 1, ask the
  owner the open design questions** in `docs/production-visibility-roadmap.md`
  (manual-fab modelling, surplus parts, reservation semantics, run-logging UX).

## Gotchas / conventions
- **OneDrive caveat:** local dev/preview is unreliable here (Fast-Refresh loop,
  hanging screenshots). Verify UI on the **live Netlify site**;
  `npx tsc --noEmit` + `npm run build` are the reliable local checks.
- **Uploads** (GAD drawings, program sketches) go through server actions —
  `next.config.ts` sets `serverActions.bodySizeLimit: "50mb"` (default 1MB was
  silently rejecting real drawings). Any new upload feature is covered.
- Commit trailer: `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.
- Small/additive → `main`; the owner reviews the deployed app; the owner asked
  to **confirm before pushing** during active iteration.

## Memory files (auto-load next session)
`project_cnc_std_programs_import.md`, `project_production_visibility.md`,
`project_factory_erp.md`, `env_preview_caveat.md`, `ui_rules.md`.
