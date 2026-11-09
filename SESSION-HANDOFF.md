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
> **The project moved from `H:` to `E:` to `D:\USB DRIVE\Anthropic Access\ERPFACTORY`** (a USB copy, as of
> 2026-11-08). Paths in older docs saying `H:\…` or `E:\…` mean that. The memory folder follows the path, so
> it is now `D--USB-DRIVE-Anthropic-Access-ERPFACTORY` and **starts empty** — the `E:` memory index is gone.
> The companion repo moved too: `D:\USB DRIVE\Anthropic Access\RAPLH400 BOM`.
>
> **Node.js is not installed on the machine holding this USB copy** (checked 2026-11-08: no `node`/`npx` on
> PATH, none under Program Files / LOCALAPPDATA / APPDATA / ProgramData, no `HKLM:\SOFTWARE\Node.js`). So
> `npm run dev`, `npx tsc --noEmit` and the workbook rebuild cannot run there at all. Python 3 **is**
> available (no `openpyxl`). Plan verification accordingly, or work from a machine with node.

---

## 0d — Update 2026-11-09: counterweight-free lifts can build a part list

**The report.** The floor said "ralph bom could not read the cwt position frequently, especially in
hydraulic". It was not a reading failure. **R1000 and hydraulic lifts have no counterweight at all**, so
the drawing read correctly returns nothing — its own rationales say "Hydraulic lift - no counterweight
drawn" at high confidence. Focused reads, by drive: BELT 15/15 found, HOME 11/11, HYD 1/6, R1000 0/33.
Whenever a counterweight exists the read gets it; it is empty only when there isn't one.

