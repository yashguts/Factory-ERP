# RALPH 400 BOM — workbook study and rebuild specification

> Generated 2026-09-30 from the owner's latest workbook ("RALPH 400 BOM  (1).xlsx", R1 lineage) by a multi-agent study: cell-by-cell diff vs src/lib/ralph400/model.ts, a formula-consistency audit, a Sheet1/placeholder study and an engineering sense check, then a synthesis and a completeness critique. Owner-facing summary: the "RALPH 400 External Structure — BOM Rules Book" doc. The critique (Appendix) found defects in this spec that MUST be applied before building.

# RALPH 400 BOM: study of the latest workbook and rebuild specification

**Source checked:**
- Workbook: `C:\Users\yash_\Downloads\RALPH 400 BOM  (1).xlsx`. A byte-identical copy is in the scratchpad as `ralph/latest.xlsx`.
- Older copy from 10 Sep, used to trace history: `C:\Users\yash_\Downloads\RALPH 400 BOM .xlsx`.
- Current ERP: `src/lib/ralph400/model.ts` (commit `91d2f75c`, "follow the owner's workbook revision R1") and `src/components/ralph400/ralph400-client.tsx`.

**How it was checked:**
- Two independent formula evaluators (Excel rules) reproduce all **211** Sheet2 formula values with 0 mismatches.
- The ERP model was run over 2,161 scenarios and compared cell by cell.
- Every point where the four studies disagreed was re-checked against the cell dump.
- Nothing in the project was modified.

---

## Summary for the owner

- **Your latest workbook is R1.** Every R1 change (the red-filled cells) is already in the ERP page, and no row is missing from the page. There are two kinds of new item:
  - Labels with no values: B18 "LEFT FACIA EXTERNAL", and B58:B64 (guide rails, brackets, clips, buffer stand, rope).
  - One formula that can never produce anything (G75).
- **The ERP had fixed about 20 of your workbook's cells, but none of those fixes reached your file.** Your workbook and the ERP have drifted apart. The ERP code even claims the fixes are "already applied in the workbook". For your file that is untrue.
- **What your workbook gets wrong today:**
  - Every BACK-counterweight job shows `#VALUE!` in H32/H33.
  - BACK jobs lose the back and front top-frame channels (I41/I42).
  - Back and front cladding widths are wrong at several levels, and two of them come out as −200 mm.
  - Floors that don't exist print negative cut lengths with quantity 1.
  - Glass and sheet quantities are listed for faces that have no glass or sheet: 24 extra pieces on BLR 94.
- **8 design questions need you** (§3B), and **18 one-word questions** are collected in §5.
- **Recommendation:** rebuild the page as **one grid that looks like Sheet2**, with the same rows, names, colours and columns.
  - Every correction applied.
  - Your workbook's own value shown on hover wherever we corrected a cell.
  - Proven equal to your formulas, apart from a written list of corrections, by an automatic test over about 10,000 scenarios.

---

## 1. What the workbook is

### 1.1 Sheets
| Sheet | What it is |
|---|---|
| **Sheet2** | The shaft BOM and cut list. Everything below is about this sheet unless it says otherwise. |
| **Sheet1** | A small old glass-size calculator. It is not linked to Sheet2 (see §4). |
| **Sheet3** | Empty. |

### 1.2 Inputs (Sheet2 B3:C17)
| Cell | Label in the sheet | Sample (BLR 94) | Used by |
|---|---|---|---|
| C3 | JOB NO | BLR 94 | label only |
| C4 | shaft width EXTERNAL | 1600 | every back/front width and channel |
| C5 | shaft depth EXTERNAL | 1550 | every left/right width and channel |
| C6 | pit height | 0 | pit stub I8:I11, GND extension K8:K11 |
| C7 | over head | 2860 | U8:U11, U17:U20 |
| C8 | No of floors | 4 | every quantity. This is the **number of landings**: 4 floors = 3 rises. |
| C9 | bottom floor to 1st floor height | 3720 | GND column (K) |
| C10 | 1st floor to 2nd floor height | 3295 | 1ST column (M) |
| C11 | 2nd floor to 3rd floor height | 3365 | 2ND column (O) |
| C12 | 3rd floor to 4rt floor height | 0 | 3RD column (Q) |
| C13 | 4rt floor to 5th floor height | 0 | 4RT column (S) |
| C15 | Counter weight location (magenta label) | LEFT | every glass/sheet/bracket choice. Dropdown: BACK, RIGHT, LEFT. |
| C16 | Door type | AT | **no formula reads it**. Dropdown: AT, ACO, SWING, MCD. |
| C17 | Door opening | AT 700 R | echoed in G74 only |
| B18 | LEFT FACIA EXTERNAL | (none) | new label, no value, nothing reads it |
| B58:B64 | MAIN GUIDE RAIL, CWT GUIDE RAIL, NO OF BRACKETS, GUIDE CLIP, GUIDE RAIL LENGTH, BUFFER STAND LENGTH, ROPE LENGTH | (none) | new labels, no values, nothing reads them |

The sample is only partly the real job RNLBLR-0094. The rises and overhead match its GA drawing; the pit, shaft size, counterweight side and door do not. Do not treat the stored sample as that job's truth.

### 1.3 How the shaft is built (read from the formulas)

**The stack**
- Each **landing** gets one fixed **2450 mm console module**: 4 corner verticals (D100–D103), a sill, and two bays per face.
- Each **rise** (floor-to-floor height) gets an **extension** of *rise − 2450* between one module and the next.
- The top landing's module sits in the overhead, under an **overhead extension**.
- A **pit stub** sits under the ground module.

**What each face gets, by counterweight side**
- **Counterweight face:** sheet cladding. Its channels are the 3 mm "BRACKET" versions, because this is where the rails fix.
- **The other two non-front faces:** 6 mm glass, with 1.2 mm covers on their channels.
- **Front:** the door face (door posts, lintel, sill).
- **Overhead:** sheet on all four faces.

| CWT | Left | Right | Back | Front extension (row 20) | Overhead (U17:V20) |
|---|---|---|---|---|---|
| LEFT | sheet + brackets | glass | glass | nothing (see B1) | sheet ×4 |
| RIGHT | glass | sheet + brackets | glass | nothing (see B1) | sheet ×4 |
| BACK | glass | glass | sheet + brackets | sheet | sheet ×4 |

**Constants the formulas use**

| Number | Where | Meaning | Confidence |
|---|---|---|---|
| 2450 | K8:S11, U8, I54:I57 | fixed console module height | high |
| 135 | rows 17–20 (ext−135) | height of a horizontal channel. Cladding fills the opening between two channels. | high |
| 67.5 | U8 | half a 135 channel. The channel's top face is flush with the landing floor. | high |
| 95.5 (= 67.5 + 28) | I8:I11 | the pit stub stops 28 mm above the pit floor (base plate or levelling) | medium |
| 170 | I8, K8 | depth needed under the GND floor for the 170 base channel. Below this the GND module is raised by (170 − pit). | medium |
| 30 | U8 | post tops stop 30 mm under the overhead line | medium |
| 200 | every width | external size minus two 100 mm corner posts | high |
| +35 (−100 vs −135) | glass | glass is 35 mm larger than the opening, sitting in rebates | high |
| +40 | every cover | cover is its channel length +40 (20 mm overlap each end) | high |
| 1098 / 1128 / 1090 | F62:F71 **text only** | console pane heights: 1090 bay; glass 1128; the single lowest glass 1098 | high |
| 3F−1 | H32:H38, H34, H84 | 135 channels per side face (you changed BACK from 3F to 3F−1 in R1) | medium |
| −35 | S8:S11 only | applied to the 4th→5th rise only; no physical reason found | low |

**Built-in check:** the corner-post pieces always add up to pit + travel + overhead − 58.
- Formula: I8 + F×2450 + all extensions + U8.
- BLR 94: 0 + 10,380 + 2,860 − 58 = 13,182.
- The one exception: when the 4RT column is used, the −35 makes it −93.

### 1.4 Output blocks, in sheet order
| Rows | Block (sheet colour) | What it lists | Columns |
|---|---|---|---|
| 2 | Header | DRAWING No, DESCRIPSION, COMMON, QTY, PIT(LENGTH), QTY, GND(LENGTH), QTY, 1ST F…, 2ND F…, 3RD F…, 4RT F…, OVER HEAD (U:V merged) | E:V |
| 8–11 | Corner verticals: FRONT LEFT / FRONT RIGHT / BACK LEFT / BACK RIGHT VERTICAL EXTN | extension piece per level for each corner post | I pit stub; K/M/O/Q/S length + L/N/P/R/T qty; U overhead |
| 12 | H/W sub-header (green) | "H W" pairs over K:T | — |
| 13–15 | Glass extension panels (light blue): LEFT / RIGHT / BACK | H × W per level | K/L … S/T pairs, no overhead |
| 17–20 | Sheet cladding extension panels (orange): LEFT / RIGHT / BACK / FRONT | H × W per level + overhead panel | K:T pairs + U/V |
| 25–42 | Horizontal channels | 170 base channels + covers, 142 sill, 135 channels (1.5 mm) + covers (1.2 mm), 3 mm bracket channel (row 34), top channels (3 mm) | G flag (BRACKET / NO / CWT word), H qty, I length |
| 44–50 | "OVER HEAD EXTN" group (E44:E50) | 2nd-last channels + covers | G, H, I |
| 53–71 | "2450 CONSOL" group (D53:D71), own header row 53 | 4 corner verticals (D100-0001…D103-0001), sill, glass 1098 (1ST) / 1128, sheet cladding 1090 | E drawing, F, H qty, I width/length |
| 74–92 | Doors, plates, fasteners | door posts R and L, lintels, header bracket channel, fixing plates 122/124, joint plates, rivnuts, bolts, screws, dead-weight channel | G spec, H qty |

