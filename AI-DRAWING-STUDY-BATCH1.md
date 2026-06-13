# AI Drawing Study — Batch 1 (18 jobs, all drive types)

> First deep-vetting artifact of the drawing→BOM learning program. 18 GA drawings
> were read by vision agents and each correlated against the BOM the engineers
> actually entered. Generated 2026-06-13. Raw run: workflow wf_e461ecab-cdc.
>
> **Nothing here was auto-applied.** These are findings for human vetting — several
> are rules we hold today that the data says should change. Owner decisions flagged ⚠️.

## Verified drawing→BOM patterns (hold across many jobs)

1. **Landing-side qty = stop count** (strongest, ~15/18). Landing Door Panel, Landing
   Header, Door Post, Linton, Magnet Bracket, Gate Lock all carry qty = number of stops;
   car-side stays qty 1. *Independently verified from the BOM.*
2. **Door item name = operation / finish / glass / opening-width tokens**, propagated to
   every door-family line (~16 jobs). CO/AT/SO/Collapsible · SS/MS/Rose Gold · NV/MV/LV · mm.
3. **Drive type lives in item-name tokens, not in which sections appear** (~14). MRL→"…MRL",
   HOME→a whole "Home" family, BELT→"Traction Belt (Flat)" under the (reused) "Wire Rope Main"
   category + "Machine Unit Belt".
4. **Dual DBG** (distance-between-guides): a car-side DBG (Safety Frame) and a counter-side
   DBG (Counter Weight Frame / Filler / Counter Buffer / Machine Beam) — both real, not dupes (~13).
5. **Guide-rail dimension string reorders** into the item name (sort the 3 numbers to match) (~6-7).
   Counterweighted jobs carry two rail sizes (heavy car + light counter) at equal qty.
6. **Governor is always roped**, independent of suspension — belt jobs still use an 8 mm
   governor wire + Speed Governor; rope-end hardware scales by rope diameter.
7. **Capacity → Machine Unit "N pass" token** + a co-varying sheave/pulley/rope signature (~12).
8. **Buffer-type token selects the buffer family** (Spring Buffer → Buffer Spring + stands) (~12).

## ⚠️ Assumptions we hold today that the data CONTRADICTS (owner decisions)

1. **`floors` ≠ stop count — off by one in ~12/18 jobs.** Stored `floors` = landings above
   ground (the N in G+N); total stops = floors + 1. **Verified**: BOM has floors+1 landing
   doors in every complete job checked (CH-010 1→2, BBSR-314 1→2, 4798 4→5, BHT-012 6→7,
   RNLKOL-0024 4→5, 4919 2→3, 4988 1→2). *Impact:* the live MRP is **safe** (it sums the
   entered BOM quantities, not floors×rate). But the AI's floor-scaling and any future
   per-floor logic must use **stops = floors+1** (or read landing qty), and the field's
   meaning should be documented. Also note: a few jobs have multiple openings per stop, so
   the truly authoritative count is the BOM landing qty, not a formula.
2. **`drive_type` is overloaded** — it conflates three orthogonal axes: machine topology
   (MRL vs MR), suspension media (rope vs belt vs hydraulic), and frame geometry (cantilever).
   BELT jobs are physically MRL+belt (the MRL is lost); 4809 stores CANTI (a frame type) but
   is MRL-traction; RNLKOL-0024 stores MR but the BOM is decisively MRL. **BOM_SECTIONS gating
   off one drive_type will mis-gate hybrids.** Recommendation: split into machine_topology /
   suspension_media / frame_type, and treat the BOM item tokens (MRL/Home/Belt/CANTILEVER) as
   ground truth — do NOT auto-overwrite human entries.
3. **Capacity in passengers is lossy and sometimes wrong-class.** 5001 is labelled 6PASS but
   is a 4000 KG **goods** lift; 4847 is labelled 6PASS but is a 16-passenger car (dropped
   leading "1"). The Machine Unit "N pass" token is a better authority. Store rated KG too,
   add a goods flag (goods lifts override the drawing door with collapsible-gate hardware).
