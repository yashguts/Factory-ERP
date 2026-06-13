# AI Drawing → BOM Rulebook (Elevator Job Auto-Builder)

The complete, evidence-based rulebook for turning an elevator GA drawing + stored
job spec into a job BOM. Synthesized from per-job study files under
`scripts/_study/*.json`. This document is the single reference for the auto-builder:
what sections each drive type carries, how item names are recomposed from spec,
how quantities scale, and where the data lies to you.

**Read this first — the honest framing.** Most rules here are derived from real
job BOMs, but the evidence is *uneven across drive types*. MR/MRL/HOME rest on
double-digit job counts and are reasonably firm; HYD and the belt/MRL-belt
variants rest on **a single job each** and are provisional. The data model itself
is lossy in three load-bearing ways (UoM not stored, capacity stored as a coarse
class, `drive_type` overloaded) — §5 details the gates that must run before any
auto-built BOM is trusted. Section §6 states bluntly which rules are safe to ship
deterministically now.

---

## 0 — Evidence base (jobs studied, per drive type)

| Drive type | Jobs studied | Confidence | Notes |
|---|---|---|---|
| **MRL** (machine-room-less, roped) | 60 | **High** | Passenger + goods; the `/MRL` machine-beam token is the discriminator. |
| **MR** (machine-room geared traction) | 16 | **High** | 4571, 4734, 4789, 4798, 4814, 4875, 4876, 4899, 4900, 4931, 4983, 5001, BBSR308, BBSR313, JHK114, JHK115. |
| **HOME** (bungalow / villa roped lift) | 24 | **High** | All `capacity=4PASS`; 22 rope + 1 belt variant (RNLKOL-0040) + 1 empty-BOM (4411). |
| **BELT** (flat-traction MRL) | 8 | **Medium** | 7 RICARDO home-belt + 1 MRL passenger (CH-010). `BELT` conflates two size classes. |
| **MRL-BELT / BELT-MRL** (gearless + rope→belt amendment) | 3 distinct samples (CH-011, MP-006, MP-007) | **Low (n≈1 each)** | All from one 14-lift batch GA. Treat as one effective sample with three transcriptions. |
| **HYD** (hydraulic) | 1 (RNLKEL0018) | **Very low (n=1)** | And the one job has *no power pack/jack* line — itself an anomaly. |

**Total distinct jobs informing this rulebook: ~110** (the `_study` folder holds
112 JSON files; some are partial/stub BOMs that inform the data-quality gates more
than the quantity rules).

**Critical cross-cutting caveat:** `drive_type` is an overloaded enum that
conflates *machine-room architecture* (MR vs MRL) with *suspension medium* (rope
vs BELT) and *product family* (HOME). Several jobs are mis-stored (`CANTI`, `MR`,
plain `MRL` on a physically-MR goods lift). **The BOM item names — not the
`drive_type` field — are the ground truth.** Every classification rule below keys
off item-name tokens, never the stored enum alone.

---

# PART 1 — Cross-cutting rules (hold across ALL drive types)

These are the rules that recur across every drive family studied. Support counts
are the number of drive families (and representative jobs) confirming each.

## 1.1 — Landing-side door quantity = served-landing count `L`

**Rule:** for every drive type, each of these is `qty = L`, where `L` = number of
*served landing openings* (NOT the stored `stops` integer — see §5.3):
- `Landing Door Panel`
- `Landing Header System`
- `Door Post / Frame`
- `Linton Panel`
- `Auto Door Sill Angle` (the sill angle, distinct from the finished aluminium sill)
- `MAGNET WITH BRACKET` (where present)
- `Gate Lock` (collapsible / swing / MT door jobs only)

**Support: all 5 drive families with door-complete BOMs** — MRL (4620 L=6, 4838
L=4, 4869 L=7, BHT-012 L=7, RNLKEL-0034 L=3), MR (4734 L=5, 4571 L=6, 4931 L=7,
4899/4900 L=8, 4814 L=4), HOME (stops 2→qty 2 … stops 6→qty 6, ~20 jobs), BELT
(RNLKEL-0041 L=3, RNLNAG0009/0011 L=4, RNLNAG0010 L=2-served, CH-010 L=2), HYD
(RNLKEL0018 L=3). **This is the single strongest and most reliable rule in the
whole rulebook.**

## 1.2 — Finished aluminium sill = `L + 1` (landings + one car sill)

**Rule:** the finished sill extrusion (`Alluminium Sill …`) = `L + 1`. The car
gets its own sill on top of the per-landing sills.

**Support: MRL, MR, HOME, BELT** — MRL (4869 7→8, BHT-012 7→8), MR (4571 6→7,
4931 7→8, 4814 4→5 collapsible gates), HOME (4919 3→4, HMP001 3→4, RNLHYD0098
4→5, RNLCHA0064 3→4), BELT (RNLKEL-0041 3→4, RNLNAG0009 4→5, RNLIND0014 3→4).
Watch: RNLCHA-0026 shows 7 for stops 5 (flagged over-count); collapsible jobs put
the +1 on the `Collapsible Gate` (car gate = `L+1`).

## 1.3 — Door-token propagation (one door code, stamped on every door part)

**Rule:** the drawing's door spec is composed once and propagated *verbatim*
across **Car Panel, Landing Panel, Car Header, Landing Header, Door Post, Linton,
Sill (angle + aluminium)**. The token grammar (see §3.2):
`<operation>/<finish>/<vision>/<opening>(<finish-name>)` + optional handing
`LHS|RHS`.

**Support: all drive families.** Examples: `Car Pannel CO/SS/MV/700(STD)` →
`Landing Pannel CO/SS/MV/700/2000` → `Car Header System CO 700mm` →
`Auto Door Linton Pannel CO SS/700mm` → `Auto Door Sill Angle CO 700mm`
(MR 4571). The handing (`LHS`/`RHS`) must agree across Car Header + Landing
Header + Door Post (HYD RNLKEL0018 enforces uniform LHS).

## 1.4 — Dual DBG (car-side DBG ≠ counter-side DBG, both keyed off the GA)

**Rule:** the GA hoistway plan gives **two** DBG (Distance-Between-Guides) values
that propagate into part-variant suffixes. Never assume one DBG per job:
- **Counter / well DBG** → `Counter Weight Frame … DBG-<x>mm`, `Counter Guard Net
  DBG-<x>`, `Buffer Mounting Channel Counter … DBG-<x>`, `Filler Weight … DBG-<x>/…`,
  `Machine Beam … DBG-<x>x{50|65}`.
- **Car / safety DBG** → `Safety Frame … DBG-<y>`; the main buffer channel
  *brackets* it as a range (`DBG-1192-1292` for 1242).

**Support: MRL, MR, HOME, BELT, MRL-BELT, HYD.** The counter DBG is typically a
nominal/standard-size pick one step up from the car DBG (HOME car 720/cwt 750;
MR car 1242/cwt 1050; MRL-BELT car 1642/counter 1050). This staggering is
**legitimate, not a transcription error** (§5.5).

## 1.5 — Rail dimension reorder (drawing `A×B×thk` → BOM `thk×B×A`)

**Rule:** the title-block rail profile maps to a `Guide Rail <thk>X<base>X<head>`
SKU with the **axis order reversed**. Drawing `89×62×16` → `Guide Rail 16X62X89`;
drawing `70×65×9` → `Guide Rail 9X65X70`.

**Support: MRL, MR, BELT, MRL-BELT, HYD.** Counterweighted jobs carry **two**
profiles: a heavier car rail + a lighter counter rail, in equal counts
(HOME: `9X65X70` car + `5X45X45` counter; MR passenger same; MRL-BELT/heavy:
`16X62X89` car + `9X65X70` counter).

## 1.6 — The governor is ALWAYS roped, even on belt lifts

**Rule:** the speed governor uses **steel wire rope (8 mm)** in every job,
including belt-suspension lifts. On BELT/MRL-BELT jobs the *main suspension*
became a flat belt but the **governor rope stayed steel** — so a belt job shows
`Traction Belt (Flat)` under `Wire Rope Main` **and** `Wire Rope 8mm` under
`Wire Rope Governor`. This coexistence is a positive discriminator: belt-main +
wire-governor = belt drive; never belt-governor.

**Support: all drive families with a governor** (MRL, MR, HOME, BELT, MRL-BELT;
HYD also carries a Speed Governor). HOME hoist rope is 6 mm, governor 8 mm.

