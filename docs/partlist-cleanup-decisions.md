# Part List cleanup — owner decisions (collecting, apply in one batch at end)

Status: COLLECTING. Nothing applied to code/DB yet.
Source universe: `scripts/_packing_sections.json` (501 sections) →
`src/lib/packing-list/packing-list-sections.ts`. Brain refs to remap on apply:
`templates.json` (sectionKeys), `section-groups.json` (key→PART),
`quantity-models.json` (sectionKeys). No live DB data (packing_lists = 0).

---

## 1. Pulley  (was 21 → target 6, + Chain Pully pending)

**Remove all material-specific pulleys** (C.I./PVC/Belt, Main/Counter/plain/Counter-Frame):
keys p-c-i-pully-counter, p-c-i-pully-main, p-c-i-pully, p-c-i-pully-counter-2,
p-c-i-pully-main-2, p-c-i-pully-2, p-p-v-c-pully-counter-frame, p-p-v-c-pully,
p-pvc-pully-counter, p-p-v-c-pully-counter, p-pvc-pully, p-pvc-pully-main,
p-p-v-c-pully-main, p-belt-pully-counter, p-belt-pully-main.

**Replace with 3 generic position lines, filled from the job BOM** (item capture,
scoped to "Pulley Items"):
- **Pulley (Main)**
- **Pulley (Counter)**
- **Pulley (Diverter)**  ← also absorbs "Distance Pully with Fixing Arrangement" (p-... distance), which = Diverter pulley.

**Pulley Rope Guard**: 3 → **2 types, NON-inventory (free-text)**:
- **Main Pulley Rope Guard**  (keep p-main-pully-rope-guard, set captureType=free, clear category)
- **Counter Pulley Rope Guard**  (keep p-counter-pully-rope-guard, set free; DROP the "(40X6 Flat)" variant p-counter-pully-rope-guard-40x6-flat, merge in)

**Keep as-is**: `Bolt+Nut+S.W.+F.W For Counter Pully` (fastener, free) — belongs to Fasteners family.

**PENDING**: `Chain Pully` (1 Ton) — owner hasn't said; DEFAULT = keep unless told otherwise.

---

## 2. Guide Rail  (was 4 → 2)
Keep **Guide Rail (Main)** (p-guide-rail-main) + **Guide Rail (Counter)** (p-guide-rail-counter).
Remove the (R) variants: p-guide-rail-main-r, p-guide-rail-counter-r.

## 3. Fish Plate  (was 3 → 1 + fastener)
Keep **Fish Plate** (p-fish-plate). Remove **Fish Plate (R)** (p-fish-plate-r).
Keep `Bolt+Nut+S.W.+F.W For Cwt Fish Plate` (p-bolt-nut-s-w-f-w-for-cwt-fish-plate) under Fasteners.

## 4. Rail Bracket / Combination  (was 20 → 2 + 2 fasteners)
Remove ALL bracket + combination variants (keys): p-rail-bracket-main-fabricated,
p-counter-rail-bracket, p-rail-bracket-counter-home, p-rail-bracket-home,
p-rail-bracket-counter-fabricated, p-rail-bracket-counter, p-rail-bracket-main,
p-rail-bracket-main-combination, p-main-rail-bracket, p-rail-bracket-main-home,
p-combinition-bracket-cutting-240mm, p-combinition-bracket, p-combination-leg,
p-combination-lag-std (verify slug), p-rail-combination-channel,
p-main-rail-bracket-for-platfrom-support, p-main-rail-bracket-b-50-100mm.
**Replace with 2 BOM-filled lines**: **Main Bracket** (scope Rail Bracket Main +
Combination Main/Home) and **Counter Bracket** (scope Rail Bracket Counter).
Keep fasteners: p-fastner-rail-bracket, p-bolt-nut-d-fw-s-w-rail-bracket.
MOVE OUT to Buffer family: `Combination Buffer Plate (Home)` (p-combination-buffer-plate-home).

## 5. Rail Clip  (was 3 → 1)
Collapse to ONE BOM-filled line **Rail Clip** (scope Hardware > Rail Clip).
Delete p-rail-clip-main, p-rail-clip-counter; keep one (reuse p-rail-clip).