### 1.5 How to read it
- **"NO"** means the part does not apply for this counterweight side, or this level.
- **COMMON (column G):**
  - "BRACKET" means this channel is cut as the bracket version on the counterweight wall.
  - "NO" on a cover row means there is no cover on the counterweight side.
  - Row 34 shows the counterweight side itself.
  - Row 74 shows the door opening.
- **In rows 25–92, column I is the length or width**, even though the row-2 header above it says PIT(LENGTH).
- **In rows 13–20, each level has a pair of cells:** H (height) then W (width).
- **In rows 62–71, the pane height is only in the description** (e.g. "1128 X"). Column I holds the width.

---

## 2. What changed vs the current ERP page

| Item | Latest workbook | ERP page today | Rebuild |
|---|---|---|---|
| Output rows and order | 66 output rows, as in §1.4 | same rows and order, but split into 6 cards (verticals, glass, sheet, channels, console, hardware) | one grid in sheet order |
| F70 name | "SHEET CLADDING COMMON 1.2MM 1090MM" (R1 dropped "RIGHT") | "SHEET CLADDING RIGHT COMMON…" | keep "RIGHT" (C12); the only real rename |
| Cover flags in G | G26, G29, G31, G33, G36, G38, G45, G47, G49 show "NO" on the counterweight side | no G value for covers | show them |
| G75 | new, dead: `=IF(C17="LEFT","NO",IF(C17="BACK",1,…))`; always blank | absent | drop; replaced by decision B6 |
| B18, B58:B64 | new labels, no values | absent | reserve for phase 2 (§4) |
| Group labels | "OVER HEAD EXTN" E44:E50, "2450 CONSOL" D53:D71, H/W sub-header row 12, G2 "COMMON" | none; G column is called "Bracket" | mirror the sheet |
| Per-level QTY (J, L, N, P, R, T) | shown (1, and T = C8) | hidden; one "1/EACH" column | show like the sheet, corrected (A16) |
| Panel (H, W) pairs | two cells per level | merged into one "H × W" cell | two cells, H/W sub-header |
| C17 door-opening list | 16 fragments (commas inside entries) | 12 cleaned entries | 12 cleaned (decision 14) |
| Sample inputs | W1600, D1550, pit 0, OH 2860, F4, 3720/3295/3365, LEFT | W1600, D1650, pit 345, OH 3200, F3, 3350/3310, BACK | use the workbook sample |
| Fixed in ERP, still wrong in workbook | H32/H33, R19/T19/R20/T20, P19/L20/N20/P20, L19, G30, H62:H67/H70/H71 | fixed in both modes | keep fixed (A1–A5, A14, A17) |
| Fixed silently in ERP (not in its audit list) | N15 when RIGHT = "NO"; T15 = C4−135 | W−200+35 | keep fixed, and register them (A6, A7) |
| Fixed only in ERP's "consistent" mode | I26/I29/I39, I29 +40, G37, T8:T11, T13 | "match workbook" mode reproduces the bugs | fixed by default (A8–A11, A16, C7) |
| Bugs the ERP reproduces in both modes | I41/I42 when BACK, row 20 gated to BACK, duplicate sill (27 + 61), H69 qty against "GLASS" | reproduced | fix or decide (A12, A13, A18, B1, B3) |
| U17:V20 overhead cladding | ungated (all 4 faces) | "consistent" mode gates by counterweight, which leaves the glass faces' overhead with no panel at all | keep ungated (B4). The ERP's audit entry is wrong. |
| Level gate | none (unused levels go negative) | gated on a minimum height (2585 / 2620 / 2585+(170−pit)). Ignores C8. Also silently blanks positive figures when the rise is 2450–2585. | gate on C8. A short rise is an error, not a silent "NO" (§6c). |
| ERP audit text | — | says H40 "was cleaned to 1 on 2026-09-23" and the header says fixes are "already applied in the workbook"; both untrue for your file (H40 is still `"BRACKET 3MM,   1"`) | replace with the corrections register |
| Mode selector | — | "Match workbook" / "Apply consistent geometry" | drop; one corrected grid + hover shows the workbook value |
| Sheet1 | exists | not ported | stays out (§4) |
| ERP-only extras | — | job picker, auto-fill from job record and GA drawing, xlsx export, print, saved inputs | keep |

On whether anything changed after R1: every R1 fact recorded in the ERP port is present word for word in the latest file. The red fills mark exactly the R1 cells. G75, B18 and B58:B64 are not mentioned in the port, so they are either late R1 additions or newer edits. Either way they compute nothing.

---

## 3. Formula problems in the latest workbook

The figures in "Effect" use the BLR 94 inputs (W 1600, D 1550, pit 0, OH 2860, 4 landings) unless stated. "ERP" says what the page does today.

### (A) Clear bugs: correct them
| # | Cell(s) | Workbook does | Should do | Effect on the cut list | Severity | Conf. | Recommended |
|---|---|---|---|---|---|---|---|
| A1 | H32, H33 | `=IF(C15="BACK","NO",IF(…C8*3…))-1`, with the −1 outside the IF, so BACK gives "NO"−1 = `#VALUE!` | `IF(C15="BACK","NO",C8*3-1)` (siblings H35:H38 already do this) | every BACK job: error in the 135 back channel and cover quantities | Crash | 99% | Correct (ERP already does) |
| A2 | R19, T19, R20, T20 | BACK width `E5-200`; E5 is an empty cell, so −200 | `C4-200` | 5–6-landing BACK jobs: back and front cladding at 3RD/4RT, e.g. 680 × **−200** | Wrong cut | 99% | Correct (ERP does) |
| A3 | P19 | BACK width `C5-200` (depth) | `C4-200` | 2ND back cladding 1350 instead of 1400 (wrong whenever W ≠ D) | Wrong cut | 95% | Correct (ERP does) |
| A4 | L20, N20, P20 | BACK width `C5-200` | `C4-200` (V20 already uses C4) | front cladding 1350 instead of 1400 at GND/1ST/2ND | Wrong cut | 90% | Correct (ERP does) |
| A5 | L19 | BACK width `C4-135` | `C4-200` | GND back cladding 1465, **65 mm too wide** (−135 is the height offset) | Wrong cut | 85% | Correct (ERP does) |
| A6 | T15 | LEFT/RIGHT width `C4-135` | `C4-200+35` | 4RT back glass 1465 instead of 1435 (**30 mm too wide**); 6-landing jobs only; has been there since the original file | Wrong cut | 85% | Correct (ERP does, silently) |
| A7 | N15 | RIGHT branch returns "NO" | `C4-200+35` | CWT RIGHT: the 1ST back glass has a height (M15) but no width, so the panel is dropped; there since the original file | Missing part | 95% | Correct (ERP does, silently) |
| A8 | T13 | cell never created | `=IF(C15="LEFT","NO",C5-200+35)` | 6-landing BACK/RIGHT: the 4RT left glass has a height (S13) but no width | Missing dimension | 95% | Correct (ERP: consistent mode only) |
| A9 | I26 | BACK branch `C4-200+40` | `C5-200+40` (a left cover spans the depth; its channel I25 is C5) | 1440 instead of 1390 | Wrong cut | 95% | Correct (ERP: consistent mode only) |
| A10 | I29 | LEFT `C5-200` (no +40); BACK `C4-200+40` | `C5-200+40` in both | 1350 (LEFT) / 1440 (BACK) instead of 1390 | Wrong cut | 90–95% | Correct (ERP: consistent mode only) |
| A11 | I39 | BACK `C4-200` | `C5-200` (its twin I40 is C5 in every branch) | 1400 instead of 1350 | Wrong cut | 95% | Correct (ERP: consistent mode only) |
| A12 | I41 | BACK gives "NO", although G41 = BRACKET and H41 = "BRACKET, 1" (a copy of I32) | `=C4-200` | BACK jobs: the back top bracket channel has a quantity but no length | Missing dimension | 90% | Correct (**new**: ERP reproduces it) |
| A13 | I42 | BACK gives "NO", although H42 = 1 (a copy of I32) | `=C4-200` (the front never changes with the counterweight; I48 is C4−200 always) | BACK jobs: the front top channel has no length, so the top frame is open at the front | Missing dimension | 90% | Correct (**new**) |
| A14 | G30 | tests `C20` (empty), so it never flags | `=IF(C15="BACK","BRACKET","")` | BACK jobs: the back 170 channel is never flagged as the bracket version, so it gets made plain | Wrong part | 98% | Correct (ERP does) |
| A15 | K..T of rows 8–20 (level cells) | no gate: unused levels compute from 0 | a level exists only if it is one of the first C8−1 rises; otherwise "NO" in length and quantity | BLR 94: Q8 −2450, S8 −2485, Q14/Q15 −2550, Q17 −2585, S17 −2620, each with qty 1 in R8/T8 | Wrong cut (negative, phantom parts) | 95% | Correct, gating on floors (§6c). The ERP gates on height instead. |
| A16 | T8:T11 | `=C8` | `1` (with the level gate) | 6-landing jobs: 6 pieces per corner at 4RT instead of 1 | Wrong qty | 90% | Correct (ERP hides this column) |
| A17 | H62:H67, H70, H71 | flat 1 / 2F−1 / 2F whatever the counterweight | "NO" on the face whose I reads "NO" | BLR 94 (LEFT): H63 1, H65 7, H70 8, H71 8 = **24 pieces for faces that do not exist** | Extra parts | 90% | Correct (ERP does) |
| A18 | H69 / I69 | qty 2F always; I69 = "GLASS" when CWT ≠ LEFT | CWT ≠ LEFT: qty "NO", length "NO" | BACK/RIGHT jobs: 8 extra left "sheets" for a face that is glass, and that glass is already counted in H63+H65 | Extra parts | 85% | Correct. Reverses an earlier ERP choice ("deliberately not gated"). |

A18 evidence from the 10 Sep copy: rows 70 and 71 there also said "GLASS" (old I61, I62), and you have since changed both to "NO". Row 69 is the one that was missed.

### (B) Owner must decide
Until you answer, the rebuild keeps the workbook's behaviour for these. Each one is a one-line switch in code.