## 1.7 — Capacity → Machine-Unit token (capacity sizes the *variant*, not the count)

**Rule:** rated capacity is encoded as a token inside the `Machine Unit` name, not
as a line quantity. It selects which machine/safety-frame/filler variant to pick:
- HOME: `Machine Unit 4 pass/200mm/4g/6mm/Home` (invariant across all 22 rope
  HOME jobs).
- MR/MRL passenger: `Machine Unit 6 pass/320mm/4g/8mm` (a *machine-size class*,
  NOT the passenger count — 5-pass jobs still say "6 pass").
- Goods: capacity named in kg — `Machine Unit 4000KG/320mm/11g/8mm 4:1`,
  `Machine Unit 2500kg/320mm/9g/8mm/2.0 m/s`.
- Belt: `Machine Unit Belt 20 Pass/6.8 KW/1.0M/S`.

The same capacity also drives **`Filler Weight` count** (counterweight balance ≈
car deadweight + ~50% rated load ÷ block mass) and the rope/groove count.

**Support: all drive families.**

## 1.8 — Buffer-type token

**Rule:** the buffer family is a per-job config token, fixed by car/counter
pairing, NOT by stops:
- **Spring buffer set** (MR, MRL-BELT, MRL goods): `Buffer Spring` ×2 standard
  (1 car + 1 counter), ×4 on goods/heavy; `Buffer Stand` Main + Counter; `Buffer
  Channel Main` + `Buffer Channel Counter`.
- HOME carries only the **`Buffer Mounting Channel Combination`** (the spring/oil
  buffer itself is not a HOME line item).
- **No oil/hydraulic buffer** appears on any traction or belt job — spring buffers
  only.

**Support: MR, MRL, MRL-BELT, HOME, BELT.**

## 1.9 — Universal "same SKU, two categories" pattern

**Rule:** several items legitimately appear under two `category` strings with the
same `item_id`. MRP must sum by `item_id` (correct) but per-category reports will
under/double-count:
- `Pulley Main` and `Pulley Counter` = the **identical** pulley SKU (drive +
  deflector roles). All counterweighted drives.