## 6. Rail Packing / Fixing  (was 4 → 2)   [UPDATED]
Delete: p-rail-packing, p-main-rail-packing.
Keep: **Rail Fixing Kit** (p-rail-fixing-kit, free) AND
**Rail Fixing Bracket (Structure)** (p-rail-fixing-bracket-structure, item).

## 7. Machine Unit  (was 15 → 1, + hydraulic Power Pack)
Collapse all 14 Machine Unit (SEG/Sharp/NIDEC/BBL/Belt/Traction) into ONE
BOM-filled line **Machine Unit** (scope Large Purchased Items > Machine Unit).
Delete keys p-machine-unit-seg-35/-20/-45, p-machine-unit-sharp-seg-50/-40/-30/-05,
p-machine-unit-seg-05-sharp, p-machine-unit-sharp, p-machine-unit-nidec,
p-machine-unit-bbl, p-machine-unit-belt, p-machine-unit-traction; keep one (p-machine-unit).
**Hydraulic rule**: when job drive_type = HYD, show **Power Pack** (search option
GMV) INSTEAD of Machine Unit. Repurpose p-gmv → "Power Pack" gated to HYD;
gate Machine Unit to non-HYD. (Needs a drive-type gate on sections — no live data,
safe to add.)

## 8. Machine Beam / Base / Lifting  (was 7 → 6, with gates)
- **Machine Beam** (p-machine-beam) — keep, from BOM (scope Machine Beam). No gate.
- **Machine Beam Bracket** (rename p-machine-beam-bkt; merge p-machine-beam-bkt-450mm)
  — search ONLY sub-category "Machine Beam > Machine Beam Bracket"; GATE: drive_type = MRL.