4. **The door spec lives only in BOM tokens** — the door_type/door_finish columns are dead/NULL.
   Door rules must read the BOM tokens, and special-case goods/collapsible.
5. **A BOM is NOT always a complete takeoff.** 4411 has zero lines; RNLKOL-0035 / 5001 / 4847 /
   RNLKOL-0024 / RNLKEL0018 are missing first-phase rails/brackets/door-frames while *keeping
   their fasteners* ("rail clips but no guide rail" = a reliable incomplete-BOM signal). Don't
   learn "this drive type omits rails" from these — they're data-entry gaps.
6. **Cabin/electrical scope is intentionally NOT on the job BOM** (controllers, COP/LOP, ARD,
   cabin panels live in cabin_jobs / bought-out packages). The rules engine must not flag them
   as missing. The job BOM = mechanical/erection scope.
7. **Rope/belt quantities are LENGTHS (metres), not pieces** — "Traction Belt (Flat)" qty 130 is
   metres; "Wire Rope 8mm" qty 100-372 is metres. No UoM on the line. MRP reading these as piece
   counts would be catastrophically wrong.

## Systemic data-quality issues (fix before trusting for training)
- Floors off-by-one convention unresolved (highest impact) — back-fill from BOM landing counts.
- drive_type overloaded/mismatched (6+ jobs) — derive physical config from BOM tokens.
- Capacity wrong-class records (5001 goods, 4847 16-pass) — cross-check vs Machine Unit token.
- Empty/partial BOMs presented as real (4411 zero lines; fasteners-without-rails) — completeness gate.
- Same item name across two categories (Wire Rope Main vs Governor; Pulley Main vs Counter;
  Limit Switch in two categories) — double-count risk; aggregate category-aware.
- Item-name typos pervasive (Pannel, Alluminium, Linton, Thimbel, Pully) — parser must be
  typo-tolerant and preserve DB spellings.
- Intra-drawing conflicts (multi-sheet revisions) — the BOM-built revision usually wins.
- Many drawing fields (rail forces, hook loads, retrofit notes, brand) produce NO BOM line.

## Recommended next steps (the months-long program)
1. **Decide the `floors` convention** and back-fill/validate from BOM landing counts. (Owner call.)
2. **Split `drive_type`** into machine_topology / suspension_media / frame_type. (Owner call; schema.)
3. **Build a token parse/emit layer** over item names — start with the door-family generator
   (operation+width+finish+glass → ~8 lines), the cleanest, best-supported rule.
4. **BOM-completeness gate** before admitting a job to the training corpus.
5. **Resolve UoM ambiguity** on rope/belt lines (metres vs pieces); dedup shared item names.
6. **Capacity cross-check** (store KG + passengers) + goods flag.
7. **Expand the sample** to untested cells: more HYD (the one example is internally contradictory —
   roped-hydraulic, needs engineer confirmation), an oil/hydraulic-buffer job, a side-opening door,
   a confirmed single-rail (non-counterweighted) job.
8. **Document the mechanical-vs-cabin scope boundary** so the engine never flags cabin items missing.

## Drive-type characterization (from the batch)
- **MRL** (5, the cleanest group): "Counter Weight Frame MRL" + "Machine Beam …MRL" + "Controller
  Bracket MRL" + gearless Machine Unit + PVC/C.I. sheaves (often 2:1 → 2× Pulley Main).
- **MR** (3): geared Machine Unit, free-standing "Controller Bracket STD", two rail sizes, full
  counterweight cluster. 5001 is a 4000 KG goods-MR with collapsible gate.
- **HOME** (4, 1 empty): "Home"-suffixed bundle, V3F, small 4-pass/200 mm sheave/6 mm rope, KG capacity.
- **BELT** (4): MRL + flat-belt suspension; belt under "Wire Rope Main"; governor still steel rope.
- **HYD** (1): oil pot/Mobil/grease + "Safety Frame (GMV Hydraulic)" — but ALSO carries wire rope +
  governor + machine unit (roped-hydraulic or template artifact); **needs engineer confirmation**.
- **CANTI** (1): a car-FRAME geometry (cantilever sling), simultaneously MRL-traction — not a drive.