- `Wire Rope 8mm` under both `Wire Rope Main` (where it's the hoist rope) and
  `Wire Rope Governor`.

**Support: MRL, HOME, MR, BELT.** Never de-dup by item name — the role split lives
only in the `category` string.

## 1.10 — Sections that NEVER appear in any job BOM (tracked elsewhere — not gaps)

Across every drive type, these are **expected-absent** and must not be flagged as
incomplete:
- Controller / V3F control-panel **unit** (only the `Controller Bracket`/stand is
  a line), COP, LOP, ARD, IR door screen, floor announcer, overload indicator,
  travelling cable, door operator/motor.
- Cabin shell / wall / ceiling panels — handled in the separate **Cabin Jobs**
  module. Only `CABIN GLASS` panes appear (when the cabin has side glass), plus
  `Cabin Rubber Pad`, `FAN GRILL`, `FLOOR TILES`.
- Car sling/frame and guide shoes as discrete lines (likely bundled inside Safety
  Frame / Counter Frame).
- Owner-supplied items (hoisting hook, GI earthing wire) — correctly excluded.

**Support: all drive families.** This is confirmed in CLAUDE.md §3 (cabin/
electrical scope is out-of-BOM by design).

---

# PART 2 — Per-drive-type sections

Each section follows the same structure: (a) sections always/never present,
(b) item-naming token logic, (c) quantity rules, (d) signature items, (e) gotchas.

---

## 2.1 — MRL (Machine-Room-Less, roped traction) — **60 jobs, High confidence**

MRL = machine-room-less roped traction: machine on a beam at the top of the
hoistway, controller bracket at the top floor (300×250×1500), counterweighted,
roped (2:1 passenger, 4:1 goods). It is a **drive system, not a door/cabin
attribute.** The `drive_type` field is sometimes mis-populated (`CANTI` on 4809,
`MR` on RNLKOL-0024) — trust the `/MRL` token.

### (a) BOM sections — always / never

**ALWAYS present (the MRL "spine"):**
- `Machine` — `Machine Unit <N> pass/<sheave>mm/<grooves>g/<rope>mm` ×1
- `Machine Beam` — `Machine Beam R1 DBG-<cwtDBG>x{50|65}/MRL` ×1 — **the signature
  line; `/MRL` suffix is the discriminator**
- `CONT. STAND` — `Controller Bracket MRL` ×1 (not a floor-standing controller stand)
- `Counter Frame` — `Counter Weight Frame MRL DBG-<cwtDBG>mm` ×1; `Counter Guard
  Net DBG-<cwtDBG>` ×1; `Filler Weight … DBG-<cwtDBG>/…`
- `Pulley Main` ×2 + `Pulley Counter` ×1 (deflector/diverter sheaves for 2:1
  roping; goods 4:1 scale up — see §c)
- `Wire Rope Main` + `Wire Rope Governor` (8 mm, two lines, same SKU)
- `Governor` (`Speed Governor <speed>mts R1`), `Safety` (`Safety Frame R1
  DBG-<carDBG>`), `STA. CAM`, `Safety Tips Plate`, `D-SHACKLE`, `I-Bolt with Spring`
- `Buffer Channel Main` + `Buffer Channel Counter`, `Buffer Stand` (Main + Counter),
  `Buffer Spring`
- `RAIL` (two profiles), `MAIN BRACKET`, `RAIL CLIP`, `Stud Anchor`
- Door group (sized to door type), `LIMIT SWITCH` + `LIMIT SWITCH BRACKET`,
  `MAGNET WITH BRACKET`, `HOME SAFETY SWITCH`, `SAFETY/CAR GATE SWT.` (Limit Switch LSR)
- `TROUGHING 50` + `TROUGHING 100`, `PVC CABLE HANGER`, `PIT SWITCH`, `Pit Ladder`,
  `OIL POT`, `Mobil T-40`, `Grease 200grm`, `Danger Plate`, `FAN GRILL`, `Cabin
  Rubber Pad`, `FLOOR TILES`

**NEVER on an MRL job:** no separate machine-room beam / MR-floor structure (the
`/MRL` machine beam replaces it). A genuine MR/geared job carries a non-`/MRL`
machine beam + a floor-standing controller stand; MRL never does.

**Goods MRL only** (capacity in kg, 1000–4000 KG): adds `CHEQUERED PLATE` (MS car
floor), AFF/AT `Door Post/Frame` + `Linton Panel` + `Door Sill`, `FIREMAN SWITCH`,
`REED CHANNEL` (heavy), and switches everything to `…Goods` variants (Buffer
Spring Goods, Counter Frame Goods, Safety Frame Goods, Rail Clip Goods, Magnet
Bracket MRL GOODS, Limit Switch Bkt GOODS). Uses `Rail Bracket Combination
Home(Adj Leg)/(Leg)` brackets (4661/4662/4890/4938/4964).

**CPWD / railway MRL** (ANDH###, BBSR-314, RNL*): adds a `BRICK` category
(`Brick Dasfastner+Nut+S.W+F.W 12X100/150 + 8x75`) for brick-wall fixings;
gearless PMSM machine; aluminium chequered car floor (`ALLUMINUIM CHEQUERED PLATE
2MM` ~1.5).

### (b) Token logic
- **Drive token:** `/MRL` on Machine Beam, `MRL` on Counter Weight Frame +
  Controller Bracket. Presence of `/MRL` ⇒ drive_type = MRL (high confidence).
- **Door tokens:** `TYPE/FINISH/VISION/OPENING(finish)` — `CO` (centre opening),
  `AT` (auto telescopic), `MT` (manual telescopic), `SO` (on Door Post for
  side-opening AT), Collapsible (`Collapsible Gate N+1Channel` etc.). FINISH `SS`/
  `MS` + designer finish in parens (`(Rose Gold)`, `(Golden)`). VISION `MV`/`LV`/`NV`.
  OPENING `700/800/900/1000` (goods `1400/1600`).
- **DBG token:** counter DBG → frame/guard/filler/beam; car DBG → safety/main-buffer.
  Counter seen: 620,710,850,1050,1550,2050. Car seen: 912…2672.
- **Rail/sheave:** `Guide Rail <thk>X<base>X<head>`; machine groove count = pulley
  groove count = number of suspension ropes; rope dia = pulley groove dia (8 mm).
  Machine sheave 320 vs deflector pulley 300 is intentional.
- **Capacity token ≠ passenger count:** `6 pass` is a winding-machine size code.

### (c) Quantity rules
- **Scales with stops `N`:** Landing Panel = Landing Header = Door Post = Sill Angle
  = Linton = Magnet Bracket = `N`. Collapsible: car gate = `N+1`.
- **`N+1`:** aluminium sill, floor tiles (often).
- **Fixed at 1 (car-side/single-machine):** Car Door Panel, Car Header, Machine,
  Machine Beam, Controller Bracket, Counter Frame, Counter Guard Net, Governor,
  Safety, STA. CAM, Pit Ladder, Grease, Danger Plate, Safety Tips Plate.
- **Fixed regardless of stops (terminal set):** `Final Limit Switch N/C` = **6** +
  `Limit Switch Bkt STD` = **6** (the single most consistent fixed quantity — do
  NOT scale with stops). HOME SAFETY SWITCH = 1 (occ. 2); LSR = 1 (goods/4:1: 2–4);
  PIT SWITCH = 2; OIL POT = 2; PVC CABLE HANGER = 4; Buffer Spring = 2 standard / 4
  goods.
- **Scales with travel/bracket-spacing (not stops):** RAIL lengths ≈ ceil(travel /
  rail length) per profile; MAIN BRACKET / RAIL CLIP / Bull Dog Clip / Stud Anchor
  ≈ bracket-level count (travel ÷ 1800 mm × rail lines). Rope (metres) ≈ ~10× travel
  for 2:1, much higher for 4:1 goods.
- **Scales with capacity:** Machine rating, Filler Weight count (408 kg→14; 884→17;
  1088→15 MS+6 CI; 2000–4000 KG→34/54/68), pulley groove/rope count, rail profile.

### (d) Signature items
1. `Machine Beam R1 DBG-<x>x{50|65}/MRL` — the defining line.
2. `Controller Bracket MRL` (cat `CONT. STAND`).
3. `Counter Weight Frame MRL DBG-<x>mm`.
4. `Magnet Bracket MRL GOODS` (goods).
5. Deflector pattern `Pulley Main ×2 + Pulley Counter ×1` (2:1); goods 4:1 scale up.

### (e) Gotchas
- `drive_type` unreliable — trust `/MRL`. Stored `capacity` lossy (`6PASS` default,
  kg never stored). Stops off-by-one on `+R`/basement jobs (count Roof/Base as
  served). UoM not stored (rope = metres). Same SKU under two categories. `LIMIT
  SWITCH BRACKET` mis-mapped to switch SKU on goods (4853/4854/4977/91a6c6c8).
  Buffer-Channel-Main SKU reused under Counter category on some goods. Incomplete/
  stub BOMs common (4613=1 line, etc.) — don't infer "MRL never has rails." DB
  typos load-bearing (`Pannel`, `Alluminium`, `Grove`, `Dasfastner`, `Read Channel`,
  `Lilen`).

---

## 2.2 — MR (Machine-Room geared traction) — **16 jobs, High confidence**

MR = geared traction with a *dedicated machine room* (drawing always has a
"MACHINE ROOM PLAN" sheet, a `Machine Unit`, a `Speed Governor`, a counterweight).
Spans 4–8 stops, 6PASS→8PASS passenger and 2500–4000 KG goods, four door families
(CO auto, Manual-Telescopic, Collapsible, AFF goods).

### (a) Sections — always / never
**ALWAYS (MR traction signature):** `Machine` (geared `Machine Unit … (STELLAR)`)
×1 — the strongest MR signal; `Governor` ×1 (×2 heavy goods); `Wire Rope Main` +
`Wire Rope Governor`; counterweight set keyed to one DBG (`Counter Frame`, `Counter
Guard Net`, `Filler Weight`, `Buffer Channel Counter`); `Safety` ×1; `Buffer
Spring` ×2 + `Buffer Stand` Main+Counter; rope termination (`D-SHACKLE` ×2, Bull
Dog Clip, `Thimble` ×6, `I-Bolt` ×6); `LIMIT SWITCH`+bracket ×6; `SAFETY/CAR GATE
SWT.`; `STA. CAM`; `RAIL CLIP`; `Stud Anchor`; `MAGNET WITH BRACKET`; `REED
CHANNEL` ×1; `PVC CABLE HANGER` ×4; consumables; door system per type.
**USUALLY (data-entry-dependent):** RAIL (two profiles), MAIN BRACKET + COUNTER
BRACKET, TROUGHING, CONT. STAND.
**NEVER:** cabin shell/COP/LOP/handrail, controller unit, travelling cable, car
sling, door operator. `RET. CAM` only on Collapsible/MT door jobs (door-driven,
not MR-driven).
**Drive-conditional:** `Pulley Diverter`/`C.I. Pulley` on 800 mm/8-pass + goods;
`Machine Beam` + `CHEQUERED PLATE` only on goods MR; `FIREMAN SWITCH` on a subset.

### (b) Token logic
- **Machine:** `Machine Unit <HP>/<sheave>/<groove>g/<rope>mm/<rpm>/<m/s> (STELLAR)`.
  Rope-dia token must match Machine, Pulley, and `Wire Rope Main` (5 HP/10mm →
  `Wire Rope 10mm`; 6–7.5 HP/13mm → `Wire Rope 13mm` + `C.I. Pulley 400mm/3Grove/
  13mm`). Goods: `2500kg/320mm/9g/8mm/2.0 m/s` + `C.I. Pulley …/10Grove/8mm`.
  `Speed Governor 0.7mts R1` (0.63 m/s) vs `1mts R1` (1.0 m/s).
- **Door:** `<door>/<finish>/<vision>/<opening>` propagated. CO/MT/Collapsible/AFF.
- **DBG:** counter → `Counter Weight Frame STD DBG-<n>mm` etc. (710/850/1050/1550);
  car → `Safety Frame Std DBG-<n>` (912/1242/1442/2522/3022), main buffer brackets
  it as a range.
- **Rail:** `5X45X45` (counter) + `9X65X70` (car) passenger; goods steps to
  `16X62X89` car + `9X65X70` counter.

### (c) Quantity rules
- **Scales with stops `N`:** landing-door set, magnet bracket, gate lock = `N`.
- **`N+1`:** aluminium sill; collapsible gate + floor tiles.
- **Fixed at 1:** Machine, Governor, Safety, Counter Frame, Counter Guard Net,
  STA. CAM, RET. CAM, Danger Plate, Safety Tips Plate, Reed Channel, Controller
  Bracket, Car Door Panel, Car Header (×2 on CO goods — 2-leaf car door).
- **Fixed config (not stops):** Buffer Spring ×2, Buffer Stand ×1 each, D-Shackle
  ×2, I-Bolt ×6, Thimble ×6, LIMIT SWITCH+bracket ×6, LSR ×1–2, PVC Cable Hanger
  ×4, Bull Dog 8mm ×4, Troughing 100 ×3.
- **Scales with travel/rise:** RAIL (~8/profile for 12–15 m; goods 26+13), MAIN/
  COUNTER BRACKET (travel ÷ 2000 car / 1800 counter), RAIL CLIP, Stud Anchor, rope
  (metres ≈ travel × reeving; goods 4:1 → 1200 m).
- **Scales with capacity:** machine HP + rope dia, Filler Weight (11–14 passenger,
  54 goods), Safety/Governor doubled on 2500 KG goods.

### (d) Signature items
1. Geared `Machine Unit … (STELLAR)` — the defining line.
2. Full counterweight package keyed to one DBG.
3. `Governor` + `Wire Rope Governor` + `Wire Rope Main`.
4. Twin rail profiles + paired Main/Counter brackets.
5. On goods MR: `Machine Beam` (an MR-only part — its presence contradicts an MRL
   label, see §e).

### (e) Gotchas
- **JHK114/115 stored `MRL` but are physically MR** (Machine-Room plan + `Machine
  Beam`) — treat as MR; MRL tokens in part names are legacy. `capacity` lossy/wrong
  (4734 `6PASS` = 5-person; 5001 `6PASS`/`stops=5` = 4000 KG goods G+3). Partial
  BOMs (4899, 4900, 4983, 5001) miss the whole first-phase structure. MT jobs carry
  an `Alluminium Sill AT` line (wrong-family carry-over?). Bracket double-count
  ambiguity (`20+20` = 40 pieces or 20 assemblies?). Goods limit-switch mis-map
  (JHK lists the switch under both LIMIT SWITCH and bracket). UoM implicit (rope =
  metres). Speed appears three ways — use title-block rated. Preserve typos
  (`Pannel`, `Thimbel`, `Read Channel`, `Drumbwaiter`).

---

## 2.3 — HOME (Bungalow / Villa lift) — **24 jobs, High confidence**

HOME = a single-phase (230V/1PH), low-speed (0.32–0.5 m/s), counterweighted
**roped traction** bungalow/villa lift with no machine room (controller at top
floor, machine on a beam). HOME is a **product family, not a drive mechanism** —
mechanically it is roped-traction MRL. All 24 store `capacity=4PASS`. One
(RNLKOL-0040) is a belt variant; 4411 has an empty BOM (excluded from quantity
rules).

### (a) Sections — always / never
**ALWAYS (the HOME "kit"):** Machine + Machine Beam (`…/Home`), Governor (`Speed
Governor HOME`), Safety (`Safety Frame Home DBG-NNN`), STA. CAM (`Stationary Cam
Home`), Counter Frame + Counter Guard Net + Filler Weight (always counterweighted),
Pulley Main + Pulley Counter (1 each, 2:1 reeving), Wire Rope Main (6 mm) + Wire
Rope Governor (8 mm), HOME SAFETY SWITCH, LIMIT SWITCH + bracket, PIT SWITCH,
I-Bolt with Spring, D-SHACKLE, Bull Dog Clip, Thimble, ≥1 Car/Landing Door Panel +
Headers, consumables (Grease, Mobil, Oil Pot, Fan Grill, Floor Tiles, Cabin Rubber
Pad, Danger/Safety Tips Plate, PVC Cable Hanger).
**OFTEN (door-type / completeness-dependent):** RAIL (two profiles), MAIN BRACKET,
RAIL CLIP, Stud Anchor/BRICK, TROUGHING, CONT. STAND (`Controller Bracket MRL` —
literally "MRL" even on HOME), FIREMAN SWITCH, Buffer Mounting Channel, RET. CAM,
door frame items.
**NEVER:** controller/COP/LOP/ARD/IR screen unit, cabin shell (only CABIN GLASS
panes when side glass), buffer spring itself (only the mounting channel), car
sling, guide shoes, toe guard.

### (b) Token logic
- **Drive token = `Home`/`HOME`** on every mechanical item (the strongest signal):
  `Machine Unit …/Home`, `Speed Governor HOME`, `Safety Frame Home DBG-NNN`,
  `Counter Weight Frame Home DBG-NNN`, `Stationary Cam Home`, `I-Bolt Rod 8mm
  (Home)`, `Limit Switch Home LS-001`, `Rail Bracket Combination Home(Leg)`/`(Adj
  Leg) 200 Pully`.
- **Machine token invariant:** `4 pass/200mm/4g/6mm` (rope). Pulleys mirror:
  `PVC Pulley 200mm/4Grove/6mm` (RNLHYD0098 uses `C.I. Pulley`; belt RNLKOL-0040
  uses `Belt Pully 100mmx2Grovex30mm`).
- **Door:** `<type>/<finish>/<vision>/<opening>` — CO/AT, SS/MS + designer parens,
  LV/MV/NV, opening almost always 700 (RNLHYD0098=800, RNLKOL-0040=600). Hand token
  `LHS`/`RHS` on AT headers.
- **DBG:** car side (beam/safety/buffer) typically 720 or 820; counter side
  (frame/guard/filler) typically 750 or 850 — one size up.
- **Rail:** `9X65X70` (car) + `5X45X45` (counter), equal counts.

### (c) Quantity rules
- **Scales with stops** (stored `stops` = N+1, G+N convention): Landing Panel,
  Landing Header, Door Post, Linton, Sill Angle, Gate Lock = stops. Verified stops
  2→2 … 6→6 across the set.
- **Stops + 1:** Door Sill / Alluminium Sill ≈ stops + 1.
- **Fixed at 1:** Car Door Panel (RNLCHA-0026=2 anomaly), Car Header, Machine,
  Machine Beam, Governor, Safety, STA. CAM, Counter Frame, Counter Guard Net,
  Pulley Main, Pulley Counter, Danger Plate, Safety Tips Plate, Fan Grill, Buffer
  Channel, Fireman Switch, Grease, Controller Bracket.
- **Fixed kit constants (everywhere):** Bull Dog Clip 6mm ×24, 8mm ×4, Thimbel 6mm
  ×8, D-Shackle 12mm ×2, I-Bolt Rod 8mm (Home) ×8, Cabin Rubber Pad ×4, PVC Cable
  Hanger ×4, Floor Tiles Auto ×8, Mobil T-40 ×2, Oil Pot Set ×2, Pit Switch ×2,
  HOME SAFETY SWITCH ×2, Final Limit Switch N/C ×6 + Limit Switch Bkt STD ×6
  (fixed at 6 even for 2-stop), Troughing 100 ×2.
- **Scales with travel:** Wire Rope 6mm/8mm (metres), MAIN BRACKET ((Leg)+(Adj
  Leg), equal, ≈ ceil(travel / 1700 mm spacing) + overhead), RAIL (≈ ceil(travel /
  std length)), RAIL CLIP, Stud Anchor/BRICK, Troughing 50.
- **Scales with capacity:** Filler Weight — two recurring recipes (26× C.I. plates,
  OR mixed stack of 15 = 3 MS-100 + 8 MS-150 + 4 CI-100). Capacity uniform
  272–408 KG, so filler barely varies.

### (d) Signature items
`Machine Unit 4 pass/200mm/4g/6mm/Home` (identical in all 22 rope jobs), `Speed
Governor HOME`, `Safety Frame Home DBG-NNN`, `Stationary Cam Home`, `Counter
Weight Frame Home DBG-NNN`, `Rail Bracket Combination Home(Leg)` + `(Adj Leg) 200
Pully` (the "200 Pully" = built-in 2:1 diverter — unique to roped home), `I-Bolt
Rod 8mm (Home)`, `Limit Switch Home LS-001`, dual `PVC Pulley 200mm/4Grove/6mm`.
Belt variant: `Traction Belt (Flat)`, `Belt Pully 100mmx2Grovex30mm`, `Safety
Frame Home DBG-720 BELT Pitless` (RNLKOL-0040 only).

### (e) Gotchas
- `capacity` always `4PASS`, never kg (272/300/340/408). HOME ≠ a drive mechanism
  (it's roped-traction MRL). `Controller Bracket MRL` on HOME jobs — don't infer
  drive type. Partial BOMs common (~8 GUW-*/RNLKOL jobs carry only `Rail Clip Small
  ×8` with nothing to fasten; 4411 = 0 lines). DBG drawing-vs-BOM mismatch (cwt
  snaps to nominal 750/850). UoM ambiguity (rope/belt/troughing = metres). Two
  pulleys = same SKU. Door wording on drawings unreliable — trust the BOM token
  (4883 "Auto CO" but BOM is AT; 4790 swing-vs-collapsible disagreement). Stop-count
  edge cases (+R / B+G count Roof/Base as stops). No-car-door variants (4802,
  RNLDL0117 = swing landing door, no car panel). `Final Limit Switch N/C`
  double-listed under two categories on some jobs (4988, GUW-144, RNLDL-0122 =
  12 total). `Floor Tiles Auto` is a generic flooring SKU, not literal tiles.

---

## 2.4 — BELT (flat-traction MRL) — **8 jobs, Medium confidence**

Belt drives are flat-traction MRL lifts (no machine room; machine + controller at
the top of the hoistway). Across the 8 study jobs BELT splits into **two
sub-families**:
- **Home/Bungalow (7 of 8):** RICARDO "RALPH 300/400" residential lifts, 272–408
  kg / "4PASS", 0.5 m/s, single-phase. Jobs: RNLBLR0067, RNLBLR0078, RNLIND0014,
  RNLKEL-0041, RNLNAG0009/0010/0011. Every fabricated part carries `Home`.
- **MRL passenger (1 of 8):** CH-010, 20-pass / 1360 kg, 1.0 m/s, 3-phase. Uses
  `MRL`/`Goods`/`STD`, NOT `Home`. A distinct size class within BELT.

Traction medium is **always a flat belt**, never steel main rope. Title blocks
read `TRACTION MEDIA = BELT (30 x 2)` (home) or carry a rope→belt amendment note.

### (a) Sections — always / never
**ALWAYS (all 8):** Drivetrain (Machine, Machine Beam, Pulley Main, Pulley Counter,
`Wire Rope Main` holding the flat belt, Wire Rope Governor); Counterweight (Counter
Frame, Counter Guard Net, Filler Weight, Buffer Channel); Guide system (RAIL ×2,
MAIN BRACKET, RAIL CLIP); Doors (Car/Landing Panel, Car/Landing Header, Door Sill);
Safety/governor (Safety, Governor, STA. CAM, D-SHACKLE, Safety Tips Plate);
Switches (LIMIT SWITCH + bracket, HOME SAFETY SWITCH, PIT SWITCH, FIREMAN SWITCH);
Wiring (TROUGHING 50, TROUGHING 100, PVC CABLE HANGER); consumables (Mobil T-40,
Oil Pot, Grease, Cabin Rubber Pad, FAN GRILL, Danger Plate, Bull Dog Clip, FLOOR
TILES).
**Home sub-family, sometimes omitted (data gaps, not rules):** Linton Panel
(absent RNLBLR0067, RNLIND0014), Door Post/Frame (absent RNLBLR0067), CABIN GLASS
(only when side glass spec'd), BRICK vs Stud Anchor (civil-interface, not
drive-driven).
**NEVER:** controller/COP/LOP/ARD unit, door-operator motor, traveling cable,
cabin wall panels (only glass + rubber pad + floor tiles).

### (b) Token logic
- **Drive token (`BELT`/`Belt`):** gates the whole drivetrain — `Machine Unit 4
  pass/.../Home BELT` (home) / `Machine Unit Belt 20 Pass/6.8 KW/1.0M/S` (CH-010);
  `Machine Beam …/Home Belt`; `Wire Rope Main` holds `Traction Belt (Flat)`;
  `Belt Pully 100mmx2Grovex30mm` under both Pulley Main + Pulley Counter (home);
  `Counter Weight Frame Home … Belt`, `Safety Frame Home … BELT Pitless`.
- **Lift-class token (`Home` vs `MRL`/`STD`/`Goods`):** orthogonal to drive,
  selected as a set.
- **Door tokens:** `{op}/{finish}/{vision}/{opening}({finishname})` — AT (home
  default) or CO (CH-010, RNLKEL-0041); SO on Door Posts; LHS/RHS on headers; SS +
  finish parens (`(Silver Mirror)`, `(Rose Gold Lilen)`); LV; opening 700/800/1000.
- **DBG:** car DBG (`DBG-720`/`820`; CH-010 `1642`/`1050x65`) ≠ counter DBG
  (`DBG-750`/`850`; CH-010 `1050`).
- **Rail:** home — car `9X65X70` + counter `5X45X45`; CH-010 — car `16X62X89` +
  counter `9X65X70`. No `Sheave` SKU on any BELT job.

### (c) Quantity rules
- **Scales with served landings `L`:** Landing Panel = Landing Header = Linton =
  Door Post = `L`; Door Sill = `L+1`. RNLNAG0010 (G+2 but no opening on 1st floor)
  correctly uses **2** landings, not the stored `stops=3`.
- **Fixed at 1:** Car Door Panel, Car Header, Machine, Machine Beam, Counter Frame,
  Counter Guard Net, Governor, Safety, STA. CAM, Buffer Channel, Fireman Switch,
  Grease; Pulley Main / Pulley Counter = 1 each.
- **Fixed constants (every home job):** D-Shackle 12mm ×2, Bull Dog Clip 8mm ×4,
  Cabin Rubber Pad ×4, PVC Cable Hanger ×4, Final Limit Switch N/C ×6 (paired with
  Limit Switch Bkt STD ×6), Limit Switch Home LS-001 ×2, Pit Switch Box ×2, Oil Pot
  Set ×2, PVC Troughing 100 ×2, PVC Troughing 50 ≈ 10.
- **Scales with travel:** RAIL 4–6/profile; MAIN BRACKET ≈ ceil(travel / spacing)
  per rail, split (Leg)/(Adj Leg) 200 Pully (16/20/24/30); RAIL CLIP ~72→136 home,
  104 CH-010.
- **Scales with capacity:** Filler Weight ≈ balance figure (~26 blocks home,
  36 CH-010); sometimes split MS+CI.
- **Belt/governor lengths (metres):** Traction Belt (Flat) 50→82 home, 130 CH-010;
  Wire Rope 8mm (governor) 20–33 m.

### (d) Signature items
1. `Traction Belt (Flat)` under `Wire Rope Main` (all 8) — flat belt replaces steel
   main rope; steel `Wire Rope 8mm` appears only as the governor rope.
2. `Belt Pully …x2Grovex30mm` under both Pulley Main + Pulley Counter (home).
3. `Machine Unit … BELT` + `Machine Beam … Belt`.
4. `Safety Frame … BELT …` (e.g. `Safety Frame Home DBG-720 BELT Pitless`).
5. `Counter Weight Frame Home DBG-### Belt`.

### (e) Gotchas
- `BELT` conflates two size classes (home RICARDO vs CH-010 MRL passenger) — a
  picker keyed only on `BELT` will mis-pick the family token. Stored `stops` ≠
  served landings (RNLNAG0010). Linton/Door-Post omissions are data gaps, not
  rules. Door-Post qty convention ambiguous (1/opening vs 2 jamb posts). Pulley
  Main + Pulley Counter are the identical SKU — don't collapse. `Traction Belt
  (Flat)` mis-categorised under `Wire Rope Main`. UoM bare-number metres. Car DBG ≠
  counter DBG legitimately. `Safety Frame … Pitless` selected for shallow pit
  (RNLKEL-0041 keeps Pitless even with 600 mm pit — confirm). Title-block drive
  nomenclature can disagree with BOM (CH-010 says "GEARLESS/MRL" reconciled to BELT
  by amendment). Capacity stored as passengers (kg rating lost). `Controller
  Bracket MRL` under CONT. STAND even on Home belt lifts — not a contradiction.

---

## 2.5 — MRL-BELT / BELT-MRL (gearless machine + rope→belt amendment) — **3 transcriptions of 1 batch GA, Low confidence (n≈1)**

**Definition:** Machine-Room-Less, PMSM gearless lift whose suspension was amended
**from rope to flat traction BELT** (drawing note: "AMENDMENT IN MECHANISM ROPE TO
BELT & MACHINE"; suspension = 7 No × 30 mm flat belt). Title block reads "MRL
GEARLESS / PMSM GEARLESS"; stored `drive_type=BELT` captures the suspension but
drops the MRL/gearless dimension. **The BOM is the tiebreaker and confirms belt-MRL
throughout.** Read this drive type as **MRL machine + belt suspension** — both
labels are "correct" in different senses.

**Source jobs:** CH-011, MP-006, MP-007 — all from ONE generic GA covering 14
identical G+1 20-pass MRL-belt lifts (BBSR-245/246, CH-008..013, MP-002..007).
Effectively **one data point with three transcriptions.** Source files:
`scripts/_study/f881e05b-f980-415f-8f7a-e1f36bde870b.json` (MP-007) and the CH-011/
MP-006 study files.

### (a) Sections — always / never
**ALWAYS (MRL-BELT spine):** `Machine` (Machine Unit *Belt*); `Wire Rope Main`
holding `Traction Belt (Flat)` (NOT rope — the key inversion); `Machine Beam`
(`…MRL BELT-<cap>`); `CONT. STAND` (`Controller Bracket MRL` — in-hoistway mount,
no machine-room controller stand); `Counter Frame` (`Counter Weight Frame MRL
DBG-1050mm`); Counter Guard Net + Filler Weight; Buffers (spring set — Buffer
Channel Main/Counter, Buffer Spring, Buffer Stand); Rails (two sizes) + RAIL CLIP +
MAIN BRACKET + MAGNET WITH BRACKET + Oil Pot + STA. CAM; Governor (`Speed Governor
R1`) + `Wire Rope Governor` (8 mm — distinct from the belt) + Safety + Safety Tips
Plate + D-SHACKLE + Bull Dog Clip; Doors per opening (Car/Landing Panel + Headers +
Door Post + Linton + Door Sill); Switches (LIMIT SWITCH + bracket, HOME SAFETY
SWITCH, SAFETY/CAR GATE SWT., PIT SWITCH, FIREMAN SWITCH, Pit Ladder, PVC CABLE
HANGER, TROUGHING); Fixings/consumables (Stud Anchor ×3 sizes, Grease, Mobil T-40,
Cabin Rubber Pad, FAN GRILL, FLOOR TILES, Danger Plate).
**NEVER:** no main traction-rope line (belt occupies the rope slot); no
machine-room controller stand; no cabin/electrical-finish sections (SS cabin, false
ceiling, COP/LOP, CCTV, ARD, travelling cable, door operator, guide shoes) — tracked
elsewhere or unentered (flag, don't read as "not required").

### (b) Token logic
| Token | Pattern | Example |
|---|---|---|
| Drive/belt | `Belt`/`BELT-<cap>`/`Traction Belt (Flat)` on the machine spine | `Machine Unit Belt 20 Pass/6.8 KW/1.0M/S`; `Machine Beam R1 DBG-1050x65/MRL BELT-20` |
| MRL | `MRL` tag on controller/counter/beam | `Controller Bracket MRL`; `Counter Weight Frame MRL DBG-1050mm` |
| Door (op) | `CO` on every door part | `Car Header System CO 1000mm` |
| Finish | `SS` (+ `NV`) | `Car Pannel CO/SS/NV/1000(STD)` |
| Opening | numeric `1000` mm | `Alluminium Sill CO 1000mm/LT/2060` |
| DBG car | `DBG-1642` | `Safety Frame R1 DBG-1642/150mm` |
| DBG counter | `DBG-1050` | `Counter Weight Frame MRL DBG-1050mm`, `Counter Guard Net DBG-1050x65` |
| Rail | reversed: drawing `89x62x16`→`Guide Rail 16X62X89`; `70x65x9`→`9X65X70` | both |
| Capacity | `20 Pass` / `BELT-20` | machine + beam |

Preserve DB typos verbatim (`Pannel`, `Alluminium`, `Alluminuim`).

### (c) Quantity rules
- **Scales with openings (N=2 for G+1, through-car/reverse):** Car Panel, Landing
  Panel, Car Header, Landing Header, Door Post, Linton, Auto Door Sill Angle = 2;
  Alluminium Sill = 4 (2 openings × car+landing).
- **Fixed at 1:** machine, beam, counter frame, counter guard net, controller
  bracket, safety frame, governor, danger plate, home/car-gate switches, STA. CAM,
  fireman switch, grease, mobil. Spring buffers: Buffer Spring ×4 (2 main + 2
  counter), Buffer Stand Main ×2 + Counter ×2, channels ×1 each.
- **Scales with rise (not stops):** MAIN BRACKET set = 8 (Main Bracket Fabricated
  ×8 + Rail Bracket Main B ×8 + Rail Bracket Main C ×8 — **may be alternatives by
  bracket gap, not additive — verify before summing**); RAIL = 5/size; RAIL CLIP
  (Big ×64, Goods ×40); Stud Anchor (8×75 ×22, 10×90 ×22, 12×100 ×60); Troughing
  (50 ×12, 100 ×2).
- **Scales with capacity:** Filler Weight ×36 (20-pass / 1360 kg).
- **Length-valued (NOT pieces):** Traction Belt (Flat) = 130 (running length),
  Wire Rope 8mm governor = 26, Floor Tiles / Chequered Plate 2mm = 1.5 (sheets/area),
  Grease = 1 (pack).

### (d) Signature items
1. `Machine Unit Belt <cap> Pass/<kW>/<speed>`.
2. `Machine Beam … MRL BELT-<cap>` (the only line carrying both MRL and BELT).
3. `Traction Belt (Flat)` under `Wire Rope Main` — THE discriminator.
4. `Controller Bracket MRL`.
5. `Counter Weight Frame MRL DBG-####`.
6. Governor still `Wire Rope 8mm` — belt-main + wire-governor, never belt-governor.

### (e) Gotchas
- "MRL GEARLESS" vs "BELT" is **not** a contradiction — MRL machine + belt
  suspension; don't "fix" one to match the other. Recommend a separate
  `machine_room` (MRL) flag vs `suspension` (BELT). Flat belt filed under `Wire Rope
  Main` (rope label for a belt part). Mixed UoM (130/26 = metres, 1.5 = sheets,
  grease = pack). **Motor kW mismatch:** drawing 8.8 KW vs SKU 6.8 KW — reconcile.
  Two DBG per job (1050 well vs 1642 car). Reverse/through-car openings affect
  orientation, not counts. Cabin + electrical absent. MAIN BRACKET possible
  double-count. One generic GA serves 14 lifts — confirm per-unit specs before
  generalizing (n≈1).

---

## 2.6 — HYD (Hydraulic) — **1 job (RNLKEL0018), Very low confidence**

**Evidence base:** one job — RNLKEL0018 (RALPH 200, GMV Hydraulic, G+2 / 3 stops,
"6 PASS / 272 KGS", AT door, LHS, Rose Gold + SS Hairline). Source:
`scripts/_study/0576837f-f18d-4704-9cd6-b99e2a291682.json`. **All rules are
single-job-derived AND the one job is internally anomalous (no power pack).**

### (a) Sections — always / never
**Present:** car door set (Car Panel, Car Header); landing set (Landing Panel,
Header, Door Post, Linton, Door Sill — both aluminium sill + sill angle); guide
(RAIL, RAIL CLIP); switches (LIMIT SWITCH + bracket, PIT SWITCH, STA. CAM); wiring
(TROUGHING 100/50, PVC CABLE HANGER); CONT. STAND (`Controller Bracket MRL`);
safety (Safety Frame, Governor, Safety Tips Plate, Danger Plate); cabin (CABIN
GLASS, Cabin Rubber Pad, FAN GRILL, FLOOR TILES); lube; drive hardware (`Machine`,
`Wire Rope Main` 45 m of 10 mm — **anomalous for a pure-hydraulic lift**).
**Missing (notably):** **NO Hydraulic Power Pack / Jack / Ram / Cylinder** — the
defining hydraulic component is absent (biggest gap). No counterweight/filler
(expected-absent for hydraulic, correct). No Buffer, no Guide Shoes, no explicit
Rail/Main Bracket section.

> Rule: **HYD jobs as-stored do NOT carry a hydraulic power-pack/jack line.** Either
> a traction template was carried over, or it's roped-hydraulic. Flag it — don't
> assume the power pack is implied.

### (b) Token logic
- **Door-type `AT`** on every door item; opening-side `LHS`/`RHS` (uniform LHS
  here, enforced across Car Header + Landing Header + Auto Door Post); finish `SS`
  + designer parens (`(Rose Gold)` — split: car coded Rose Gold, landing only
  `SS/LV`); vision `LV`; width `800` (= drawing OPENING).
- **DBG token `700`** with the hydraulic signature embedded: `Safety Frame
  DBG-700(GMV Hydraulic)`.
- **Rail:** `Guide Rail 16X62X89`. **Machine:** `Machine Unit 6 pass/320mm/4g/8mm`.
  No sheave-named item.

### (c) Quantity rules
- **Scales with landings (3 here):** Landing Panel = Landing Header = Door Post =
  Linton = Auto Door Sill Angle = 3.
- **Fixed at 1:** Car Door Panel, Car Header, Machine, Governor, Safety, Safety
  Tips Plate, Danger Plate, FAN GRILL, STA. CAM, Grease, Controller Bracket.
- **Composite:** Alluminium Sill = landings + 1 car = 4.
- **Likely fixed kit (confirm):** LIMIT SWITCH = bracket = 6; PIT SWITCH = 2; OIL
  POT = 2; Mobil T-40 = 2; TROUGHING 100 = 2; Cabin Rubber Pad = 4; PVC Cable
  Hanger = 4; CABIN GLASS = 2.
- **Scales with travel:** RAIL = 5; Wire Rope 10mm = 45 (metres); RAIL CLIP (Goods
  28, Small 8); FLOOR TILES = 8; TROUGHING 50 = 8.
- **Capacity:** encoded as the `Machine Unit` "6 pass" token, selects variant not count.

### (d) Signature items
- `Safety Frame DBG-700(GMV Hydraulic)` — clearest hydraulic fingerprint (GMV =
  hydraulic vendor).
- Spec selector: `traction_media = HYDRAULIC`, model RALPH 200, MRL/ground-floor
  controller.
- **Expected-but-absent signature:** the missing power pack/jack/ram (alongside
  present Machine Unit + 45 m rope + Governor) IS the anomaly of how HYD is stored.

### (e) Gotchas
- Single data point. Hydraulic-vs-traction conflict (HYD + "GMV Hydraulic" yet
  Machine Unit + Governor + 45 m rope + no power pack — major reconcile flag).
  Capacity mismatch (stored 6PASS, drawing 272 KGS ≈ 4-pass). `Controller Bracket
  MRL` on a hydraulic ground-controller job (likely mislabel). Finish split between
  car/landing. No UoM joined (rope = metres). Structural gaps (no brackets/buffer/
  guide shoes) independent of drive.

---

# PART 3 — Item-name token grammar (recomposing a name from spec)

Nothing structured lives in DB columns for door type, finish, or DBG — **it is all
encoded in the `items.name` string**, and the auto-builder must *recompose* the
name from the drawing spec to pick the right SKU. Preserve all DB typos exactly
(`Pannel`, `Alluminium`, `Alluminuim`, `Thimbel`, `Grove`, `Dasfastner`, `Read
Channel`, `Lilen`, `Pully`, `Miscallaneous`, `Bracket Trey`) — they are
load-bearing match keys.

## 3.1 — Drive / machine spine tokens
| Spec input | Token in name | Example |
|---|---|---|
| MRL machine room | `/MRL` on Machine Beam + `MRL` on Counter Frame/Controller Bracket | `Machine Beam R1 DBG-1050x50/MRL` |
| MR machine room | geared `Machine Unit … (STELLAR)`, no `/MRL` | `Machine Unit 5HP/.../10mm/... (STELLAR)` |
| HOME family | `/Home` / `HOME` on every mechanical item | `Machine Unit 4 pass/200mm/4g/6mm/Home` |
| BELT suspension | `Belt`/`BELT` on machine/beam + `Traction Belt (Flat)` under `Wire Rope Main` | `Machine Unit Belt 20 Pass/6.8 KW/1.0M/S` |
| HYD | `(GMV Hydraulic)` suffix on Safety Frame | `Safety Frame DBG-700(GMV Hydraulic)` |
| Machine size | `<N> pass` or `<kg>KG` / `<kW>` + `/<sheave>mm/<groove>g/<rope>mm[/<rpm>/<m/s>]` | `Machine Unit 2500kg/320mm/9g/8mm/2.0 m/s` |
| Speed | `Speed Governor <speed>mts R1` (0.5/0.7/1/1.5) | `Speed Governor 1mts R1` |

**Consistency invariant:** rope-diameter token MUST match across Machine, Pulley,
and `Wire Rope Main`. Groove count = number of suspension ropes = pulley groove
count.

## 3.2 — Door tokens (composed once, propagated to every door part — §1.3)
`<operation>/<finish>/<vision>/<opening>(<finish-name>)` + handing `LHS|RHS`.

| Field | Values | Source |
|---|---|---|
| operation | `CO` (centre-opening auto), `AT` (auto telescopic side-slide), `MT` (manual telescopic), `SO` (on Door Post for side-opening), `AFF` (goods 4-part-2-fold), `Collapsible`/`Swing` (own families) | drawing door type (NOT the dead `door_type` column) |
| finish | `SS` / `MS` + designer overlay in parens: `(Rose Gold)`, `(Rose Gold Lilen)`, `(Golden)`=TI Gold, `(Silver Mirror)`, `(Black Mirror)`, `(STD)`, `(BIG)` | drawing finish |
| vision | `LV` (long), `MV` (medium), `NV` (no/narrow), `PV` | drawing vision glass |
| opening | clear opening mm: `600/700/800/900/1000` (goods `1400/1600/1800`) | drawing OPENING |
| handing | `LHS`/`RHS` — must agree across Car Header + Landing Header + Door Post | drawing |

Headers/sill/linton carry the bare width: `Car Header System CO 700mm`, `Auto Door
Sill Angle AT 800mm`, `Auto Door Linton Pannel CO SS/700mm`.

## 3.3 — DBG tokens (two per job — §1.4)
- Counter DBG → `Counter Weight Frame [MRL|STD|Home] DBG-<x>mm`, `Counter Guard Net
  DBG-<x>`, `Buffer Mounting Channel Counter … DBG-<x>`, `Filler Weight … DBG-<x>/…`,
  `Machine Beam … DBG-<x>x{50|65}`.
- Car DBG → `Safety Frame … DBG-<y>`; main buffer channel brackets it as a range
  `DBG-(<y>-50)-(<y>+50)`.

## 3.4 — Rail tokens (§1.5)
Drawing `A×B×thk` → `Guide Rail <thk>X<B>X<A>`. Counterweighted jobs = a heavy car
rail + a light counter rail in equal counts.

---

# PART 4 — Quantity rules (consolidated decision table)

For each candidate line the auto-builder must classify the quantity driver:

| Driver | Items | Formula |
|---|---|---|
| **Served landings `L`** | Landing Panel, Landing Header, Door Post, Linton, Sill Angle, Magnet Bracket, Gate Lock (collapsible/swing/MT) | `qty = L` |
| **`L + 1`** | Aluminium Sill, Collapsible Gate (car gate), Floor Tiles (often) | `qty = L + 1` |
| **Openings `O` (CO 2-leaf / through-car)** | Car/Landing Panel & Headers on 2-leaf or reverse-opening jobs | `qty = O` (Aluminium Sill = `O × 2`) |
| **Fixed at 1 (single car/machine)** | Car Door Panel, Car Header, Machine, Machine Beam, Counter Frame, Counter Guard Net, Governor, Safety, STA. CAM, Controller Bracket, Danger Plate, Safety Tips Plate, Pit Ladder, Grease | `qty = 1` (Car Panel/Header = 2 on CO goods 2-leaf) |
| **Fixed terminal/limit set** | Final Limit Switch N/C **= 6**, Limit Switch Bkt **= 6** | constant 6 — **never scale with stops** |
| **Fixed kit constants** | D-Shackle ×2, I-Bolt ×6/×8, Thimble ×6/×8, Bull Dog (6mm ×24 home, 8mm ×4), PVC Cable Hanger ×4, Oil Pot ×2, Mobil T-40 ×2, Pit Switch ×2, Cabin Rubber Pad ×4, Buffer Spring ×2 (std) / ×4 (goods/MRL-belt) | per-config constants |
| **Travel / rise (NOT stops)** | RAIL lengths (ceil(travel / std length) per profile), MAIN/COUNTER BRACKET (ceil(travel / spacing) per rail; spacing ≈ 1700 home, 1800 counter, 2000 car), RAIL CLIP, Stud Anchor/BRICK, Troughing | length / spacing math |
| **Travel × reeving (metres, length-valued)** | Wire Rope Main (6/8/10/13mm), Wire Rope Governor (8mm), Traction Belt (Flat) | ~10× travel for 2:1; far more for 4:1; **stored as bare metres, NOT pieces** |
| **Capacity / counterbalance** | Filler Weight count, Machine rating, pulley groove/rope count, rail profile, Safety/Governor doubling on heavy goods | balance ≈ car deadweight + ~50% rated load ÷ block mass |

---

# PART 5 — Data-quality gates (run BEFORE trusting any auto-built BOM)

## 5.1 — Incomplete-BOM detection
Partial/stub BOMs are **common** and must be detected, not treated as drive specs.
Red flags:
- A BOM with `Rail Clip Small ×8` but **no `RAIL`, no `MAIN BRACKET`, no door
  frames, no buffers** (orphaned fasteners) — first-phase structure was never
  entered (many GUW-* / RNLKOL-0017/0035 HOME jobs; MR 4899/4900/4983/5001).
- A BOM with only a machine beam, only accessories, or only header lines (MRL 4613
  = 1 line, 4614 = 3, 4910 = 2, 4635 = 4; HOME 4411 = 0 lines).
- **Gate:** if a complete drive type's "always present" spine (Machine + Governor +
  Safety + Counter Frame + RAIL + door set) is missing core members, mark the BOM
  **incomplete** and require human entry of first-phase structure. Do NOT infer
  "this drive type doesn't have rails."

## 5.2 — UoM: metres-vs-pieces
`job_bom_lines` carries **no inline UoM** — MRP must read each item's `uom_id` or it
mis-sums. Length-valued items (bare numbers = metres/lengths, NOT pieces):
`Wire Rope 6/8/10/13mm`, `Traction Belt (Flat)`, `PVC Troughing 50/100`, `Guide
Rail`. Area/sheet-valued: `ALLUMINUIM CHEQUERED PLATE 2MM` / `FLOOR TILES` (qty
~1.5 = sheets/sqm). Pack-valued with size in name: `Grease 200grm`, `Filler Weight
… 23.645` (kg baked into name). **Gate:** any line whose qty would read as an
absurd piece count (belt = 130, rope = 480/1200) must be UoM-tagged before
purchasing/MRP.

## 5.3 — Capacity stored as wrong/coarse class
- HOME: always `4PASS`, kg rating (272/300/340/408) lost.
- MR/MRL: `6PASS`/`8PASS` default; kg never stored; several jobs store `6PASS` for
  5-person lifts; 5001 stores `6PASS`+`stops=5` for a 4000 KG goods G+3.
- BELT/MRL-BELT: stored as passengers, kg lost (kg drives filler-weight sizing).
- HYD: stored `6PASS`, drawing 272 KGS (~4-pass).
- **Gate:** never size filler weight / machine / rope off stored capacity — read
  the drawing kg rating. Treat stored capacity as a coarse class label only.

## 5.4 — `drive_type` overload / mislabeling
The enum conflates machine-room architecture, suspension medium, and product
family. Confirmed mislabels: 4809 stored `CANTI` (a frame style), RNLKOL-0024 stored
`MR`, JHK114/115 stored `MRL` but are physically MR (Machine-Room plan + Machine
Beam). **Gate:** classify drive from BOM tokens, NOT the stored enum:
- `/MRL` machine beam + `Controller Bracket MRL` + `Counter Weight Frame MRL` ⇒ MRL.
- geared `Machine Unit … (STELLAR)` + `Machine Beam` (no `/MRL`) + machine-room
  plan ⇒ MR.
- `Traction Belt (Flat)` under `Wire Rope Main` ⇒ belt suspension (then check
  `Home` vs `MRL` token for the size class).
- `/Home` on the mechanical kit ⇒ HOME family.
- `(GMV Hydraulic)` ⇒ HYD.
Recommend splitting into separate fields: `machine_room` (MR/MRL), `suspension`
(rope/belt/hydraulic), `product_family` (HOME/passenger/goods).

## 5.5 — Stops ≠ served landings; off-by-one
Stored `stops` disagrees with served openings on `+R` / basement / no-opening-floor
jobs (G+N+R counts Roof; B+G+N adds basement; RNLNAG0010 has no opening on 1st
floor). **Gate:** key door quantities off the floor-height table row count / served
openings, not the stored integer. Verified disagreements: 4709 (stored 5, real 6),
4614 (8 vs 7), 4914 (4 vs 3 served), 4929 (6 physical / 4 opening), RNLNAG0010
(stored 3 / 2 served).

## 5.6 — Same-SKU-two-categories de-dup hazard
`Pulley Main`/`Pulley Counter` and `Wire Rope Main`/`Wire Rope Governor` are the
same `item_id` under two categories. Sum by `item_id`; never de-dup by item name
(would merge intentional dual roles). Watch the inverse: some goods jobs mis-map
`LIMIT SWITCH BRACKET` → the switch SKU (double-counts switches, zero brackets).

## 5.7 — Title-block vs BOM contradictions
- Motor kW: drawing 8.8 KW vs SKU 6.8 KW (belt-MRL) — reconcile nameplate.
- Speed appears three ways (title 0.63 / plate 0.65 / governor 0.7) — use title-
  block rated.
- Door wording vs token (4883 "Auto CO" but BOM `AT`) — trust the BOM token.
- Flooring (drawing PVC vs BOM Aluminium Chequered Plate) — confirm delivered.
- Bracket double-count: `MAIN BRACKET`/`COUNTER BRACKET` split into 2 sub-lines at
  equal qty (20+20) — verify 40 pieces vs 20 assemblies before MRP rollup. MRL-BELT
  3-line MAIN BRACKET (Fabricated/B/C ×8 each) may be alternatives, not additive.

---

# PART 6 — What is SAFE to encode deterministically now vs needs more data

## 6.1 — SAFE to ship deterministically (high evidence, stable across families)
1. **Landing-door set qty = served landings `L`** (§1.1) — strongest rule, every
   door-complete job across all 5 families.
2. **Aluminium sill = `L + 1`** (§1.2) — confirmed MRL/MR/HOME/BELT.
3. **Door-token propagation** (§1.3, §3.2) — compose one door code, stamp on all
   door parts; trust the BOM token over the drawing wording and the dead
   `door_type` column.
4. **Car-side singletons = 1** (Machine, Machine Beam, Governor, Safety, Counter
   Frame, Counter Guard Net, Car Door Panel, Car Header, Controller Bracket, STA.
   CAM, Danger/Safety Tips Plate) — universal.
5. **Final Limit Switch + bracket = 6 (fixed, never stop-scaled)** — the single
   most consistent fixed quantity across 2-stop to 14-stop jobs.
6. **Fixed kit constants** (§4, D-Shackle/I-Bolt/Thimble/Bull Dog/PVC Hanger/Oil
   Pot/Mobil/Pit Switch/Cabin Rubber Pad/Buffer Spring) — per-config constants,
   stable within each family.
7. **Drive classification from BOM tokens, not the stored enum** (§5.4) — and the
   five token signatures per drive type (§2.x.d).
8. **Dual-DBG and rail-reorder name composition** (§1.4, §1.5, §3.3, §3.4) —
   deterministic string transforms.
9. **UoM tagging of length-valued items** (§5.2) — deterministic by item name.
10. **The "never present / tracked-elsewhere" section list** (§1.10) — don't flag
    cabin/electrical absence as a gap.

## 6.2 — Encode as ESTIMATES with a "verify by hand" flag (formula known, scatter present)
1. **Travel-driven counts** (RAIL lengths, MAIN/COUNTER BRACKET, RAIL CLIP, Stud
   Anchor, Troughing) — the ceil(travel / spacing) formula is sound but spacing
   conventions (1700/1800/2000) and overhead allowances vary; surface the math, let
   the user confirm. (Consistent with the make-plan optimizer's "conservative
   estimate, validate by hand" stance.)
2. **Rope/belt lengths** (metres ≈ travel × reeving) — order of magnitude is
   reliable; exact metreage needs the drawing's reeving + overhead.
3. **Filler Weight count** (capacity balance) — recipe known (≈ car + 50% load ÷
   block mass) but kg rating is lost from storage (§5.3); compute from drawing kg,
   not stored capacity.
4. **Collapsible / swing / AFF door-family quantities** (car gate = `L+1`, gate
   locks = `L`) — fewer samples; confirm the leaf convention per family.

## 6.3 — DO NOT encode yet — need more data
1. **HYD anything** — n=1, and that one job is anomalous (no power pack, has a
   traction machine + 45 m rope). Treat every HYD auto-build as draft-only until
   ≥3 clean HYD jobs are studied. In particular do NOT assume a power-pack/jack line
   is implied.
2. **MRL-BELT / BELT-MRL quantity scaling** — effectively n=1 (one batch GA, three
   transcriptions). The G+1/2-opening counts are a single data point; the 3-line
   MAIN BRACKET additivity is unresolved.
3. **BELT family-token disambiguation** (`Home` vs `MRL`/`STD`) — the `BELT` enum
   conflates two size classes; needs the explicit lift-class read, which is not
   reliably in stored spec.
4. **Door-post jamb convention** (1/opening vs 2 jamb posts) — ambiguous across
   BELT/HYD; confirm before trusting post counts.
5. **Bracket sub-line additivity** (`MAIN BRACKET` / `COUNTER BRACKET` split lines;
   MRL-BELT B/C variants) — verify pieces-vs-assemblies before any MRP rollup.

---

## Appendix — preserve-verbatim DB strings (load-bearing typos)
`Pannel`, `Alluminium`, `Alluminuim`, `Thimbel`, `Grove`, `Dasfastner`, `Read
Channel` (=Reed), `Lilen` (=Linen), `Pully`, `Miscallaneous`, `Bracket Trey`,
`Drumbwaiter`. Category-name typos already documented in CLAUDE.md §8 — match
exactly, never "fix."