**The real problem.** C15 blocks the whole part list, so those jobs could never produce one. On this page
that means the **hydraulic** jobs — exactly what the floor said — because `getFactoryStructureJobs` drops
R1000 from the picker on purpose (8c9f958: an R1000's structure is its own, not a RALPH shaft). The 33
null R1000 reads come from the batch deep-scan, which covers every Factory-made job, not from this page.
Worse, it failed silently: `applyRalph` pushed no warning for a null `cwt`, so the toast said "Refilled N
inputs", the dropdown sat on "— pick —", the table was replaced by an empty state and Save/Export/Print
greyed out.

**What C15 actually decides** is which face carries the 3 mm bracket channel and gets sheet instead of
glass. On a counterweight-free lift that is the **car-rail face**, on the same wall, needing the same
brackets — and it IS on every drawing. The model was already reading it, into free-text `notes`
("car rails at the rear DBG 600 with jack between (no counterweight)", RNLHYD-0125).

**Changes** (all on `main`, commit below):
- `ralph400-autofill.ts` — new **`rail_side`** field in the vision schema + prompt (report it on every
  drawing, counterweight or not); `cwt` now falls back `cwt_side ?? rail_side`, with a warning naming
  where it came from. A single authoritative warning fires whenever the face ends up unset. The free
  tier now also maps `left/lhs/right/rhs` (it only handled "rear"); a bare "side" is still ambiguous and
  left blank on purpose.
- **SCHEMA_VERSION stays `ralph400_v1`** deliberately — `partlist-generate.ts` (×2) and `spec-vision.ts`
  identify rich reads as `.neq("schema_version", "ralph400_v1")`, so a v2 would leak RALPH rows into the
  Part List's reads. The shape just gained an optional field. Rows stored before today have no
  `rail_side`, so the AI re-read is now allowed when a stored read left the face blank
  (`if ((!haveRalphRead || !("cwt" in values)) && allowVision)`) instead of returning the same dead end.
- `part-list.ts` — `hasNoCounterweight(driveType)` (HYD | R1000, exported); the blocking message now
  tells every counterweight-free drive what to pick and where to find it.
- UI relabelled **"CWT / rail side"** (input row + stat tile; "Counterweight / rail side" on the export,
  which has no width limit). Only the label and copy changed — `OPTIONS.cwt` is still BACK/RIGHT/LEFT
  and no arithmetic moved, so the owner's sheet is unaffected.
- `scripts/drawing-deepscan/INSTRUCTIONS.md` — the batch pipeline now captures `rail_side` too, so new
  scans stop reproducing the gap. `post.js` still writes `ralph400_v1` on purpose: bumping it would make
  `check.js` mark all 83 jobs incomplete and force a full rescan.

**Verified live** (2026-11-09, deploys of `b7b2c25` + `e032b38`). On **RNLHYD-0127** (ARTLAB, HYD, 4
stops) the page opened blocked with the new message, "Read drawing (AI)" re-read the GA and filled
**CWT / rail side = BACK**, and the part list built — **74 lines, 2,436 pieces**, cladding BACK · FRONT,
glass LEFT · RIGHT. Nothing was saved. The stored row proves the mechanism: `cwt_side` null ("no
counterweight shown", high) and `rail_side` "BACK" ("jack/rail assembly and DBG 700 at the rear wall",
medium). Its 2026-09-29 row had already written "car rails and jack on the rear wall" into the *cwt
rationale* — the answer was on the drawing all along, just not in a field.

**Backfilled the same day.** Ten picker-eligible jobs had no face. Three were re-read through the app
and now build: **RNLHYD-0127** (HYD, rail BACK, 74 lines), **RNLHYD-0143** (HYD, rail BACK, 68 lines),
**RNLCHA-0027** (BELT, 66 lines). RNLCHA-0027 is the useful control — it has a counterweight, and
`cwt_side` and `rail_side` both came back BACK, which is the agreement the fallback assumes. Five of the
rest (RNLAP-0065, RNLHYD-0125, RNLHYD-0144, RNLJAI-0010, RNLKOL-0026) are **fully dispatched**, so the
picker hides them and they need no part list. The last two, **RNLAHM-0037** and **RNLMALS-009** (both
stage `new`, in the picker), have **no GA drawing uploaded** — nothing to read, so they still block.
That is now the only reason a live job blocks on the face.

**Not done / to watch.** Other jobs scanned before today have no `rail_side` stored — each needs one
click of **Read drawing (AI)** (which now re-reads instead of short-circuiting). `rail_side` confidence
is "medium" where the counterweight read was "high", so the value is worth a glance before saving.
No `npx tsc --noEmit` was possible here (no node, see the banner above) — the Netlify build was the gate
and both deploys went green.

---

## 0c — Update 2026-11-08: `/ralph400` gains the owner's "CWT & FRONT GLASS" option

The owner sent `RALPH 400 R1000 BOM.xlsx`, sheet **"RALPH BOM"** (a 5-stop job, BLR 51). Again their own
copy, so it still lacks the 2026-10-03 Rules Book numbers (glass −97/+38, cladding −142, covers +9/+38,
no −35 on S8, 12F hex, per-part fasteners) and still has the three defects §4 lists. Only the structural
changes were ported.

- **NEW INPUT `C16` "CWT & FRONT GLASS" (YES/NO)** — the sheet labels the block
  "CWT & FRONT GLASS DIMENSION IF ASKED FOR", so it is a customer option, **default NO**. On YES the shaft
  is fully glazed: the four extension cladding rows (17-20) and the three console cladding rows (70-72)
  drop out, and the new block (rows 95-107) adds
  - **CWT face, module level:** one pane `2450/2 − 76 − 95.5` and **F** panes `(2450 − 304)/2` — both
    constants, qty 1 and C8 (not the 2F−1 a glazed face uses). The glazed faces keep their 1098/1128 panes.
  - **CWT face, per level:** `extension − 152`. That face carries the 3 mm bracket channel, so its opening
    is 52 mm shorter than an ordinary glazed face.
  - **FRONT, per level:** `extension − 140` (72.5 + 67.5). **No front module pane** — the door is at that
    level. This is the one new figure the owner already wrote with the +38 allowance, and it matches the
    app exactly.
  - `U17:V20` carry **no** C16 condition, so the **overhead stays sheet-clad on all four faces** even on a
    glazed job (the new block has no overhead row). Kept; flagged below.
- **Front extension cladding is `C4 − 200` again** (width), undoing v2's `C5 − 200` from 2026-10-09
  (`7eca14a`). The front spans the width and the front *overhead* panel always read `C4 − 200`, so level
  and overhead now agree. This realigns with the one saved list (RNLHYD-0147, front 1430).
- **The owner adopted three of this app's fixes** in their own copy: `P19/R19/T19` → `C4 − 200` (R19/T19
  had the blank cell `E5`), `M19` → `M8` (was `M10`), and `T20` is a real formula (was `G8`/`G5`). The
  console cladding rows are now gated to the counterweight face (`F70:F72`, `H70:H72`, `I70` cleared) —
  **AUDIT H76/I76 is settled**, clean mode was right.
- **Deliberate 3 mm difference:** the new CWT rows use `+35`, the new FRONT rows `+38`. The owner confirmed
  +38 on 2026-10-03 and this app applies it throughout, so the CWT panes come out 3 mm larger here than in
  their copy. Not split into two allowances. **Ask the owner.**
- **Drift normalised, not copied:** the new block gives *every* row the **counterweight** face's span
  (`G95`…), so on a LEFT/RIGHT counterweight the FRONT glass would be cut to the depth. Each face keeps its
  own span here. **Ask the owner.** (Invisible on this job: CWT=BACK, so both read `C4 − 200`.)
- Sheet **"TRIAL"** in that workbook is a separate experiment (985 × 985 shaft, "COLUMN EXTN", a 60 mm pit
  rule). **Not modelled** — the owner asked only about "RALPH BOM".
- Touched: `model.ts` (input, 4 constants, `fullGlass`, panel + console rows), `part-list.ts` (decimal pane
  sizes, the new check, blurbs), `ralph400-client.tsx` (the dropdown, export row), `build_workbook.py`.
  Catalog unchanged — every new row is `R4-GL-6`. Old saved lists and old `localStorage` read as NO.
- **Autofill was NOT extended.** `ralph400-autofill.ts` has no field for this; it is a sales option, not
  something a GA drawing states. It stays a manual pick.