- **Machine Base With Bracket** (p-machine-base-with-bracket) — GATE: R1000 only.
- **Machine Support Base Bracket** (p-machine-support-base-bracket) — GATE: R1000 only.
- **Machine Lifting Frame With Counter Gide Shoe** (p-machine-lifting-frame-with-counter-gide-shoe) — GATE: R1000.
- **Machine Lifting Frame With** (p-machine-lifting-frame-with) — GATE: R1000.
  (NOTE: #3 & #4 look like the same part typed twice — confirm whether to merge.)

### CROSS-CUTTING: drive-type GATES now needed on part-list sections
Add a `gate` to PackingSection (default: always show). Gates so far:
Machine Unit=non-HYD, Power Pack=HYD, Machine Beam Bracket=MRL,
Machine Base/ Support Base / both Lifting Frames = R1000.
Speed Governor Fixing Kit / Governor Extension Plate / Governor Switch = HOME, BELT, CANTI.

## 9. Speed Governor  (was 5 → 4, with gates)
- **Speed Governor** (keep p-speed-governor-both, from BOM, no gate). Drop dupe p-speed-governor-sr-no.
- **Speed Governor Fixing Kit** (p-speed-governor-fixing-kit, free) — GATE: HOME, BELT, CANTI.
- **Governor Extension Plate** (p-governor-extension-plate, item) — GATE: HOME, BELT, CANTI.
- **Governor Switch** (p-governor-switch, item) — GATE: HOME, BELT, CANTI.
  (Gate drives = Home Rope, Home Belt, Cantilever.)

## 10. Wire Rope  (2 → 2)   [UPDATED — folds in Rope/Belt]
- **Wire Rope (Main)** → RENAME to **"Wire Rope Main/Belt Main"** (p-wire-rope-main),
  expand part-list categoryPaths to [Large Purchased Items > Wire Rope, > Belt] so it
  captures the belt for belt-drive jobs. From BOM.
- **Wire Rope (Gov)** (p-wire-rope-gov) — unchanged.
- DELETED already-live: BOM section "Wire Rope Main" renamed to "Wire Rope Main/Belt Main"
  in bom-sections.ts + 134 job_bom_lines migrated (DONE this session).

## 11. Rope / Belt  (2 → 0)
Delete **Rope Belt (Main)** (p-rope-belt-main) + **Rope Belt** (p-rope-belt) —
belt now captured under "Wire Rope Main/Belt Main".

## 12. Oil / Grease / Mobil  (5 → 2, with gates)
- **Synthetic Oil** → rename **"Synthetic Oil G-220"** (spec concatenated, clear specHint),
  GATE: MR only. (p-synthetic-oil, item, Oil/Mobil)
- **Hydraulic Oil** → rename **"Hydraulic Oil Grade-68"** (spec concatenated),
  GATE: HYD only. (p-hydraulic-oil, item, Oil/Mobil)
- REMOVE (already captured by BOM — confirm): Mobil (p-mobil), Grease (p-grease),
  Oil Pot Set (p-oil-pot-set).
Gates added: Synthetic Oil = MR, Hydraulic Oil = HYD.
NEW PATTERN: fixed-spec items concatenate spec into the label, no specHint.

## 13. Thimble  (3 → 1 + I-Bolt Belt)
- **Thimble** — ONE line from BOM (scope Hardware > Thimbel). Keep p-thimbel; delete p-thimbel-o-type.
- **Thimbel (Belt)** (p-thimbel-belt) → REPLACE with new **I-Bolt Belt** (free, non-inventory),
  GATE: Home Belt + MRL Belt (owner wrote "Home MRL" — assuming MRL Belt).
  (Reconcile with existing p-i-bolt-rod-belt "I-Bolt Rod (Belt)" when we reach I-Bolt family.)

## 14. Bull Dog Clip  (4 → 2)
- **Bull Dog Clip** — ONE line from BOM (merge Main p-bull-dog-clip-main + Gov p-bull-dog-clip-gov;
  scope Hardware > Bull Dog Clips). Delete plain p-bull-dog-clip.
- **Bull Dog Clip (Belt)** (p-bull-dog-clip-belt) — free, non-inventory, GATE: Home Belt + MRL Belt.

## 15. D Shackle  (1 → 1)
Keep **"D" Shackle** (p-d-shackle) from BOM. No gate.

Gates added: I-Bolt Belt = BELT+MRLBELT, Bull Dog Clip (Belt) = BELT+MRLBELT.

## 16. Header System  (15 → 1 bracket + 3 fasteners)
- DELETE Landing/Car Header System (all door variants) — captured by BOM **Door System** section:
  p-landing-header-system-mt/-aff/-co/-at, p-car-header-system-mt/-aff/-co/-at.
- **Header Bracket** (3 variants p-header-bracket-mt/-co/-at) → MERGE into ONE
  **"Sill & Header Adjustable Bracket"** scoped to [Adjustable Bracket > Sill & Header Adjustable Bracket].
- DELETE **Car Header Hanging Bkt** (p-car-header-hanging-bkt).
- KEEP fasteners, ORDER them immediately AFTER the Door System block:
  p-fastner-for-header-bracket ("Fastner For Header Bracket"),
  p-bolt-nut-s-w-f-w-for-header-fixing ("Bolt+Nut…For Header Fixing"),
  p-bolt-nut-s-w-f-wd-for-header-sill-bkt ("Bolt+Nut…For Header+Sill Bkt").

ORDERING NOTE: final list must support explicit section ordering (e.g. "right after
Door System"). Track an order/grouping at apply time, not just avgPos.

## 17. Sill  (18 → Door Sill + Sill Angle from BOM, + fasteners)
- DELETE Aluminium Sill (p-alluminium-sill/-landing/-car) + Collapsible Sill
  (p-collapsible-landing-sill-s-s, p-collapsible-car-sill, p-collapsible-car-sill-angel)
  — captured by BOM **Door Sill** under Door System.
- Part list gets TWO BOM-driven lines: **Door Sill** and **Sill Angle** (both from BOM).
- DELETE old **Sill Angle** (p-sill-angle, "Auto Door Sill Angle") — replaced by new BOM Sill Angle.
  CONFIRM: **Sill Angle Ground** (p-sill-angle-ground) — keep or remove? (owner didn't say)
- DELETE Sill Bracket door variants (p-sill-bracket-mt/-co/-at/-aff) — covered by
  "Sill & Header Adjustable Bracket". CONFIRM #7 "M.S Flat 25x6 For Sill Bracket (Goods)"
  (p-m-s-flat-25x6-for-sill-bracket-goods) — remove too?
- KEEP, ordered AFTER the "Sill & Header Adjustable Bracket" line:
  **Fastner For Sill Bracket** (p-fastner-for-sill-bracket, item),
  **Bolt+Nut…For Header+Sill Bkt** (p-bolt-nut-s-w-f-wd-for-header-sill-bkt).
- Fasteners after the SILL section:
  rename "C.S.K Screw For SS Sill" → **"C.S.K SS Screw"** (p-c-s-k-screw-for-ss-sill);
  rename "Screw C.S.K For Car Sill" → **"Screw C.S.K MS Car Sill"** (p-screw-csk-ss-nut-f-w? verify key);
  keep **Bolt+Nut…For Sill Fixing** (p-bolt-nut-s-w-f-wd-for-sill-fixing).

- **Sill Angle Ground** (p-sill-angle-ground) → REMOVE.
- **M.S Flat 25x6 For Sill Bracket (Goods)** (p-m-s-flat-25x6-for-sill-bracket-goods)
  → KEEP, GATE: door type = Collapsible.

### BOM CHANGE (PENDING owner OK to apply): create **Sill Angle** section + backfill
Add BOM section "Sill Angle" (Door System), scope
[Door Sill > Auto Door Sill Angle, Small Manufactured Items > Manual Telescopic Sill Angle].
Move 66 angle lines (62 Auto Door Sill Angle + 4 Manual Telescopic Sill Angle) from
category 'Door Sill' → 'Sill Angle'. Narrow Door Sill scope to sills only
(Aluminium Sill, Auto Door SS Sill, Collapsible Landing Sill, Manual Telescopic Sill).
Door Sill keeps 127 sill lines. AWAITING explicit "apply" from owner.

### NEW: door-type gates now needed too (not just drive-type)
M.S Flat 25x6 For Sill Bracket (Goods) = Collapsible door only. Part-list gate model
must support door_type as well as drive_type. (Door-type source for the checklist:
TBD — drawing/BOM-derived; flag at apply time.)

## 18. Door Post / Frame  (12 → 1)
DELETE all (covered by BOM Door System): Auto Door Post CO/AT/AFF/CO-1.2,
Manual Telescopic Door Post, Collapsible Door Post Goods-RHS/Goods-LHS/STD-LHS,
Door Frame 2100/2000, Structure (Door Post).
KEEP only **Bolt+Nut…For Door Frame** (p-bolt-nut-s-w-f-w-for-door-frame), ordered
right after Door Post.

## 19. Linton Panel  (9 → 1; 5 cabin panels deferred)
DELETE p-lintone-pannal, p-lintone-panal, p-linton (covered by BOM Door System).
KEEP **Lintone With Cover** (p-lintone-with-cover), GATE: R1000.
DEFER to Cabin family: the 5 "Cabin Pannel(COP Cutout…/Lintone Panal…)" lines
(p-cabin-pannel* — matched here only on the word "Lintone").
Gate added: Lintone With Cover = R1000.

## 20. Safety Frame / Rod  (12 → 5; Tips Plate deferred)
- **Safety Frame** — ONE line from BOM (merge p-safety-frame, -std, -goods, -goods-mrl,
  -mrl, -mrl-r1, -home; scope Safety Frame).
- KEEP ordered after Safety Frame: **Safety Rod** (p-safety-rod), **UP Right Channel**
  (p-up-right-channel), **Safety Switch Bkt** (p-safety-switch-bkt),
  **Safety Frame Fixing Kit** (p-safety-frame-fixing-kit).
- DEFER to Cabin (from BOM): **Safety Tips Plate** (p-safety-tips-plate).

## 21. Guide Shoe  (4 → 4, renamed, all from BOM)
- p-main-guide-shoe → **"Guide Shoe Main (Gibs/Roller Type)"** (one line, type from BOM).
- p-counter-guide-shoe-holder → **"Counter Guide Shoe Holder"** (keep).
- p-guide-shoe-liner → rename **"Counter Guide Shoe (Gibs)"**.
- p-guide-shoe-cover-vertical-post → **"Guide Shoe Cover Vertical Post"**, GATE: R1000.
Gate added: Guide Shoe Cover Vertical Post = R1000.

## 22. Gathering Clip  (3 → 1)
ONE line **Gathering Clip**, search within sub-category Hardware > Gathering Clip.
Keep p-gathering-clip; delete p-gathering-clip-pvc, p-gathering-clip-m-s.

## 23. Counter / Filler / Dade Weight & Guard  (18 → ~9)  [all categories/items verified to exist]
- DELETE **Dade Weight Rod (MS)** (p-dade-weight-rod-ms).
- MERGE Dade Weight Channel AFF/CO/AT-RHS/AT-LHS (p-dade-weight-channel-aff, -co,
  -at-rhs, -at-lhs) → ONE **"Dead Weight Channel"**, scope [Small Manufactured Items > Dead Weight Channel].
- ADD new line **"Dead Weight"**, scope [Header Systems > Dead Weight25x25].
- **Counter Weight Frame** (p-counter-weight-frame) — from BOM.
- **Counter Guard Net** (p-counter-guard-net) — from BOM.
- MERGE Counter Guard Net Bkt STD/GOODS/plain (p-counter-guard-net-bkt-std, -goods,
  p-counter-guard-net-bkt) → ONE **"Counter Guard Net Bracket"**,
  scope [Small Manufactured Items > Counter Guard Net Bracket].
- **Tension Weight (Tectronics)** → PINNED to inventory item "Tension Weight (Tectronics)"
  (NO search). Delete Tension Weight (plain) + Tension Weight (Tactronics) typo.
- ADD **Tension Spring HOME** → PINNED to inventory item "Tension Spring HOME" (NO search),
  GATE: HOME + BELT + CANTI.
- **Filler Weight** (p-filler-weight) — from BOM. Delete variants (M.S Custting/AHM,
  M.S Flat, C.I Custting).
- **Filler Weight Locking Bracket** (p-filler-weight-locking-bracket) — scope
  [Filler Weight > Filler Weight Locking Bracket].
Gate added: Tension Spring HOME = HOME+BELT+CANTI.

### NEW capture mode: PINNED item (no search)
A line hard-linked to ONE specific inventory item by name, no search box. Used by
Tension Weight (Tectronics) + Tension Spring HOME. Add captureType "fixed" (item_id pinned).

## 24. Limit Switch  (11 → 3 + 3 gated cam lines)
- **Limit Switch** — ONE from BOM (delete #3 N/C(HR), #6 ARKEL, #9 Home, #11 plain).
- **Limit Switch Bracket** — ONE from BOM (p-limit-switch-bkt; delete #2 Limit Channel Thik).
- **Limit Switch Fixing Kit** (p-limit-switch-fixing-kit) — keep. Delete #1 Limit Fixing Kit (p-limit-fixing-kit).
- **Limit Switch Cam** (p-limit-switch-cam), **Limit Switch Cam Bracket** (p-limit-switch-cam-bracket),
  **Limit Switch Cam Channel** (p-limit-switch-cam-channel) → separate part-list lines,
  GATE: HOME + BELT + CANTI.
Gate added: Limit Switch Cam / Cam Bracket / Cam Channel = HOME+BELT+CANTI.

### BOM CHANGE (PENDING approval): break out cam sections (like Sill/Sill Angle)
Add 3 BOM sections — **LIMIT SWITCH CAM**, **LIMIT SWITCH CAM BRACKET**,
**LIMIT SWITCH CAM CHANNEL** (Miscellaneous Items phase, drive gate HOME+BELT+CANTI,
scope Miscallaneous > Limit Switch Items). Backfill is tiny: move the 1 existing line
("Limit Switch Cam Home(1100)" currently under LIMIT SWITCH BRACKET) → LIMIT SWITCH CAM.

## 25. Cam  (Limit Switch Cam ones handled in #24)
- **Retiring Cam Set** (p-retiring-cam-set) — from BOM. Keep.
- **Returning Cam Bkt** (p-returning-cam-bkt) — search sub-category "Returning Cam Bkt",
  ordered after Retiring Cam Set.
- **Stationary Cam** (p-stationary-cam) — ONE line from BOM (section "STA. CAM" — verify).
  Delete p-stationary-cam-std, p-stationary-cam-home.
- **Stationary Cam Bkt Home** (p-stationary-cam-bkt-home) — search sub-category "Stationary Cam Bkt Home".
- **Returning Cam Fixing Kit** (p-returning-cam-fixing-kit) — KEEP, after Returning Cam Bkt.

## 26–28. Canopy + Platform + Cabin  (ALL REMOVED → sourced from Cabin Jobs)
DELETE every Platform, Cabin, and Canopy particular from the hardcoded universe
(~59 sections: Platform 25 + Cabin 24 + Canopy 10, incl. the 5 "Cabin Pannel(…)"
composites and Safety Tips Plate).
At apply, identify by section category under Cabin/Platform/Canopy (not just my regex
family) so nothing cabin-related is missed.

### NEW integration: cabin items from Cabin Jobs
The part list pulls cabin/platform/canopy items, **in serial order**, from the linked
**Cabin Job** (cabin_jobs matched by job_number → cabin_job_lines.sort_order) for the
respective job. Implement at apply: a Cabin-Items block on the part list fed by the
job's Cabin Job. (No hardcoded cabin particulars remain.)

## 29. Doors / Gate / Lock  (38 → ~10, heavy door-type gating)
DELETE (covered by BOM **Door System**): all Door Panels (Landing/Car MT/AT/AFF/CO,
Door Pannel 2000/2100), all Collapsible Gate channels (6+1…15+1), all Swing Door items
(With Frame, Long Vision Glass, Bush, Handel Middum, Handle, Bracket, Gate Lock),
Door Closer Bracket (Lever).
KEEP with gates (all verified to exist):
- **Collapsible Gate Bearing** (#31) — scope Bearing [Hardware vs Spares — CONFIRM which],
  GATE door=Collapsible.
- **Collapsible Top Track Landing + Car** (#3,#28) — scope Small Manufactured Items > Collapsible Top track,
  GATE door=Collapsible.
- **Swing Door Fixing Kit** (#1, free) — GATE door=Swing (when Landing Door Panel = Swing).
- **Door Closer** (#5) — PINNED item "Door Closer" (Small Purchased Items > Door Closer),
  GATE door=Swing.
- **Gate Lock** (#7) — from BOM. **Gate Lock Hardware** (#13 "Gate Lock and Hardware/Gate Lever/Safety")
  — keep, ordered immediately after Gate Lock.
- **Gate Handel** (#33) — scope Miscallaneous > Gate Handel, GATE door=Collapsible.
- **Car Gate Switch Bkt** (#14) — PINNED item "Car Gate Switch Bkt", GATE door=MT+Swing+Collapsible.
- **Telescopic Door Shoe 12mm** (#22) — PINNED item "Telescopic Door Shoe 12mm", GATE door=MT.
PENDING (owner didn't mention): Gate Lock Keeper (#24), Car Gate Arm (#15),
Imperforated Gate (#20), Gate Fixing Kit (#18).
Door gates introduced: door_type values Collapsible / Swing / MT (+AT/AFF/CO already).

## 30. Fan Grill  (3 → 2)
- **Fan Grill** — from BOM (delete Round Fan Grill p-round-fan-grill).
- **Fan Grill Guard** (p-fan-grill-guard) — scope Small Purchased Items > Fan Grill Guard.

## 31. Cable Hanger / Troughing  (4 → 5)
- **PVC Cable Hanger** (p-pvc-cable-hanger) — from BOM.
- DELETE generic **Troughing** (p-troughing) → replace with **Troughing 50** + **Troughing 100**,
  both from BOM (sections TROUGHING 50 / TROUGHING 100).
- **Cable Hangern Bkt** (p-cable-hangern-bkt? verify) → rename **"Cable Hanger Bracket"**,
  scope Small Manufactured Items > Cable Hangern Bkt.
- **Cable Hanger Fixing Kit** (p-cable-hanger-fixing-kit) — keep, free (non-inventory).

## 32. Controller  (3 → 1)
Merge Controller Bracket + (NEW) + (Home) (p-controller-bracket, -new, -home) → ONE line
from BOM section **CONT. STAND**.

---
## ⏳ PENDING OWNER APPROVAL
### BOM changes (bundle + apply together)
1. **Sill Angle split** — add section, move 66 lines, narrow Door Sill.
2. **Limit Switch Cam split** — add 3 sections, move 1 line.
### Part-list flags awaiting answer
- Doors: keep/remove **Gate Lock Keeper**, **Car Gate Arm**, **Imperforated Gate**, **Gate Fixing Kit**.
- Doors: **Collapsible Gate Bearing** → which Bearing (Hardware vs Spares)?