| # | Cell(s) | Workbook does | Options | Effect on the cut list | Severity | Conf. it's wrong | Recommended |
|---|---|---|---|---|---|---|---|
| B1 | K20:T20 (row 20, FRONT extension cladding) | exists only when CWT = BACK; every cell is a copy of row 19's `IF(LEFT,"NO",IF(BACK,x,IF(RIGHT,"NO")))`. The front overhead panel U20:V20 is not gated. | every job / BACK only / a per-job tick-box | LEFT/RIGHT jobs get no front panel between the door head and the next floor, at any level | Missing parts | 60% | **Every job.** If it depends on the site, add a tick-box (default yes). |
| B2 | S8:S11 | `=C13-2450-35`: −35 on the 4th→5th rise only | keep / remove / move to the top rise | 6-landing jobs: the top landing sits 35 mm lower; post check gives −93 instead of −58 | Wrong cut (35 mm) | 50% | **Remove**, after the shop confirms |
| B3 | row 27 "HZ SILL CHANNEL 142" and row 61 "HZ CHANNEL SILL 142" | both qty C8, length C4−200; both in the original file | same part (count once) / two parts | if both are cut: 2 × F sills | Extra parts | 50% | **Same part.** Keep row 61 (console block); row 27 shows "NO" but stays visible. |
| B4 | U17:V20 | overhead cladding on all 4 faces for every counterweight | keep / gate by counterweight | rows 13–15 have no overhead cells, so gating would leave the glass faces' overhead with no panel | — | 25% | **Keep** (workbook is right; the ERP audit entry is wrong) |
| B5 | U17:U20 | `C7-2422-170` = OH−2592, which is 44.5 mm less than the extension rule (U8−135 = OH−2547.5) | keep / change | overhead panel height | Possible wrong cut | unknown | **Keep**; confirm the top channel section size |
| B6 | rows 74–80, G75 | the R set (D-locking R, cladding R, lintel R) **and** the L set, each qty F; G75 looks like an unfinished attempt to gate by door | the door hand picks one set / both | one door needs one D-locking post, one cladding post and one lintel (per the drawing: 685 cladding + opening + 115 D-locking). Shipping both doubles them. | Extra parts | 60% | **The hand picks the set** (R openings → R set, L → L set); centre-opening = both until confirmed |
| B7 | rows 69–71 pane height | all 2F sheets are "1090MM" | 1090 for all / lowest one ~1062 | the lowest bay is 28 mm shorter: glass uses 1098 instead of 1128, and the drawing shows a 1062 cover. One sheet per job may be 28 mm too tall. | Wrong cut | 60% | **1062** for the lowest, after the shop measures one. This splits each row as 1 × 1062 + (2F−1) × 1090, like the glass rows. |
| B8 | H32:H38, H34, H84 | 3F−1 channels per side face | keep / 3F−2 | counting panel edges suggests 3F−2 unless the 170 base channel is an extra member | Possible extra part | 30% | **Keep** (you set this in R1); check against a 2-landing drawing sometime |

### (C) Cosmetic: no part or dimension changes, fix in the rebuild
| # | Cell(s) | Issue | Fix |
|---|---|---|---|
| C1 | H29 L `"1"`, H31 L `"1"`, H39 L `" 1"`, H40 R `"BRACKET 3MM,   1"`, H41 B `"BRACKET,  1"` | text in a quantity column, so SUM skips it | numeric 1; the flag already sits in G |
| C2 | M15 B `" NO "`, I65 L `"NO "`, I71 R `"NO "` | "NO" spelt with spaces | `"NO"` |
| C3 | G25, G26, G29, G30, G31, G33, G35, G36, G38, G39, G40, G41, G44:G50 | `IF(c,"X",)` with an empty else: blank in Google Sheets, **0 in desktop Excel** | blank |
| C4 | L14, N14, P14, N15, I62, I63, I64, I66, I71 | 2-argument IF gives FALSE when C15 is blank | not reachable with the dropdown; blank |
| C5 | H34 (and H32/H33) | `#VALUE!` when C15 is blank | not reachable; the rebuild never allows a blank counterweight |
| C6 | I31 (B), I45 (L), I47 (R), I49 (B) | length shown while the quantity is "NO" | "NO" |
| C7 | G37 | `' '`: no BRACKET flag on RIGHT, unlike G32/G35 | `IF(C15="RIGHT","BRACKET","")` |
| C8 | G48 | tests "FRONT", which the counterweight can never be | blank |
| C9 | G75 | tests the door opening against LEFT/BACK/RIGHT, so it is always blank | remove (see B6) |
| C10 | K13/M13/O13, K14/M14/O14 → row 9; M19 → M10; M20 → M11; O20 → O9 | point at sibling rows; only works because rows 8–11 are identical | one extension value per level |
| C11 | C17 dropdown | commas split entries: "800 L", "  AT", "600L", " SW"… and a trailing space in "AT 700 L " | 12 clean entries (decision 14) |
| C12 | F70 | lost "RIGHT" | "SHEET CLADDING RIGHT COMMON 1.2MM 1090MM" |
| C13 | V8:V11, U12:V12 | overhead quantity cells and the H/W sub-header are missing | V = 1; add an "H W" sub-header under U/V |
| C14 | 44 cells holding a single space (F58:H58, F60:H60, G54:G57, K16:S16, B19…) | leftovers from deleted rows | treat as empty |
| C15 | C16 | door type is read by nothing; C16 says ACO/SWING while C17 says CO/SW; MCD has no openings | carry it; add a consistency warning (§6c) |
| C16 | row 49 (cover) before row 50 (channel); I28's redundant 3-way IF | order and formula style | keep the sheet order; simplify the formula |

---

## 4. Sheet1 and the placeholders

### 4.1 Sheet1: an old, unlinked glass calculator
**Inputs**
- D5 PIT = **1600**. It was 0 on the 10 Sep copy; this is the only change since.
- E5 FH (ground floor-to-floor) = 3600.
- F5 width = 1500, G5 depth = 1400.
- E11 "OTHERS FLOOR" = 3460: one height for all upper floors.

**Outputs**
- Columns K, L, M are the R, L and B faces.
- I5 `=(E5+D5)-(2450-D5)`, K5 `=I5-135+44` (ground extension pane height).
- K6 `=G5-200+41-5` (pane width).
- K7 `=((2450-270)/2)+44-5-28` = 1101 and K8 = 1129 (ground-module panes).
- I11 `=E11-2450`, K11 `=I11-200+41-5` (upper extension height).
- K13 `=(2450-270)/2+41-5` = 1126 (upper-module panes).
- It has no quantities, no counterweight logic, no front, no overhead, and no links to or from Sheet2.

**Errors in it**
1. **I5 counts the pit twice** (FH + 2·pit − 2450). With pit 1600 that gives a 4,259 mm pane.
2. **K11:M11 uses the width formula for a height** (−200+41−5). It gives 846 where the drawing shows 913.
3. The allowances 44 and 41 are mixed up (1129 vs 1126 for the same 1090 bay).

**Agreement with Sheet2:** widths and console panes agree with Sheet2's glass rows to within 1–3 mm (1236 vs 1235, 1101 vs 1098, 1129 vs 1128). Both extension heights are wrong.

**Its one useful idea:** it works the pane heights out from the geometry: (2450 − 2×135)/2 = 1090 bay, and 28 = 170 − 142 for the shorter ground bay. Sheet2 only carries these as label text.

**Recommendation:** do **not** port Sheet1. In the rebuild, store the console pane heights (1098/1128/1090) as numbers with named constants, not only inside the description.

### 4.2 Placeholders B18, B58:B64
All of these were added since the 10 Sep copy. Each has an empty C cell and nothing refers to it.

| Label | Likely meaning | Candidate rule (needs owner answers) | Existing ERP BOM section |
|---|---|---|---|
| B18 LEFT FACIA EXTERNAL | width of the front-wall strip left of the landing opening (GAs print "left \| opening \| right", e.g. 190 \| 700 \| 135) | it would size the door posts (rows 74–80 have quantities but no sizes): left panel = LF − 100 − frame allowance; right = (C4−200) − left − clear opening | — (belongs with rows 74–80) |
| B58 / B59 MAIN / CWT GUIDE RAIL, B62 GUIDE RAIL LENGTH | rail item and count for car and counterweight | length ≈ pit + travel + OH − 50 (GA "50 top clearance"); pieces per line = CEILING(length ÷ stock length); fishplates = 2 × (pieces − 1) | RAIL |
| B60 NO OF BRACKETS | rail brackets | either 6·C8 (one per bracket-channel level; matches H83 + H84 = 6F), or by spacing: CEILING(length ÷ 1200) + 1 levels × 2 | MAIN BRACKET, COUNTER BRACKET |
| B61 GUIDE CLIP | rail clips | 2 per rail per bracket | RAIL CLIP |
| B63 BUFFER STAND LENGTH | buffer stands | pit − buffer height − runby − striker depth (car and counterweight differ) | Buffer Stand, Buffer Spring, Buffer Channel Main/Counter |
| B64 ROPE LENGTH | rope or belt | roping factor × (pit + travel + OH) + allowance; the governor rope ≈ 2 × (pit + travel + OH) + 3–4.5 m fits all five Bangalore jobs | Wire Rope Main/Belt Main, Wire Rope Governor |

**Recommendation:** leave all of these out of this rebuild (phase 2).
- When they are built, the generator should **write them into the job's normal BOM sections** listed above, because MRP and dispatch already read those.
- Existing job BOM lines are a noisy calibration source: rail clips are filed under "Buffer Channel" on 4 of the 5 jobs.

---

## 5. Owner decision list
Each question can be answered with one word or number. The recommended answer is in bold.