> **How this was verified, and the one gap left.** This session ran on the USB copy at
> `D:\USB DRIVE\Anthropic Access\ERPFACTORY` on a machine with **no Node.js installed at all** (no
> `node`/`npx` anywhere; no registry key), so `npx tsc --noEmit` could not be run locally.
>
> **Types and lint are nonetheless verified: Netlify built the commit clean.** Deploy
> `6af053563d869c2ebbc38781`, `commit_ref` `10e994c`, state `ready`, published 2026-11-08 10:49 UTC. Its
> `npm run build` runs `next build`, and `next.config.ts` sets neither `typescript.ignoreBuildErrors` nor
> `eslint.ignoreDuringBuilds`, so full type-checking and eslint both passed. **On this machine, pushing is
> the only way to run the gate — and a type error simply fails the build and leaves the previous deploy
> published, so the live site is not at risk.**
>
> Arithmetic was checked separately: the whole glazed-job calculation was re-derived in a throwaway Python
> script and matched against the R1000 sheet's own computed cells. Every value agrees, with only the
> documented deltas (+3 allowance, −23 overhead, +35 on the 4th-floor extension). The front-glass rows match
> **exactly**, which is what confirms the −140 reading. `build_workbook.py` is `py_compile` clean.
>
> **STILL OPEN: the clean workbook was not rebuilt** (`openpyxl` missing, and `export-catalog.ts` needs
> node), so `build_workbook.py` carries the new rule but no generated workbook has been checked against
> `buildPartList()`. **First job on a machine with node: rebuild it and re-run that comparison.**

---

## 0b — Update 2026-10-09: `/ralph400` follows the owner's workbook v1

The owner sent `RALPH 400 BOM_v1.xlsx` — again a Google Sheets export of **their own copy** (R1 + their
edits), so it does not carry the 2026-10-03 Rules Book rules (glass +38, ext − 97 / − 142, covers +9 / +38…).
Those stay; only the owner's R1 → v1 edits were applied, here and in `scripts/ralph400/build_workbook.py`:

- **Base drop 67.5 → 95.5.** v1 changed `U8` to `C7+95.5-2450-30` and kept `K8 = C9-2450`; `BASE_DROP = 95.5`
  reproduces both exactly (GND extension 28 shorter, overhead extension 28 longer, posts still pit floor →
  30 below the top). The overhead cladding keeps its height (v1 left `U17` alone): its deduction is now
  95.5 + 135 = 230.5, and `MIN_OVERHEAD` stays 2615. GND floor minimum is now 2592 (deep pit) / 2762 − P.
- **Row 20: the front is sheet-clad on every job** (was CWT=BACK only). Same day the owner sent **v2**, whose
  only real change is row 20: `K20 = IF(C8>=2, K8-142)`, `L20 = IF(C8>=2, C5-200)`, … `P20 = IF(C8>=3, C5-200)`.
  So the front extension width is now **C5 − 200 (depth)**, not W − 200 (overhead front stays C4 − 200, `V20`);
  the − 142 height was already the rule. The `C8>=n` gates are looser than the page's own floor gate (1ST
  needs 3 stops here, the sheet says 2), so they change nothing. `T20` reads `IF(G8>=3, G5-200)` — a
  copy-paste slip (empty cells); the 4TH front uses C5 − 200 like `R20`.
- **One door set per landing**, hand from the opening: R, L, or C (`… CO`); new codes `R4-DLP-C`,
  `R4-DPC-C`, `R4-LNT-C`. Fastener counts drop by one door set.
- **New lines:** `R4-BDW` dead weight channel holding bracket (F, CO openings only, v1 `H23`); `R4-CPT` pit
  channels F&B ×2 + L&R ×2 when the pit piece is over 250 (pit > 345.5), right after the PIT posts, **no
  length** (v1 gives none).
- v1 has a dead weight channel in both row 22 and row 93; listed **once** (F) — **ask the owner**.
- **The overhead ring section is removed** (later the same day, on the owner's instruction — item 3 of their
  WhatsApp list): the seven 2nd-last channel/cover rows are gone from the model, the "Overhead ring" section
  from the page, codes `R4-CRG-15`, `R4-CRG-30B`, `R4-VRG-12` from the catalog and the workbook builder. Per
  job that is 6 fewer lines, 16 fewer M8 bolts/rivnuts and 64 fewer M5 screws/rivnuts; nothing else moved
  (720-job sweep; workbook vs page in Excel, 62 jobs / 4,798 lines, 0 diffs).
- From the owner's WhatsApp list but **not** done: rope roller bracket and 170 channels at 3 mm (not in
  v1/v2, never confirmed).
- **Verified:** 2,160-job before/after sweep, every difference in an intended category; the rebuilt clean
  workbook, evaluated in real Excel over 62 jobs, matches `buildPartList()` on all 5,170 lines (and the old
  workbook matches the old code, 0 diffs, so the check is live). `next build` passes locally on `D:` (NTFS).

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