1. Apply all the Category A corrections (A1–A18) to the new page? **YES**
2. Is "No of floors" the number of landings (stops), so 4 floors = 3 rises? **YES**
3. Most landings a RALPH 400 can have? **6**
4. Should the front extension cladding (row 20) also appear on LEFT- and RIGHT-counterweight jobs? **YES** (answer "SOMETIMES" and we add a tick-box)
5. Keep the extra −35 mm on the 4th→5th rise (S8)? **NO**
6. Are rows 27 and 61 (the two "142 sill" channels) the same part, to be counted once? **YES**
7. Is the overhead sheet-clad on all four faces (rows 17–20, OVER HEAD column)? **YES**
8. Keep the overhead panel height as over head − 2592? **YES**
9. Should the door hand (R or L in the opening) pick only that side's door-post set? **YES**
10. For centre-opening (CO) doors, which door-post set ships: R, L or BOTH? **BOTH**
11. Height of the lowest sheet on the counterweight face: 1090 or 1062? **1062** (shop to measure one first)
12. Keep 3 × floors − 1 as the number of 135 channels per side? **YES**
13. Below what rise should the page warn that panels get too small to make? **2700**
14. Use the cleaned list of 12 door openings (AT 600/700/800 R and L, 600/700/800 CO, 600L/700L/800L SW)? **YES**
15. Retire Sheet1 (not rebuilt)? **YES**
16. Build the facia, rail, bracket, clip, buffer and rope rows (B18, B58–B64) now or LATER? **LATER**
17. Drop the "Match workbook / Apply consistent geometry" switch, and show the workbook value on hover instead? **YES**
18. From now on, is the ERP page the master copy, with the workbook kept as reference only? **YES**

---

## 6. Rebuild specification

Per CLAUDE.md §0 this is a branch + PR change: it rewrites the model and replaces the UI.

### 6(a) Data model

**Notation**
- Inputs: W = C4, D = C5, P = C6, OH = C7, F = C8, h[0..4] = C9..C13, CWT = C15 ∈ {BACK, RIGHT, LEFT}.
- Level k = 0..4 is the GND, 1ST, 2ND, 3RD, 4RT column pair (K/L, M/N, O/P, Q/R, S/T). OVER HEAD = U/V.
- **Key every output by its sheet address** (e.g. `"M15"`, `"N15"`). The test oracle compares by address.

**Inputs**
| Field | Cell | Type / rule |
|---|---|---|
| jobNo | C3 | text (keep the existing job picker and auto-fill) |
| W, D | C4, C5 | mm, number |
| P | C6 | mm, ≥ 0 |
| OH | C7 | mm |
| F | C8 | integer 2–6 (landings) |
| h[0..4] | C9..C13 | mm; exactly the first F−1 are used |
| CWT | C15 | BACK / RIGHT / LEFT; never blank |
| doorType | C16 | AT / ACO / SWING / MCD (carried, not computed) |
| doorOpening | C17 | the 12 clean entries |
| (reserved) | B18 | not used in v1 |

**Derived values**
- `live(k) = k <= F-2`. Validation (§6c) guarantees h[k] > 0 for live levels.
- `TOP_EXTRA = 35`, or 0 if decision 5 = NO.
- `ext[0] = P >= 170 ? h[0]-2450 : h[0]-2450-(170-P)`
- `ext[1] = h[1]-2450`, `ext[2] = h[2]-2450`, `ext[3] = h[3]-2450`, `ext[4] = h[4]-2450-TOP_EXTRA`
- `pitStub = P >= 170 ? P-95.5 : 74.5`
- `ohVert = OH+67.5-2450-30`
- `ohPanel = OH-2422-170`

**Decision flags**

Defaults equal the workbook until the owner answers:
```ts
const RULES = {
  topExtra: 35,
  frontCladAllSides: false,
  sillCountOnce: false,
  doorHandSelects: false,
  coDoorSets: "BOTH",
  lowestSheetH: 1090,
};
```
- `frontClad = RULES.frontCladAllSides || CWT === "BACK"`.
- Store the console pane heights numerically: rows 62–64 = 1098, rows 65–67 = 1128, rows 69–71 = 1090.

**Rows 8–11: FRONT LEFT / FRONT RIGHT / BACK LEFT / BACK RIGHT VERTICAL EXTN** (all four rows identical)

| Cell | Corrected | Workbook literal |
|---|---|---|
| I | pitStub | `=IF(C6>=170, C6-95.5,IF(C6<170, 74.5))` (same) |
| J | 1 | 1 |
| K, M, O, Q, S | live(k) ? ext[k] : NO | ungated `C9..C13-2450` (A15) |
| L, N, P, R, T | live(k) ? 1 : NO | 1, 1, 1, 1, and **T = C8** (A15, A16) |
| U | ohVert | `=C7+67.5-2450-30` (same) |
| V | 1 | blank (C13) |

**Rows 13–20: panel pairs**

For each level k, H goes in the first column of the pair and W in the second. If the row does not apply, **or** !live(k), both cells are "NO".

| Row | Description | Applies when | H | W | OVER HEAD (U / V) | Workbook literal where different |
|---|---|---|---|---|---|---|
| 13 | GLASS 6MM LEFT EXTN | CWT ≠ LEFT | ext[k]−100 | D−200+35 | none | T13 missing (A8); H reads row 9 (C10) |
| 14 | GLASS 6MM RIGHT EXTN | CWT ≠ RIGHT | ext[k]−100 | D−200+35 | none | H reads row 9 (C10) |
| 15 | GLASS 6MM BACK EXTN | CWT ≠ BACK | ext[k]−100 | W−200+35 | none | N15 RIGHT = "NO" (A7); T15 = C4−135 (A6); M15 BACK `" NO "` (C2) |
| 17 | SHEET CLADDING 1.2MM LEFT EXTN | CWT = LEFT | ext[k]−135 | D−200 | ohPanel / D−200, for **every** CWT (B4) | — |
| 18 | SHEET CLADDING 1.2MM RIGHT EXTN | CWT = RIGHT | ext[k]−135 | D−200 | ohPanel / D−200, every CWT | — |
| 19 | SHEET CLADDING 1.2MM BACK EXTN | CWT = BACK | ext[k]−135 | W−200 | ohPanel / W−200, every CWT | L19 C4−135 (A5); P19 C5−200 (A3); R19, T19 E5−200 (A2); M19 reads M10 (C10) |
| 20 | SHEET CLADDING 1.2MM FRONT EXTN | frontClad (B1) | ext[k]−135 | W−200 | ohPanel / W−200, every CWT | BACK only (B1); L20, N20, P20 C5−200 (A4); R20, T20 E5−200 (A2); M20 reads M11, O20 reads O9 (C10) |

**Rows 25–50: channels.** G = COMMON flag, H = QTY, I = length. Triples are LEFT / BACK / RIGHT; "—" means blank.

| Row | Description | G | H | I | Workbook literal where different |
|---|---|---|---|---|---|
| 25 | HZ CHANNEL LEFT 170 | BRACKET / — / — | 1 | D−200 | — |
| 26 | HZ CH LEFT COVER 170 (1.2MM) | NO / — / — | NO / 1 / 1 | NO / D−200+40 / D−200+40 | I26 BACK C4−200+40 (A9) |
| 27 | HZ SILL CHANNEL 142 | — | F (NO if sillCountOnce) | W−200 | (B3) |
| 28 | HZ CHANNEL RIGHT 170 | — / — / BRACKET | 1 | D−200 | — |
| 29 | HZ CH COVER RIGHT 170 | — / — / NO | 1 / 1 / NO | D−200+40 / D−200+40 / NO | I29 LEFT C5−200, BACK C4−200+40 (A10); H29 LEFT text "1" (C1) |
| 30 | HZ CHANNEL 170 BACK | — / BRACKET / — | 1 | W−200 | G30 tests C20 (A14) |
| 31 | HZ CH BACK COVER 170 (1.2MM) | — / NO / — | 1 / NO / 1 | W−200+40 / NO / W−200+40 | H31 LEFT "1" (C1); I31 BACK 1440 (C6) |
| 32 | HZ CHANNEL 135 BACK (1.5MM) | — / BRACKET / — | 3F−1 / NO / 3F−1 | W−200 / NO / W−200 | H32 BACK #VALUE! (A1) |
| 33 | HZ CHANNEL 135 BACK COVER (1.2MM) | — / NO / — | 3F−1 / NO / 3F−1 | W−200+40 / NO / W−200+40 | H33 BACK #VALUE! (A1) |
| 34 | HZ BRACKET CHANNEL 135 (3MM) | LEFT / BACK / RIGHT (= CWT) | 3F−1 | D−200 / W−200 / D−200 | — |
| 35 | HZ CHANNEL 135 LEFT (1.5MM) | BRACKET / — / — | NO / 3F−1 / 3F−1 | NO / D−200 / D−200 | — |
| 36 | HZ CHANNEL 135 LEFT COVER (1.2MM) | NO / — / — | NO / 3F−1 / 3F−1 | NO / D−200+40 / D−200+40 | — |
| 37 | HZ CHANNEL 135 RIGHT (1.5MM) | — / — / BRACKET | 3F−1 / 3F−1 / NO | D−200 / D−200 / NO | G37 `' '` (C7) |
| 38 | HZ CHANNEL 135 RIGHT COVER (1.2MM) | — / — / NO | 3F−1 / 3F−1 / NO | D−200+40 / D−200+40 / NO | — |
| 39 | HZ TOP CHANNEL LEFT (3MM) | BRACKET / — / — | 1 | D−200 | I39 BACK C4−200 (A11); H39 LEFT " 1" (C1) |
| 40 | HZ TOP CHANNEL RIGHT (3MM) | — / — / BRACKET | 1 | D−200 | H40 RIGHT "BRACKET 3MM,   1" (C1) |
| 41 | HZ TOP CHANNEL BACK (3MM) | — / BRACKET / — | 1 | W−200 | I41 BACK "NO" (A12); H41 BACK "BRACKET,  1" (C1) |
| 42 | HZ TOP CHANNEL FRONT (3MM) | — | 1 | W−200 | I42 BACK "NO" (A13) |
| 44 | HZ 2ND LAST CHANNEL 135 MM LEFT | BRACKET / — / — | 1 | D−200 | — |
| 45 | HZ 2ND LAST CHANNEL COVER 135 MM LEFT | NO / — / — | NO / 1 / 1 | NO / D−200+40 / D−200+40 | I45 LEFT 1390 (C6) |
| 46 | HZ 2ND LAST CHANNEL 135 MM RIGHT | — / — / BRACKET | 1 | D−200 | — |
| 47 | HZ 2ND LAST CHANNEL COVER 135 MM RIGHT | — / — / NO | 1 / 1 / NO | D−200+40 / D−200+40 / NO | I47 RIGHT 1390 (C6) |
| 48 | HZ 2ND LAST CHANNEL 135 MM FRONT | — | 1 | W−200 | G48 tests "FRONT" (C8) |
| 49 | HZ 2ND LAST CHANNEL COVER 135 MM BACK | — / NO / — | 1 / NO / 1 | W−200+40 / NO / W−200+40 | I49 BACK 1440 (C6) |
| 50 | HZ 2ND LAST CHANNEL 135 MM BACK | — / BRACKET / — | 1 | W−200 | — |

**Rows 53–71: 2450 CONSOL** (header row 53: DRAWING No / DESCRIPTION / QTY)

| Row | E | Description | H (L / B / R) | I (L / B / R) | Workbook literal where different |
|---|---|---|---|---|---|
| 54 | D100-0001 | FRONT LEFT VERTICAL (2450MM, 3MM THICK) | F | 2450 | — |
| 55 | D101-0001 | FRONT RIGHT VERTICAL (2450MM, 3MM THICK) | F | 2450 | — |
| 56 | D102-0001 | BACK LEFT VERTICAL (2450MM, 3MM THICK) | F | 2450 | — |
| 57 | D103-0001 | BACK RIGHT VERTICAL (2450MM, 3MM THICK) | F | 2450 | — |
| 61 | — | HZ CHANNEL SILL 142 | F | W−200 | (B3) |
| 62 | — | GLASS BACK COMMON 1098 X (1ST) | 1 / NO / 1 | W−200+35 / NO / W−200+35 | H62 = 1 always (A17) |
| 63 | — | GLASS LEFT COMMON 1098 X (1ST) | NO / 1 / 1 | NO / D−200+35 / D−200+35 | H63 = 1 always (A17) |
| 64 | — | GLASS RIGHT COMMON 1098 X (1ST) | 1 / 1 / NO | D−200+35 / D−200+35 / NO | H64 = 1 always (A17) |
| 65 | — | GLASS LEFT COMMON 1128 X | NO / 2F−1 / 2F−1 | NO / D−200+35 / D−200+35 | H65 2F−1 always (A17); I65 LEFT "NO " (C2) |
| 66 | — | GLASS RIGHT COMMON 1128 X | 2F−1 / 2F−1 / NO | D−200+35 / D−200+35 / NO | H66 always (A17) |
| 67 | — | GLASS BACK COMMON 1128 X | 2F−1 / NO / 2F−1 | W−200+35 / NO / W−200+35 | H67 always (A17) |
| 69 | — | SHEET CLADDING LEFT COMMON 1.2MM 1090MM | 2F / NO / NO | D−200 / NO / NO | H69 2F always; I69 BACK/RIGHT "GLASS" (A18); B7 split |
| 70 | — | SHEET CLADDING RIGHT COMMON 1.2MM 1090MM | NO / NO / 2F | NO / NO / D−200 | F70 lacks "RIGHT" (C12); H70 2F always (A17) |
| 71 | — | SHEET CLADDING BACK COMMON 1.2MM 1090MM | NO / 2F / NO | NO / W−200 / NO | H71 2F always (A17); I71 RIGHT "NO " (C2) |

If decision 11 = 1062, each of rows 69–71 splits into "…1062MM (1ST)" with qty 1 on the sheet face, plus "…1090MM" with qty 2F−1.

**Rows 74–92: doors, plates, fasteners**

The door hand comes from the opening: ends in "R" → R; contains "L" (e.g. "AT 600 L", "600L SW") → L; contains "CO" → CO.

| Row | Description | G | H | Workbook literal |
|---|---|---|---|---|
| 74 | DOOR POST D LOCKING R | = door opening | F, or NO if doorHandSelects and hand = L | F |
| 75 | DOOR POST CLADING R | — | as row 74 | F; G75 dead formula (C9) |
| 76 | LINTEL PANEL R | — | as row 74 | F |
| 78 | DOOR POST D LOCKING L | — | F, or NO if doorHandSelects and hand = R | F |
| 79 | DOOR POST CLADING L | — | as row 78 | F |
| 80 | LINTEL PANEL L | — | as row 78 | F |
| 82 | HEADER BRACKET CHANNEL | — | F | — |
| 83 | BRACKET FIXING PLATE 122 | — | 2 | — |
| 84 | BRACKET FIXING PLATE 124 | — | F·3·2−2 | — |
| 85 | JOINT PLATE HEX | — | 8F | — |
| 86 | JOINT PLATE HOLE | — | 8F | — |
| 88 | RIVNUT 8 | — | 52F | — |
| 89 | RIV NUT 5 | — | 203F | — |
| 90 | M8 X 30 BOLT | — | 52F | — |
| 91 | M5 X 20 SCREW | — | 203F | — |
| 92 | DEAD WEIGHT CHANNEL | — | F | — |

For CO doors, both sets ship while `coDoorSets = "BOTH"`.

**Golden check: BLR 94, CWT LEFT, corrected, current RULES**

| Rows | Expected values |
|---|---|
| 8–11 | I 74.5; K 1100; M 845; O 915; Q/S NO; U 447.5 |
| 14 | 1000×1385, 745×1385, 815×1385 |
| 15 | 1000×1435, 745×1435, 815×1435 |
| 17 | 965×1350, 710×1350, 780×1350; OH 268×1350 |
| 18 | OH 268×1350 |
| 19 and 20 | OH 268×1400 |
| 34 | 11 × 1350, tag LEFT |
| 84 | 22 |
| 62–67 | H62 1×1435; H63 NO; H64 1×1385; H65 NO; H66 7×1385; H67 7×1435 |
| 69–71 | H69 8×1350; H70/H71 NO |

### 6(b) UI layout: mirror Sheet2
- **Two panes, as in the sheet.**
  - Left: an input panel with the exact B3:C17 labels in sheet order. The "Counter weight location" label is magenta. Keep the job picker, auto-fill, saved inputs and "Reset to BLR 94" (with the workbook sample).
  - Rise boxes beyond F−1 are greyed and disabled automatically.
  - Right: **one grid**.
- **Grid columns:** DRAWING No (E) | DESCRIPTION (F) | COMMON (G) | QTY (H) | PIT(LENGTH) (I) | QTY (J) | GND(LENGTH) | QTY | 1ST F(LENGTH) | QTY | 2ND F(LENGTH) | QTY | 3RD F(LENGTH) | QTY | 4RT F(LENGTH) | QTY | OVER HEAD (U:V, 2 columns).
  - Keep the sheet's header words ("4RT", "OVER HEAD"). Fixing the spelling DESCRIPSION → DESCRIPTION is fine; row 53 already uses it.
- **Rows** in sheet order, with thin spacer rows where the sheet has blanks. Rows 43, 51–52, 58–60, 68, 72–73, 77, 81 and 87 separate groups.
- **Sub-headers**
  - Row 12 "H W" pairs under K:T (green #6AA84F), **plus** H/W under U:V.
  - Add a thin sub-header in the blank row 24: "COMMON · QTY · LENGTH", so column I is not read as a pit length. This is a deliberate clarification the sheet does not have.
- **Group labels:** a vertical merged "OVER HEAD EXTN" beside rows 44–50; a vertical "2450 CONSOL" beside rows 53–71 with its own header row 53.
- **Colour bands**, taken from the sheet and defined as theme tokens with dark-mode variants:
  - Glass rows 13–15 and 62–67: light blue #A4C2F4.
  - Sheet cladding rows 17–20 K:U: #E69138, and V: #FF9900.
  - Console cladding rows 69–71 G:I: #FF9900.
  - Red fills (F17:F20, F26, F29:I31, F33:I33, F36:I36, F38:I38, F45:I45, F47:I47, F49:I49, I65, F69:F71, F83:H84) mark R1 changes. Show them as a light-red tint on those cells, with a legend "red = changed in R1" and a toggle to hide them.
- **Cell rendering**
  - Numbers right-aligned in tabular figures.
  - "NO" in muted text.
  - Bracket flags as a small tag in G; row 34 shows the counterweight word; row 74 shows the door opening.
  - Levels that don't exist: the whole column is greyed and reads NO.
  - **A corrected cell** (one that differs from the literal workbook) gets a small dot. Hovering shows: "Workbook cell T15 gives 1465 (C4−135); corrected to 1435 — A6".
  - Hovering any cell shows its sheet address, so the owner can cross-check against his file.
- **Error state:** validation errors put a red banner above the grid and a red outline on the offending column. **Print and Export are disabled**, or the print carries a watermark "INVALID — DO NOT CUT".
- **Narrow screens:** the grid scrolls sideways inside its container with the DESCRIPTION column sticky; the page itself never scrolls sideways.
- **Print:**
  - A3 landscape, or A4 landscape fit-to-width.
  - A header strip with job, W×D, pit, OH, floors, rises, counterweight and door.
  - Grid below with colour bands printed (`print-color-adjust: exact`), and the header row repeated on each page.
  - Footer: generated date/time, model version, "• = corrected cell (see list)", and the list of corrections applied (IDs).
  - Hide app navigation.
- **Export (xlsx):** one sheet laid out **at the same cell addresses as Sheet2**, with inputs in B3:C17 and outputs at their rows and columns, values as numbers, so it opens side by side with the owner's file. Add a second sheet "Corrections" listing each differing address, the workbook value, the new value and the ID.

### 6(c) Validation rules

**Hard errors** (block print and export)
- F must be an integer from 2 to 6.
- CWT must be BACK, RIGHT or LEFT.
- h[0..F−2] must all be > 0. A missing rise is an error: "2nd→3rd rise missing for 4 landings".
- Every live rise must leave a positive cladding height, i.e. ext[k] − 135 > 0:
  - GND: h[0] > 2585 + max(0, 170 − P). For BLR 94 at pit 0 that is 2755.
  - 1ST–3RD: > 2585.
  - 4RT: > 2585 + TOP_EXTRA (2620 while the −35 remains).
- OH > 2592, so the overhead panel is positive; the overhead vertical then comes out at ≥ 179.5.
- P ≥ 0.
- W and D > 200 (plus a sanity minimum the owner sets).

**Warnings** (the page still prints)
- A rise entered beyond F−1 (a stale value): "ignored — floors = N". That level shows NO.
- Any live rise below the practical minimum (decision 13, default 2700), where panels get too small to make.
- Very tall rise: ext > 2000 (owner number), for glass size and bracket spacing.
- P < 170: "ground module raised by (170 − P) mm; the GND sill sits above the pit floor".
- Deep pit: pit stub P − 95.5 above a limit the owner sets.
- Door type and opening mismatch (AT ↔ "AT …", ACO ↔ "CO", SWING ↔ "SW"; MCD has no opening).
- W − 200 too narrow for the clear opening plus frame.

**Non-existent levels:** every cell of levels k > F−2 in rows 8–20 reads NO, including the QTY cells. There are no negative numbers anywhere in a valid job.

**Allowed door openings:** AT 600 R, AT 700 R, AT 800 R, AT 600 L, AT 700 L, AT 800 L, 600 CO, 700 CO, 800 CO, 600L SW, 700L SW, 800L SW. A saved value that is not on the list shows "(not in list)" rather than silently changing.

### 6(d) Verification plan

1. **Reference fixture.**
   - Commit the owner's workbook as a test fixture, e.g. `docs/ralph400/RALPH 400 BOM (latest).xlsx`.
   - Port the scratch evaluator into `scripts/ralph400/xl-eval.ts`. It must handle IF with 2 or 3 arguments and an empty else, + − * /, comparisons, empty cell = 0, and text in arithmetic = #VALUE!.
   - The scratch evaluators (`…/scratchpad/ralph/evalwb.py`, `…/ralph/diff/xlev.py`) live in a session-only folder; copy them into the repo now if they are wanted.
   - Read formulas with the `xlsx` 0.18.5 library already in the project (`cell.f`).
   - **Self-test:** reproduce all 211 cached Sheet2 values.
2. **Corrections expressed as formulas.** `scripts/ralph400/corrections.ts` maps each changed address to its corrected formula (A1–A18, plus each decided B item). The patched workbook is the specification in Excel form, and can be handed back to the owner.
3. **Model under test.** The new `model.ts` returns `Record<address, value>` plus display metadata.
4. **Normaliser.**
   - Trim strings; `" NO "` and `"NO "` become `"NO"`.
   - `"1"`, `" 1"`, `"BRACKET…, 1"` become 1.
   - FALSE, the empty-else blank, `""` and `' '` become empty.
5. **Scenario grid:** about 10,500 cases.

   | Factor | Values |
   |---|---|
   | CWT | 3 |
   | F | 2–6 |
   | pit | 0, 100, 169, 170, 171, 345, 800 |
   | OH | 2593, 2600, 2860, 3200, 3600 |
   | rise sets | all at minimum+1, all 2700, 3300/3100/3200/3000/3400, 3720/3295/3365/3500/4200, all 4500 |
   | shafts | 1600×1550, 1550×1600, 1600×1600, 1240×1670 |

   Plus targeted cases: stale rises, missing rises, rise at or below the minimum, OH ≤ 2592, pit exactly 170, and every door opening.
6. **Assertions** (`npx tsx scripts/verify-ralph400.ts`, in the style of the existing `scripts/verify-*.ts`):
   - **(a)** model == patched oracle at every address in E3:V92, for every valid scenario.
   - **(b)** every address where the model ≠ the literal oracle is listed in `DIFF_REGISTER` (address, ID, reason). No unregistered difference is allowed, and no registered item may fail to fire somewhere in the grid (this catches stale entries).
   - **(c)** Invariants:
     - Post stack I8 + F×2450 + Σ live ext + U8 = P + travel + OH − 58 (−93 if 4RT is live and TOP_EXTRA = 35).
     - Per glass face: 1098 qty + 1128 qty = 2F. Per sheet face: 2F.
     - No negative number in a valid job.
     - Every numeric length has a numeric quantity, and vice versa (catches A12, A13, A17, A18, C6).
     - H84 = 2 × H34; H88 = H90; H89 = H91.
     - Invalid scenarios must raise the matching validation error.
7. **Intentional differences** (the only allowed model ≠ workbook):
   - A1–A18.
   - The decided B items.
   - C1–C4 (display normalisation), C6, C7, C12, C13 (V8:V11 = 1).
8. **Sign-off.**
   - Print BLR 94 for LEFT, BACK and RIGHT, and have the owner mark them against his workbook. The hover shows every correction.
   - Then check one real, already-built job against the shop floor: a 2- or 3-landing unit, which also settles B7 and B8.
   - Do not use the BLR 94 sample as RNLBLR-0094's truth.
9. **UI check.** In the preview browser, confirm the rendered grid text equals the model output for BLR 94 × 3 counterweights, and that the print preview fits on the page with its colour bands.

---

## Files
- Latest workbook: `C:\Users\yash_\Downloads\RALPH 400 BOM  (1).xlsx` (copy: `C:\Users\yash_\AppData\Local\Temp\claude\C--Users-yash--OneDrive-Desktop-Factory-ERP\c8d1df8d-42cc-45d0-a508-63a046ecd9b9\scratchpad\ralph\latest.xlsx`; full cell dump `…\scratchpad\ralph\dump.txt`)
- 10 Sep workbook (history): `C:\Users\yash_\Downloads\RALPH 400 BOM .xlsx` (dump `…\scratchpad\ralph\old_dump.txt`)
- Current model: `C:\Users\yash_\OneDrive\Desktop\Factory ERP\src\lib\ralph400\model.ts`
- Current UI: `C:\Users\yash_\OneDrive\Desktop\Factory ERP\src\components\ralph400\ralph400-client.tsx`
- ERP BOM sections for phase 2: `C:\Users\yash_\OneDrive\Desktop\Factory ERP\src\lib\bom\bom-sections.ts` (RAIL, MAIN BRACKET, COUNTER BRACKET, RAIL CLIP, Buffer Channel Main/Counter, Buffer Spring, Buffer Stand, Wire Rope Main/Belt Main, Wire Rope Governor)
- Scratch evaluators (session-only, copy before reuse): `…\scratchpad\ralph\evalwb.py`, `…\scratchpad\ralph\percwt.py`, `…\scratchpad\ralph\diff\xlev.py`, `…\scratchpad\ralph\diff\compare2.py`, `…\scratchpad\ralph\eng\ev.py`


---

# Appendix — completeness critique (apply before building)

6(a) covers every Sheet2 output cell and matches the workbook at every address, apart from the registered A/C fixes (only H53 falls outside the register). That result holds only with the rule switches in their workbook positions. 19 defects found: turning on sillCountOnce, doorHandSelects or lowestSheetH breaks cells; the verification plan fails on its first run; the §2 "red fill = R1" claim is false; and the synthesis leaves out the corrected-workbook copy in the RALPH400_BOM repo.

# Completeness critique of the RALPH 400 rebuild spec, §6(a)

## Verdict

**Coverage is complete and the formulas are correct.** Some parts around them need fixing before build.

**How I checked**
- I listed every populated cell in Sheet2 E8:V92 and matched each one to a §6(a) entry. None is missing. That covers rows 8–11 I–U (V is new), rows 13–15 K–T, rows 17–20 K–V, rows 25–50 G/H/I, rows 54–71 E/H/I, and rows 74–92 G/H.
- I wrote an independent implementation of §6(a) exactly as it is worded, with default RULES. I diffed it against the workbook's own formulas, evaluated literally with `evalwb.py`.
- The grid was 480 scenarios, over every output address: 3 counterweights × F 2–6 × pit 0/100/170/345 × OH 2860/3200 × two shafts (1600×1550 and 1550×1600) × with and without stale rises.
- **Every difference is a registered A- or C-item.** The only unregistered difference is the static header cell H53 ("QTY"), which is a verification-scope issue (defect 3).
- The spec's golden values for BLR 94 LEFT reproduce exactly.
- The formula count (211), the C17 list (16 fragments), the C14 single-space count (44), the C3 and C4 cell lists and the C10 cross-row references all check out against the dump.

**What is still wrong**
- Three rule switches (`sillCountOnce`, `doorHandSelects`, `lowestSheetH`) produce inconsistent or unaddressed cells when turned on.
- The verification plan in §6(d) would fail on its first run.
- The golden check leaves out the two counterweights where most corrections fire.
- There are several factual errors. The biggest: the synthesis ignores the corrected workbook and the third copy of the model in the RALPH400_BOM repo.
- It misses five workbook problems: glass height allowance, lost channel thickness, two meanings of "BRACKET", the pit < 170 raised-sill case, and the purpose of plate 122.

Scratch files, read-only: `C:\Users\yash_\AppData\Local\Temp\claude\C--Users-yash--OneDrive-Desktop-Factory-ERP\c8d1df8d-42cc-45d0-a508-63a046ecd9b9\scratchpad\ralph\critic\spec.py` (the §6(a) implementation) and `...\critic\cmp.py` (the diff harness).

---

## Defects, most severe first

### 1. (High) The corrected-workbook lineage and the third copy of the model are left out (§ Summary, §2, §6(d))

**What the synthesis says**
- "None of those fixes reached your file."
- The ERP's "already applied in the workbook" is "untrue".
- The ERP "fixed about 20" cells.

**What is actually the case**
- Commit `29c9d598` says the owner's edits were merged onto a **corrected workbook in the separate RALPH400_BOM repo**, which carries 88 corrected cells.
- Commit `91d2f75c` says R1 was re-merged onto that corrected copy.
- `SESSION-HANDOFF.md` §0 says: "THREE COPIES OF THE SAME CALCULATION NOW EXIST — the workbook, that repo's `web/model.js`, and this repo's `model.ts`. A change to one must go to all three."
- §4 of the handoff also says the owner keeps a Google Sheets copy that never receives the fixes.
- The model.ts claims are true for that corrected copy and false only for the owner's copy.
- The repo path `E:\Anthropic Access\RAPLH400 BOM\` is **not reachable from this machine** (checked), so it was not compared.

**Corrected text** (§2 and Summary)
> "Your Google Sheets copy never got the fixes. They live in a corrected copy of the workbook in the RALPH400_BOM repo (88 corrected cells, re-merged onto R1 on 29 Sep). Every revision you send therefore starts from the uncorrected lineage. model.ts's 'already applied in the workbook' refers to that corrected copy."

**Add a §6(d) step 0**
> "Get the R1-merged corrected workbook and `web/model.js` from RALPH400_BOM (GitHub KCodesbabinmaj/RALPH400_BOM). Diff latest.xlsx against it cell by cell.
> - Anything present only in latest.xlsx is a post-R1 owner change. G75, B18, B58:B64 and the C17 whitespace are expected.
> - Every corrected cell in that copy must appear in the corrections register, or be dropped on purpose. For example, its 89 height-gated level cells are replaced by A15.
>
> Decide the fate of copy #3: retire `web/model.js` and the corrected workbook (leave a README pointing to /ralph400), or regenerate that workbook from `corrections.ts`. Until that is decided, the handoff's 'change all three' rule binds this rebuild."

### 2. (Medium) The 1062 split rows (B7, decision 11) have no sheet address

§6(a) says: "Key every output by its sheet address". The oracle compares by address, and the xlsx export writes "at the same cell addresses as Sheet2". The split "…1062MM (1ST)" rows under rows 69–71 have no address, so none of the three can represent them. `RULES.lowestSheetH` is declared but no cell in §6(a) reads it.

**Corrected text** (after the console table)
> "If `lowestSheetH` ≠ 1090:
> - H69/H70/H71 become 2F−1 on the sheet face (the 1090 panes).
> - The lowest pane is emitted at synthetic addresses `H69x/I69x`, `H70x/I70x`, `H71x/I71x`: qty 1 on the sheet face, else NO; I = the width. Its height (`lowestSheetH`) is carried as metadata.
> - The x rows are rendered as a sub-row under 69/70/71, registered in DIFF_REGISTER as ADDED, and exported only on the Corrections sheet. The Sheet2-layout sheet keeps H69:H71 = 2F−1 with a note.
>
> Store the pane heights for rows 62–71 (1098/1128/1090) as named metadata constants, not as addresses."

### 3. (Medium) The §6(d) normaliser and label scope make assertions (a) and (b) fail on the first run

**The problem**
- Assertion (a) compares "every address in E3:V92".
- The normaliser only trims strings.
- **31 label cells have internal runs of spaces**, which trimming does not collapse: F8:F11, F19, F25, F27, F28, F29, F34, F35, E44, F46:F50, F62:F65, F67, F69:F71, F74, F76, F78, F80, F83, F84. Example: `'HZ CH  COVER  RIGHT 170'`.
- The spec's own descriptions are the cleaned forms.
- Static header cells in the range (H53, E53, F53, E44, E54:E57, K12:T12) are not in §6(a)'s output record. My diff flagged H53 on every scenario.

**Corrected text** (§6(d) item 4)
> "Collapse every whitespace run to one space, then trim, for both labels and values. Compare static label cells (D53, E44, E53:E57, F8:F92, H53, K12:T12) in a separate 'labels' assertion, so that a relabel (C12, F70) is visible but never hides a value difference. The model's record includes those label cells."

### 4. (Medium) DIFF_REGISTER contradicts the normaliser, and T13 is registered too narrowly (§6(d) items 6(b) and 7)

**The problem**
- §6(d) item 7 lists "C1–C4 (display normalisation)" as intentional differences.
- But the normaliser absorbs C1 (H29, H31, H39, H40, H41 text), C2 (M15, I65, I71), C3 and C4 before comparison, so they can never "fire".
- The stale-entry rule in 6(b) ("no registered item may fail to fire") then fails.
- C4 and C5 (blank C15) are unreachable in the grid anyway.
- A8 says the T13 correction affects "6-landing BACK/RIGHT". In fact T13 differs in **every** scenario: the workbook cell is blank, and the corrected cell is "NO" for LEFT and for levels that don't exist.

**Corrected text**
> "DIFF_REGISTER holds only items that change a value: A1–A18, C6 (I31, I45, I47, I49), C7 (G37), C12 (F70), C13 (V8:V11, U12:V12) and the decided B items. The normalised items C1–C4 go in a separate NORMALISED list that 6(b) does not require to fire. C5 is excluded as unreachable. T13 (A8) is registered unconditionally."

### 5. (Medium) Missed workbook problem: the glass height allowance is inconsistent, and B7 miscounts it

**The problem**
- Every glass **width** is opening +35 (D−165, W−165).
- Extension glass **height**, rows 13–15, is (ext−135)+35.
- But the console panes are 1128 = 1090 + **38**, and 1098 = 1062 + **36**.
- 1128 − 1098 = **30**, not the 28 mm bay difference that B7 cites ("glass uses 1098 instead of 1128").
- Sheet1 (K7, K8, K13) uses 1101/1129 (+39) and 1126 (+36).
- §1.3 rates both "+35 … high" and "1098/1128 … high", but they cannot both be right. Toughened glass cannot be trimmed on site.

**Corrected text: new B9**
> "Rows 62–67 pane heights (F62:F67 text): 1128 is +38 over the 1090 bay, 1098 is +36 over the 1062 bay, and the extension glass (K13:S15) is +35. Which height allowance is right: 35, 36 or 38? The rebuild keeps 1098/1128 until you answer."

Also correct B7 to "1098 vs 1128 (30 mm)". Add to §5: "19. Glass height allowance over the opening: 35 / 36 / 38?"

### 6. (Medium) "The red fills mark exactly the R1 cells" is false (§2 last paragraph, §6(b) legend)

**Evidence.** Comparing the pre-R1 model (commit `29c9d598`) with latest.xlsx shows these R1 edits have **no red fill**:
- Row 50 (HZ 2ND LAST CHANNEL 135 MM BACK) is a new row.
- F44, F46 and F48 were renamed (pre-R1 read "135X1.5MM LEFT", "135X3 MM RIGHT", "135X1.5MM FRONT").
- H32 changed from 3F to 3F−1.
- G35 is new.
- I26 gained +40 on both branches (only F26 is red).

**Corrected text**
> §2: "The red fills mark most of the R1 edits, but not row 50, F44/F46/F48, H32, G35 or I26."

> §6(b): legend "red = highlighted by the owner", with no claim that it is complete.

### 7. (Low–Med) Row 27 with `sillCountOnce` leaves a length with no quantity

As written, H27 becomes NO but I27 stays W−200. That breaks the spec's own invariant "every numeric length has a numeric quantity". I confirmed this by running it.

**Corrected row**
> "27 | HZ SILL CHANNEL 142 | — | F, or NO if sillCountOnce | W−200, or NO if sillCountOnce"

### 8. (Low–Med) The door-hand rules leave the G74 tag on a "NO" row, and hand parsing is underspecified

**The problem**
- With `doorHandSelects` and an L opening, H74:H76 become NO, but G74 still shows the opening (confirmed).
- "Ends in R / contains L / contains CO" does not trim first. The workbook fragment `"AT 700 L "` has a trailing space.
- It also defines no fallback for legacy "700 R" or "(not in list)" values.

**Corrected text**
> "G74 = opening when rows 74–76 ship. G78 = opening when only rows 78–80 ship.
> Hand parsing: trim and uppercase the opening, then:
> - contains 'CO' → CO;
> - otherwise match `/(\d+)\s*([RL])\b/` and take R or L;
> - otherwise UNKNOWN: ship both sets and show a warning."

### 9. (Low–Med) RULES has no switch for B4, B5 or B8, although §3B says "each one is a one-line switch"

**Corrected text: add to RULES**
```ts
sideChannel135Qty: "3F-1" // | "3F-2"  — B8: H32, H33, H34, H35:H38; H84 = 2 × H34
ohCladFaces:       "ALL"  // | "CWT"   — B4: U17:V19; U20:V20 follows frontClad
ohPanelOffset:     2592   //           — B5: U17:U20 = OH − ohPanelOffset; validation OH > ohPanelOffset
```

### 10. (Low) Invariant (c), "every numeric length has a numeric quantity, and vice versa", is unscoped

**The problem**
- Hardware rows 74–92 have a quantity but no length. That is 16 numeric quantities that fail as written (confirmed).
- Panel rows 13–20 have no quantity column at all.

**Corrected text**
> "Applies to I/J, K/L … S/T and U/V in rows 8–11, and to H/I in rows 25–71. In rows 13–20, the H and W of each pair are both numeric or both NO."

### 11. (Low) The golden check covers only LEFT and a subset of rows

BACK is where A1–A5 and A9–A14 fire, and RIGHT is where A7 and C7 fire. Both are missing.

**Add to the golden table** (BLR 94: W1600, D1550, pit 0, OH 2860, F4, rises 3720/3295/3365, corrected, default RULES)

**Rows common to all three counterweights**
| Rows | Values |
|---|---|
| 8–11 | I 74.5, J 1, K 1100, L 1, M 845, N 1, O 915, P 1, Q–T NO, U 447.5, V 1 |
| 27 | 4 × 1400 |
| 54–57 | 4 × 2450 |
| 61 | 4 × 1400 |
| 74–92 | 4, 4, 4, 4, 4, 4, 4, 2, 22, 32, 32, 208, 812, 208, 812, 4 |

**LEFT: rows missing from the current golden**
| Row | Value | Workbook gives |
|---|---|---|
| 13 | NO | |
| 25 | BRACKET 1 × 1350 | |
| 26 | NO / NO / NO | |
| 28 | 1 × 1350 | |
| 29 | 1 × 1390 | 1350 (A10) |
| 30 | 1 × 1400 | |
| 31 | 1 × 1440 | |
| 32, 33 | 11 × 1400, 11 × 1440 | |
| 35, 36 | BRACKET/NO/NO, NO/NO/NO | |
| 37, 38 | 11 × 1350, 11 × 1390 | |
| 39 | BRACKET 1 × 1350 | |
| 40, 41, 42 | 1 × 1350, 1 × 1400, 1 × 1400 | |
| 44 | BRACKET 1 × 1350 | |
| 45 | NO/NO/NO | 1390 with qty NO (C6) |
| 46, 47, 48, 49, 50 | 1 × 1350, 1 × 1390, 1 × 1400, 1 × 1440, 1 × 1400 | |

**BACK**
| Row(s) | Value | Workbook gives |
|---|---|---|
| 13, 14 | 1000×1385, 745×1385, 815×1385 | |
| 15 | NO | |
| 17, 18 | levels NO; OH 268×1350 | |
| 19 | 965×1400, 710×1400, 780×1400; OH 268×1400 | L19 1465 (A5) |
| 20 | 965×1400, 710×1400, 780×1400; OH 268×1400 | L20/N20/P20 1350 (A4) |
| 25 | 1 × 1350 | |
| 26 | 1 × 1390 | 1440 (A9) |
| 28 | 1 × 1350 | |
| 29 | 1 × 1390 | 1440 (A10) |
| 30 | BRACKET 1 × 1400 | tag blank (A14) |
| 31 | NO/NO/NO | length 1440 (C6) |
| 32 | BRACKET NO/NO | |
| 33 | NO/NO/NO | H32/H33 #VALUE! (A1) |
| 34 | BACK 11 × 1400 | |
| 35, 36, 37, 38 | 11×1350, 11×1390, 11×1350, 11×1390 | |
| 39 | 1 × 1350 | 1400 (A11) |
| 40 | 1 × 1350 | |
| 41 | BRACKET 1 × 1400 | length NO (A12) |
| 42 | 1 × 1400 | length NO (A13) |
| 44, 45, 46, 47, 48 | 1×1350, 1×1390, 1×1350, 1×1390, 1×1400 | |
| 49 | NO/NO/NO | length 1440 (C6) |
| 50 | BRACKET 1 × 1400 | |
| 62 | NO | qty 1 (A17) |
| 63, 64 | 1 × 1385, 1 × 1385 | |
| 65, 66 | 7 × 1385, 7 × 1385 | |
| 67 | NO | qty 7 (A17) |
| 69 | NO | 8 × "GLASS" (A18) |
| 70 | NO | qty 8 (A17) |
| 71 | 8 × 1400 | |

**RIGHT**
| Row(s) | Value | Workbook gives |
|---|---|---|
| 13 | 1000×1385, 745×1385, 815×1385 | |
| 14 | NO | |
| 15 | 1000×1435, 745×1435, 815×1435 | N15 NO (A7) |
| 17 | levels NO; OH 268×1350 | |
| 18 | 965×1350, 710×1350, 780×1350; OH 268×1350 | |
| 19, 20 | levels NO; OH 268×1400 | |
| 25, 26 | 1 × 1350, 1 × 1390 | |
| 28 | BRACKET 1 × 1350 | |
| 29 | NO/NO/NO | |
| 30, 31 | 1 × 1400, 1 × 1440 | |
| 32, 33 | 11 × 1400, 11 × 1440 | |
| 34 | RIGHT 11 × 1350 | |
| 35, 36 | 11 × 1350, 11 × 1390 | |
| 37 | BRACKET NO/NO | tag blank (C7) |
| 38 | NO/NO/NO | |
| 39 | 1 × 1350 | |
| 40 | BRACKET 1 × 1350 | |
| 41, 42 | 1 × 1400, 1 × 1400 | |
| 44, 45 | 1 × 1350, 1 × 1390 | |
| 46 | BRACKET 1 × 1350 | |
| 47 | NO/NO/NO | length 1390 (C6) |
| 48, 49, 50 | 1 × 1400, 1 × 1440, 1 × 1400 | |
| 62, 63 | 1 × 1435, 1 × 1385 | |
| 64 | NO | qty 1 (A17) |
| 65 | 7 × 1385 | |
| 66 | NO | qty 7 (A17) |
| 67 | 7 × 1435 | |
| 69 | NO | 8 × "GLASS" (A18) |
| 70 | 8 × 1350 | |
| 71 | NO | qty 8 (A17) |

### 12. (Low) The A15 example and the Summary misstate the workbook
- T8:T11 = C8 = **4** on BLR 94, not "qty 1".
- S14 and S15 (−2585) are missing from the list.
- The phantom widths on levels that don't exist are positive: R14 1385, T14 1385, R15 1435, T15 1465, R17 1350, T17 1350.

**Corrected text for A15's effect**
> "BLR 94: Q8:Q11 −2450 and S8:S11 −2485, with R 1 and T **4**; Q14/Q15 −2550 and S14/S15 −2585; Q17 −2585 and S17 −2620; plus positive widths R14/T14 1385, R15 1435, T15 1465, R17/T17 1350 on levels that don't exist."

In the Summary, change "with quantity 1" to "with a quantity (1, or C8 in T8:T11)".

### 13. (Low) Missed: "BRACKET" in column G has two meanings (§1.5, UI)
- On G25, G28, G30, G39:G41, G44, G46 and G50, the row itself is cut as the bracket version. Its quantity and length stay.
- On G32, G35 and G37 (after the C7 correction), the row's own H and I read NO. There "BRACKET" means "replaced by row 34 (HZ BRACKET CHANNEL 135)".
- §1.5 describes only the first meaning. The UI would put a BRACKET tag next to NO/NO.

**Corrected text**
> "On G32/G35/G37 the flag means this row is replaced by row 34. Render it as '→ row 34'."

### 14. (Low) Missed: R1 dropped the channel thickness from F44/F46/F48 (and new F50)
- Pre-R1 names were LEFT 135×1.5, RIGHT 135×**3**, FRONT 135×1.5.
- Every other channel row still states its gauge.

**Add to §5**
> "20. Gauge of the 2nd-last channels (rows 44–50): 1.5 mm plain and 3 mm where G = BRACKET?"

### 15. (Low) The pit < 170 warning is worded wrongly, and one §1.3 claim is over-confident
- When P < 170, the GND module base sits at ground floor + (102.5 − P) instead of −67.5. That means the **GND door sill is raised (170 − P) mm above the ground landing**; for P = 0 that is 170 mm. "Sits above the pit floor" is always true and says nothing.
- In §1.3, "67.5 … the channel's top face is flush with the landing floor (high)" does not follow. The module base is 67.5 below each landing, which puts a 135 channel's centre line at floor level.

**Corrected text (§6(c))**
> "P < 170: the GND module, and its door sill, sit (170 − P) mm higher relative to the ground landing; K8 is shortened by the same amount. Confirm a raised landing or ramp."

In §1.3, downgrade the 67.5 claim to "medium: module base 67.5 below each landing".

### 16. (Low) A12 and A13 are not "new"
`SESSION-HANDOFF.md` §4 already records H41/I41 and H42/I42 as a known open defect, parked with "Ask before widening". A13 has two possible fixes: H42 → NO, or I42 → W−200. Choosing between them is an owner call.

**Corrected text**
> Drop "new" from A12 and A13, and add to §5: "Does the front top channel (row 42) exist on BACK-counterweight jobs? **YES**"

### 17. (Low) Grid additions sit inside the compared range without being registered, and V8:V11 has no QTY label
- The row-24 sub-header ("COMMON · QTY · LENGTH") lands in E3:V92 but is not in the register.
- V8:V11 = 1 sits under the merged "OVER HEAD" header (U2:V2), which has no QTY word, while V17:V20 is a width.

**Corrected text**
> "The row-24 sub-header is UI-only: not in the model record and not in the xlsx export. The grid labels V as QTY for rows 8–11 and W for rows 17–20."

Also add rows 16 and 21–23 to the spacer list in §6(b).

### 18. (Low) Validation gaps (§6(c))
- There is no practical-minimum warning for the overhead panel. U17 = OH − 2592 can be 1 mm and still pass.
- There is no warning for a very large OH (the overhead panel or overhead vertical getting beyond stock sizes).

**Add**
> "Warn if OH − 2592 is below the owner's minimum panel height, or if U8 or U17 exceed the owner's stock-length limits."

### 19. (Info) Open question the synthesis missed: plate 122
H83 (BRACKET FIXING PLATE 122) is a flat 2. H84 (plate 124) is 2 per 135 bracket channel (6F−2 = 2 × H34). On the counterweight face, the 170 base, the 2nd-last and the top channels are also bracket versions: 3 channels.

**Add to §5**
> "21. Which bracket channel(s) does plate 122 serve? Is a flat 2 correct?"

---

## Confirmed correct (no change needed)
- **§6(a) formulas:** rows 8–11, the panel rules for rows 13–20 including U/V, all 25 channel rows, rows 54–71, rows 74–92, the derived values (ext, pitStub, ohVert, ohPanel) and the `live(k)` gate.
- **A-list:** A1–A18 cell references and effects.
- **C-list:** the C3 list (G25, G26, G29–G31, G33, G35, G36, G38–G41, G44:G50), the C4 list, the C6 list and the C10 references.
- **History claims** checked against old_dump:
  - T15 and N15-RIGHT go back to the original file.
  - Old I61/I62 were "GLASS".
  - Rows 27 and 61 are both in the original file.
  - H89/H91 were 406F in the 10 Sep copy, and 203F since the first ERP port.
  - U8 used +95.5 in the 10 Sep copy, and +67.5 since the first ERP port.
- **Post-stack invariant:** −58, or −93 when the 4RT column is used.
- **Scenario count:** 10,500.