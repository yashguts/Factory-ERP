/**
 * Build the NEW curated packing-list-sections.ts + section-groups.json from the
 * owner's family-by-family decisions (docs/partlist-cleanup-decisions.md).
 *
 * Reads scripts/_packing_sections.json (the current 501) and:
 *  - keeps/edits/merges/renames the curated front lines (CURATED, in order),
 *  - adds NEW lines,
 *  - drops every other line in a DECIDED family,
 *  - parks Fasteners + Other + the 4 door flags at the END (as-is),
 * then emits the .ts (extended model: drives/doors gates, captureType "fixed"
 * + pinnedItem) and section-groups.json (key -> group for the completion gate).
 *
 * Run: node scripts/_partlist_build.js
 */
const fs = require("fs");
const path = require("path");
// Read the PRISTINE original 501 (never the overwritten output) so re-runs are idempotent.
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, "_packing_sections.backup.json"), "utf8"));
const byKey = new Map(SRC.map((s) => [s.key, s]));

// Drive codes: MR MRL HOME BELT MRLBELT HYD CANTI R1000. Door codes: COLLAPSIBLE SWING MT AT AFF CO.
// cats: array of full category paths (picker scope + BOM blend). pin: inventory item name (captureType "fixed").
const C = (key, label, opts = {}) => ({ key, label, ...opts });

// ----- CURATED front, in assembly order. group = checklist group. -----
const CURATED = [
  // Rails & fish plate
  C("p-guide-rail-main", "Guide Rail (Main)", { group: "Rails", cats: ["Large Purchased Items > Guide Rail"] }),
  C("p-guide-rail-counter", "Guide Rail (Counter)", { group: "Rails", cats: ["Large Purchased Items > Guide Rail"] }),
  C("p-fish-plate", "Fish Plate", { group: "Rails" }),
  C("p-rail-clip", "Rail Clip", { group: "Rails", merge: ["p-rail-clip-main", "p-rail-clip-counter"], cats: ["Hardware > Rail Clip"] }),
  C("p-rail-fixing-bracket-structure", "Rail Fixing Bracket (Structure)", { group: "Rails" }),
  C("p-rail-fixing-kit", "Rail Fixing Kit", { group: "Rails", capture: "free" }),

  // Rail brackets (from BOM) + their fasteners
  C("p-rail-bracket-main", "Main Bracket", { group: "Brackets", merge: ["p-rail-bracket-main-fabricated", "p-main-rail-bracket", "p-rail-bracket-main-combination", "p-rail-bracket-main-home", "p-main-rail-bracket-for-platfrom-support", "p-main-rail-bracket-b-50-100-mm", "p-combination-leg", "p-combination-lag-std", "p-combinition-bracket", "p-combinition-bracket-cutting-240mm", "p-rail-combination-channel", "p-rail-bracket-home"], cats: ["Rail Bracket > Rail Bracket Main", "Rail Bracket > Rail Bracket Combination Main", "Rail Bracket > Rail Bracket Combination Home"] }),
  C("p-rail-bracket-counter", "Counter Bracket", { group: "Brackets", merge: ["p-counter-rail-bracket", "p-rail-bracket-counter-home", "p-rail-bracket-counter-fabricated"], cats: ["Rail Bracket > Rail Bracket Counter"] }),
  C("p-fastner-rail-bracket", "Fastner (Rail Bracket)", { group: "Brackets" }),
  C("p-bolt-nut-d-fw-s-w-rail-bracket", "Bolt+Nut+d.fw+s.w (Rail Bracket)", { group: "Brackets", capture: "free" }),

  // Machine & governor
  C("p-machine-unit", "Machine Unit", { group: "Machine", merge: ["p-machine-unit-seg-35", "p-machine-unit-seg-20", "p-machine-unit-sharp-seg-50", "p-machine-unit-seg-45", "p-machine-unit-sharp-seg-40", "p-machine-unit-bbl", "p-machine-unit-nidec", "p-machine-unit-sharp", "p-machine-unit-sharp-seg-30", "p-machine-unit-sharp-seg-05", "p-machine-unit-belt", "p-machine-unit-seg-05-sharp", "p-machine-unit-traction"], cats: ["Large Purchased Items > Machine Unit"], drives: ["MR", "MRL", "HOME", "BELT", "MRLBELT", "CANTI", "R1000"] }),
  C("p-gmv", "Power Pack", { group: "Machine", cats: [], drives: ["HYD"] }),
  C("p-machine-beam", "Machine Beam", { group: "Machine", cats: ["Machine Beam"] }),
  C("p-machine-beam-bkt", "Machine Beam Bracket", { group: "Machine", merge: ["p-machine-beam-bkt-450mm"], cats: ["Machine Beam > Machine Beam Bracket"], drives: ["MRL"] }),
  C("p-machine-base-with-bracket", "Machine Base With Bracket", { group: "Machine", drives: ["R1000"] }),
  C("p-machine-support-base-bracket", "Machine Support Base Bracket", { group: "Machine", drives: ["R1000"] }),
  C("p-machine-lifting-frame-with-counter-gide-shoe", "Machine Lifting Frame With Counter Guide Shoe", { group: "Machine", drives: ["R1000"] }),
  C("p-machine-lifting-frame-with", "Machine Lifting Frame", { group: "Machine", drives: ["R1000"] }),
  C("p-speed-governor-both", "Speed Governor", { group: "Machine", merge: ["p-speed-governor-sr-no"], cats: ["Small Purchased Items > Speed Governor"] }),
  C("p-speed-governor-fixing-kit", "Speed Governor Fixing Kit", { group: "Machine", capture: "free", drives: ["HOME", "BELT", "CANTI"] }),
  C("p-governor-extension-plate", "Governor Extension Plate", { group: "Machine", drives: ["HOME", "BELT", "CANTI"] }),
  C("p-governor-switch", "Governor Switch", { group: "Machine", cats: ["Miscallaneous > Governor Switch"], drives: ["HOME", "BELT", "CANTI"] }),

  // Rope / belt + rope hardware
  C("p-wire-rope-main", "Wire Rope Main/Belt Main", { group: "Rope", cats: ["Large Purchased Items > Wire Rope", "Large Purchased Items > Belt"] }),
  C("p-wire-rope-gov", "Wire Rope (Gov)", { group: "Rope", cats: ["Large Purchased Items > Wire Rope"] }),
  C("p-thimbel", "Thimble", { group: "Rope", merge: ["p-thimbel-o-type"], cats: ["Hardware > Thimbel"] }),
  C("__new_i_bolt_belt", "I-Bolt Belt", { group: "Rope", capture: "free", drives: ["BELT", "MRLBELT"] }),
  C("p-bull-dog-clip", "Bull Dog Clip", { group: "Rope", merge: ["p-bull-dog-clip-main", "p-bull-dog-clip-gov"], cats: ["Hardware > Bull Dog Clips"] }),
  C("p-bull-dog-clip-belt", "Bull Dog Clip (Belt)", { group: "Rope", capture: "free", drives: ["BELT", "MRLBELT"] }),
  C("p-d-shackle", '"D" Shackle', { group: "Rope", cats: ['Hardware > "D" Shackle'] }),

  // Pulleys
  C("__new_pulley_main", "Pulley (Main)", { group: "Pulley", cats: ["Pulley Items"] }),
  C("__new_pulley_counter", "Pulley (Counter)", { group: "Pulley", cats: ["Pulley Items"] }),
  C("__new_pulley_diverter", "Pulley (Diverter)", { group: "Pulley", cats: ["Pulley Items"] }),
  C("p-main-pully-rope-guard", "Main Pulley Rope Guard", { group: "Pulley", capture: "free" }),
  C("p-counter-pully-rope-guard", "Counter Pulley Rope Guard", { group: "Pulley", capture: "free", merge: ["p-counter-pully-rope-guard-40x6-flat"] }),
  C("p-chain-pully", "Chain Pully", { group: "Pulley" }),

  // Oils (fixed-spec in name, drive-gated)
  C("p-synthetic-oil", "Synthetic Oil G-220", { group: "Oil", cats: ["Small Purchased Items > Oil/Mobil"], drives: ["MR"], specHint: "" }),
  C("p-hydraulic-oil", "Hydraulic Oil Grade-68", { group: "Oil", cats: ["Small Purchased Items > Oil/Mobil"], drives: ["HYD"], specHint: "" }),

  // Header / sill adjustable bracket + fasteners (after Door System)
  C("p-header-bracket-mt", "Sill & Header Adjustable Bracket", { group: "Header & Sill", merge: ["p-header-bracket-co", "p-header-bracket-at"], cats: ["Adjustable Bracket > Sill & Header Adjustable Bracket"] }),
  C("p-fastner-for-header-bracket", "Fastner For Header Bracket", { group: "Header & Sill" }),
  C("p-bolt-nut-s-w-f-w-for-header-fixing", "Bolt+Nut For Header Fixing", { group: "Header & Sill", capture: "free" }),
  C("p-bolt-nut-s-w-f-wd-for-header-sill-bkt", "Bolt+Nut For Header+Sill Bkt", { group: "Header & Sill", capture: "free" }),
  C("p-fastner-for-sill-bracket", "Fastner For Sill Bracket", { group: "Header & Sill", cats: ["Small Manufactured Items > Sill Bracket"] }),

  // Sill (Door Sill + Sill Angle from BOM) + sill fasteners
  C("__new_door_sill", "Door Sill", { group: "Header & Sill", cats: ["Door Sill > Aluminium Sill", "Door Sill > Auto Door SS Sill", "Door Sill > Collapsible Landing Sill", "Door Sill > Manual Telescopic Sill"] }),
  C("__new_sill_angle", "Sill Angle", { group: "Header & Sill", cats: ["Door Sill > Auto Door Sill Angle", "Small Manufactured Items > Manual Telescopic Sill Angle"] }),
  C("p-m-s-flat-25x6-for-sill-bracket-goods", "M.S Flat 25x6 For Sill Bracket (Goods)", { group: "Header & Sill", cats: ["Small Manufactured Items > Sill Bracket"], doors: ["COLLAPSIBLE"] }),
  C("p-c-s-k-screw-for-ss-sill", "C.S.K SS Screw", { group: "Header & Sill", capture: "free" }),
  C("p-screw-c-s-k-for-car-sill", "Screw C.S.K MS Car Sill", { group: "Header & Sill", capture: "free" }),
  C("p-bolt-nut-s-w-f-wd-for-sill-fixing", "Bolt+Nut For Sill Fixing", { group: "Header & Sill", capture: "free" }),

  // Door System — door posts, panels & headers flow in FROM the BOM (one line per
  // BOM item) via these generic catch lines; no hardcoded door-type variants.
  C("__new_header_system", "Header System (Landing/Car)", { group: "Header & Sill", cats: ["Header Systems > Landing Header System", "Header Systems > Car Header System", "Header Systems > HEADER", "Header Systems > Manual Telescopic Landing Header System", "Header Systems > Manual Telescopic Car Header System"] }),
  C("__new_door_post", "Door Post", { group: "Doors", cats: ["Door Post/Frame"] }),
  C("__new_door_panel", "Door Panel (Landing/Car)", { group: "Doors", cats: ["Landing Door Pannel", "Car Door Pannel"] }),
  C("p-bolt-nut-s-w-f-w-for-door-frame", "Bolt+Nut For Door Frame", { group: "Doors", capture: "free" }),

  // Doors kept (gated)
  C("p-gate-lock", "Gate Lock", { group: "Doors", cats: ["Small Purchased Items > Gate Lock Items"] }),
  C("p-gate-lock-and-hardware-gate-lever-safety", "Gate Lock Hardware", { group: "Doors", cats: ["Hardware"] }),
  C("p-collapsible-top-track-landing", "Collapsible Top Track Landing", { group: "Doors", cats: ["Small Manufactured Items > Collapsible Top track"], doors: ["COLLAPSIBLE"] }),
  C("p-collapsible-top-track-car", "Collapsible Top Track Car", { group: "Doors", cats: ["Small Manufactured Items > Collapsible Top track"], doors: ["COLLAPSIBLE"] }),
  C("p-collapsible-gate-bearing", "Collapsible Gate Bearing", { group: "Doors", cats: ["Hardware > Bearing"], doors: ["COLLAPSIBLE"] }),
  C("p-gate-handel", "Gate Handel", { group: "Doors", cats: ["Miscallaneous > Gate Handel"], doors: ["COLLAPSIBLE"] }),
  C("p-swing-door-fixing-kit", "Swing Door Fixing Kit", { group: "Doors", capture: "free", doors: ["SWING"] }),
  C("p-door-closer", "Door Closer", { group: "Doors", capture: "fixed", pin: "Door Closer", doors: ["SWING"] }),
  C("p-car-gate-switch-bkt", "Car Gate Switch Bkt", { group: "Doors", capture: "fixed", pin: "Car Gate Switch Bkt", doors: ["MT", "SWING", "COLLAPSIBLE"] }),
  C("p-telescopic-door-shoe-12mm", "Telescopic Door Shoe 12mm", { group: "Doors", capture: "fixed", pin: "Telescopic Door Shoe 12mm", doors: ["MT"] }),

  // Linton
  C("p-lintone-with-cover", "Lintone With Cover", { group: "Doors", drives: ["R1000"] }),

  // Safety frame & rod
  C("p-safety-frame", "Safety Frame", { group: "Safety", merge: ["p-safety-frame-std", "p-safety-frame-goods-mrl", "p-safety-frame-mrl", "p-safety-frame-goods", "p-safety-frame-mrl-r1", "p-safety-frame-home"], cats: ["Safety Frame"] }),
  C("p-safety-rod", "Safety Rod", { group: "Safety", cats: ["Small Manufactured Items > Safety Rod"] }),
  C("p-up-right-channel", "UP Right Channel", { group: "Safety", cats: ["Safety Frame > UP Right Channel"] }),
  C("p-safety-switch-bkt", "Safety Switch Bkt", { group: "Safety", cats: ["Small Manufactured Items > Safety Switch Bkt"] }),
  C("p-safety-frame-fixing-kit", "Safety Frame Fixing Kit", { group: "Safety", capture: "free" }),

  // Guide shoes
  C("p-main-guide-shoe", "Guide Shoe Main (Gibs/Roller Type)", { group: "Safety", cats: ["Guide Shoe"] }),
  C("p-counter-guide-shoe-holder", "Counter Guide Shoe Holder", { group: "Safety", cats: ["Miscallaneous > Counter Guide Shoe Holder"] }),
  C("p-guide-shoe-liner", "Counter Guide Shoe (Gibs)", { group: "Safety", cats: ["Guide Shoe"] }),
  C("p-guide-shoe-cover-vertical-post", "Guide Shoe Cover Vertical Post", { group: "Safety", drives: ["R1000"] }),
  C("p-gathering-clip", "Gathering Clip", { group: "Safety", merge: ["p-gathering-clip-pvc", "p-gathering-clip-m-s"], cats: ["Hardware > Gathering Clip"] }),

  // Counter / filler / dead weight & guard
  C("p-counter-weight-frame", "Counter Weight Frame", { group: "Counter", cats: ["Counter Weight Frame"] }),
  C("p-dade-weight-channel-co", "Dead Weight Channel", { group: "Counter", merge: ["p-dade-weight-channel-aff", "p-dade-weight-channel-at-rhs", "p-dade-weight-channel-at-lhs"], cats: ["Small Manufactured Items > Dead Weight Channel"] }),
  C("__new_dead_weight", "Dead Weight", { group: "Counter", cats: ["Header Systems > Dead Weight25x25"] }),
  C("p-counter-guard-net", "Counter Guard Net", { group: "Counter", cats: ["Small Manufactured Items > Counter Guard Net"] }),
  C("p-counter-guard-net-bkt", "Counter Guard Net Bracket", { group: "Counter", merge: ["p-counter-guard-net-bkt-std", "p-counter-guard-net-bkt-goods"], cats: ["Small Manufactured Items > Counter Guard Net Bracket"] }),
  C("p-tension-weight-tectronics", "Tension Weight (Tectronics)", { group: "Counter", capture: "fixed", pin: "Tension Weight (Tectronics)" }),
  C("__new_tension_spring_home", "Tension Spring HOME", { group: "Counter", capture: "fixed", pin: "Tension Spring HOME", drives: ["HOME", "BELT", "CANTI"] }),
  C("p-filler-weight", "Filler Weight", { group: "Counter", cats: ["Filler Weight"] }),
  C("p-filler-weight-locking-bracket", "Filler Weight Locking Bracket", { group: "Counter", cats: ["Filler Weight > Filler Weight Locking Bracket"] }),

  // Limit switch + cam
  C("p-limit-switch", "Limit Switch", { group: "Limit & Cam", merge: ["p-limit-switch-n-c-hr", "p-limit-switch-arkel", "p-limit-switch-home"], cats: ["Miscallaneous > Limit Switch Items"] }),
  C("p-limit-switch-bkt", "Limit Switch Bracket", { group: "Limit & Cam", merge: ["p-limit-channel-thik"], cats: ["Miscallaneous > Limit Switch Items"] }),
  C("p-limit-switch-fixing-kit", "Limit Switch Fixing Kit", { group: "Limit & Cam", capture: "free" }),
  C("p-limit-switch-cam", "Limit Switch Cam", { group: "Limit & Cam", cats: ["Miscallaneous > Limit Switch Items"], drives: ["HOME", "BELT", "CANTI"] }),
  C("p-limit-switch-cam-bracket", "Limit Switch Cam Bracket", { group: "Limit & Cam", drives: ["HOME", "BELT", "CANTI"] }),
  C("p-limit-switch-cam-channel", "Limit Switch Cam Channel", { group: "Limit & Cam", drives: ["HOME", "BELT", "CANTI"] }),
  C("p-retiring-cam-set", "Retiring Cam Set", { group: "Limit & Cam", cats: ["Small Purchased Items > Retiring Cam Set"] }),
  C("p-returning-cam-bkt", "Returning Cam Bkt", { group: "Limit & Cam", cats: ["Small Manufactured Items > Returning Cam Bkt"] }),
  C("p-returning-cam-fixing-kit", "Returning Cam Fixing Kit", { group: "Limit & Cam", capture: "free" }),
  C("p-stationary-cam", "Stationary Cam", { group: "Limit & Cam", merge: ["p-stationary-cam-std", "p-stationary-cam-home"], cats: ["Small Manufactured Items > Stationary Cam STD", "Small Manufactured Items > Stationary Cam Home", "Small Manufactured Items > Stationary Cam Drumbwater"] }),
  C("p-stationary-cam-bkt-home", "Stationary Cam Bkt Home", { group: "Limit & Cam", cats: ["Small Manufactured Items > Stationary Cam Bkt Home"] }),

  // Fan grill, cable hanger, controller
  C("p-fan-grill", "Fan Grill", { group: "Misc Fitted", merge: ["p-round-fan-grill"], cats: ["Small Purchased Items > Fan Grill"] }),
  C("p-fan-grill-guard", "Fan Grill Guard", { group: "Misc Fitted", cats: ["Small Purchased Items > Fan Grill Guard"] }),
  C("p-pvc-cable-hanger", "PVC Cable Hanger", { group: "Misc Fitted", cats: ["Small Purchased Items > PVC Cable Hanger"] }),
  C("p-troughing", "Troughing 50", { group: "Misc Fitted", cats: ["Small Manufactured Items > Troughing"] }),
  C("__new_troughing_100", "Troughing 100", { group: "Misc Fitted", cats: ["Small Manufactured Items > Troughing"] }),
  C("p-cable-hangern-bkt", "Cable Hanger Bracket", { group: "Misc Fitted", cats: ["Small Manufactured Items > Cable Hangern Bkt"] }),
  C("p-cable-hanger-fixing-kit", "Cable Hanger Fixing Kit", { group: "Misc Fitted", capture: "free" }),
  C("p-controller-bracket", "Controller Bracket", { group: "Misc Fitted", merge: ["p-controller-bracket-new", "p-controller-bracket-home"], cats: ["Small Manufactured Items > Controller Bracket"] }),

  // Cabin Items — main panels come from the linked Cabin Job (dynamic holder,
  // filled at generate time); the smaller cabin-interior/finishing parts are
  // pulled in from inventory.
  C("__new_cabin_from_job", "Cabin Panels (from Cabin Job)", { group: "Cabin Items", cats: ["Cabin"] }),
  C("p-cabin-handrail-with-cover", "Cabin Handrail", { group: "Cabin Items", cats: ["Cabin"] }),
  C("p-cabin-glass-10mm", "Cabin Glass", { group: "Cabin Items", cats: ["Glass > Cabin Glass"] }),
  C("p-flooring", "Flooring", { group: "Cabin Items" }),
  C("p-floor-tiles", "Floor Tiles", { group: "Cabin Items" }),
  C("p-chequered-plate", "Chequered Plate", { group: "Cabin Items" }),
  C("p-skirting", "Skirting", { group: "Cabin Items" }),
  C("p-toe-guard", "Toe Guard", { group: "Cabin Items", cats: ["Small Manufactured Items > Facia Plate/Bracket"] }),
  C("p-toe-guard-bracket", "Toe Guard Bracket", { group: "Cabin Items" }),
  C("p-kick-angle", "Kick Angle", { group: "Cabin Items" }),
  C("p-rubber-pad", "Cabin Rubber Pad", { group: "Cabin Items" }),
  C("p-handle-with-cover", "Handle With Cover", { group: "Cabin Items" }),
  C("p-danger-plate", "Danger Plate", { group: "Cabin Items" }),
  C("p-car-location-plate", "Car Location Plate", { group: "Cabin Items" }),
  C("p-safety-tips-plate", "Safety Tips Plate", { group: "Cabin Items" }),

  // ===== "Other items" un-parked per OTHER ITEMS I.xlsx (owner disposition) =====
  // REQUIRED IN blank → open (no drives gate). New-to-create items → free (fillable).
  // Machine
  C("p-brack-releser-stand", "Break Releaser Stand", { group: "Machine", capture: "free", drives: ["MRL", "HOME", "BELT", "MRLBELT", "CANTI"] }),
  C("p-hydraulic-stand", "Hydraulic Stand", { group: "Machine", capture: "free", drives: ["MRL", "MRLBELT"] }),
  C("p-islution-rubber-pad", "Islution Rubber Pad", { group: "Machine", cats: ["Small Purchased Items > Machine Rubber Pad"] }),
  C("p-machine-rubber-pad", "Machine Rubber Pad", { group: "Machine", cats: ["Small Purchased Items > Machine Rubber Pad"] }),
  C("p-m-s-plate-10mm", "M.S Plate (10mm)", { group: "Machine", capture: "free", drives: ["MR"] }),
  C("p-m-s-flat-50x6mm", "M.S Flat (50x6mm)", { group: "Machine", capture: "free", drives: ["MR"] }),
  // Rope hardware
  C("p-g-i-wire", "G.I Wire", { group: "Rope", cats: ["Small Purchased Items > G.I Wire"] }),
  C("p-i-bolt", "I-Bolt", { group: "Rope", cats: ["Hardware > I-Bolt Rod"] }),
  // Brackets / header & sill
  C("p-fastner-for-supporting-bracket", "Fastner For Supporting Bracket", { group: "Brackets", cats: ["Hardware > Brick Dasfastner", "Hardware > Stud Anchor"] }),
  C("p-supporting-bracket-mt", "Supporting Bracket MT", { group: "Header & Sill", cats: ["Miscallaneous > Supporting Bracket"] }),
  // Doors / electricals
  C("p-lock-latch-with-m-f-contact", "Lock Latch With M/F Contact", { group: "Doors", capture: "free" }),
  C("p-firemans-switch-box-red", "Fireman's Switch Box (RED)", { group: "Misc Fitted", cats: ["Small Purchased Items > Fireman's Switch Box"], doors: ["AT", "AFF", "CO"] }),
  // Counter / buffer (gated to non-HOME drives per sheet)
  C("p-buffer-spring", "Buffer Spring", { group: "Counter", cats: ["Hardware > Buffer Spring"] }),
  C("p-hitch-plate", "Hitch Plate", { group: "Counter", cats: ["Miscallaneous > Hitch Plate"] }),
  C("p-buffer-mounting-channel-main", "Buffer Mounting Channel Main", { group: "Counter", cats: ["Small Manufactured Items > Buffer Channel"], drives: ["MR", "MRL", "MRLBELT", "CANTI"] }),
  C("p-buffer-mounting-channel-counter", "Buffer Mounting Channel Counter", { group: "Counter", cats: ["Small Manufactured Items > Buffer Channel"], drives: ["MR", "MRL", "MRLBELT", "CANTI"] }),
  C("p-buffer-stand-main-std", "Buffer Stand Main (STD)", { group: "Counter", cats: ["Small Manufactured Items > Buffer Stand"], drives: ["MR", "MRL", "MRLBELT", "CANTI"] }),
  C("p-buffer-stand-counter-std", "Buffer Stand Counter (STD)", { group: "Counter", cats: ["Small Manufactured Items > Buffer Stand"], drives: ["MR", "MRL", "MRLBELT", "CANTI"] }),
  // Misc fitted
  C("p-pit-ladder", "Pit Ladder", { group: "Misc Fitted", cats: ["Miscallaneous > Pit Ladder"] }),
  C("p-pit-ladder-handle", "Pit Ladder Handle", { group: "Misc Fitted", cats: ["Miscallaneous > Pit Ladder"] }),
  C("p-cotton-tape", "Cotton Tape", { group: "Misc Fitted", cats: ["Miscallaneous > Cotton Tape"] }),
  C("p-addisive-tape", "Adhesive Tape", { group: "Misc Fitted", capture: "free" }),
  // Cabin / finishing
  C("p-floor-mat-tape", "Floor Mat Tape", { group: "Cabin Items", cats: ["Packaging Materials > Tape"] }),
  C("p-top-channel", "Top Channel", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-top-channel-corner-support", "Top Channel Corner Support", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-top-channel-with-shaft-and-plate", "Top Channel With Shaft and Plate", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-scareing-with-cover", "Scarating With Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-top-scarating-with-cover", "Top Scarating With Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-slide-brassing", "Slide Brassing", { group: "Cabin Items", cats: ["Small Manufactured Items > Slide Brassing"], drives: ["MR", "MRL"] }),
  // batch 2 (M/C Beam, Car Location, Glass Angle, D-Locking Key) per owner disposition
  C("p-m-c-beam-with-cover", "Machine Beam with Cover", { group: "Machine", capture: "free", drives: ["R1000"] }),
  C("p-car-location", "Car Location", { group: "Cabin Items", cats: ["Miscallaneous > Car Location"], drives: ["MR"] }),
  C("p-glass-angle", "Glass Angle", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-d-locking-key", "D-Locking Key", { group: "Doors", capture: "free" }),
  // batch 3 — R1000 structure / Eco Space body & covers (owner: R1000 only)
  C("p-structure-part", "STRUCTURE PART:-", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-structure-front", "Structure Front", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-structure-post", "Structure Post", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-structure-dooe", "Structure Dooe", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-structure-horizontanal-channel-with-cover", "Structure Horizontanal Channel With Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-ground-horizontanal-channel-with-cover", "Ground Horizontanal Channel With Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-m-c-beam-area-horizontanal-channel", "M/C Beam Area Horizontanal Channel", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-m-c-beam-area-cover", "M/C Beam Area Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-front-top-support", "Front Top Support", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-left-side-support-rail", "Left Side Support (Rail)", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-right-side-support-glass", "Right Side Support (Glass)", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-front-side-cover", "Front Side Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-left-side-cover", "Left Side Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-back-side-cover", "Back Side Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-right-side-cover", "Right Side Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-plat-from-support-channel", "Plat From Support Channel", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-plat-from-support-channel-3mm", "Plat From Support Channel 3mm", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-plat-from-support-channel-belt", "Plat From Support Channel (Belt)", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("p-structure-glass-6mm", "Structure Glass 6mm", { group: "Cabin Items", cats: ["Glass > Structure Glass"], drives: ["R1000"] }),
  // batch 4 — M.S misc plates/packing (owner: Make, Miscellaneous, open to all, manual qty)
  C("p-m-s-plate-3mm", "M.S Plate 3mm (100x100)", { group: "Misc Fitted", cats: [], merge: ["p-m-s-plate", "p-ms-plat-100x100"] }),
  C("p-ms-flat-40x6", "MS Flat 40x6", { group: "Misc Fitted", cats: [] }),
  C("p-m-s-packing-for-rubber-pad", "M.S Packing For Rubber Pad", { group: "Misc Fitted", cats: [] }),
  C("p-m-s-packing", "M.S Packing", { group: "Misc Fitted", cats: [] }),
  C("p-m-s-bush", "M.S Bush", { group: "Misc Fitted", capture: "fixed", pin: "M.S Bush Tele & Auto Shoe" }),
  C("p-stiffner", "Stiffener", { group: "Misc Fitted", capture: "fixed", pin: "Stiffner 25X6/400mm Flat" }),
  // batch 5 — merge 6 Sensor Angle variants -> 1; all drives except R1000, door type AT
  C("p-sensor-angle-2700mm-with-bkt-2nos", "Sensor Angle (2700mm) With Bkt-2nos", { group: "Doors", capture: "free", drives: ["MR", "MRL", "HOME", "BELT", "MRLBELT", "HYD", "CANTI"], doors: ["AT"], merge: ["p-sensor-angle", "p-sensor-angle-2700mm", "p-sensor-angle-with-bkt-2nos", "p-sensor-angle-with-bracket-2nos", "p-sensor-angle-2700mm-with-bkt-4nos"] }),
  // batch 6 — Reed/Magnet door-sensor system (owner: open to all, Make, manual qty)
  C("p-read-channel", "Read Channel", { group: "Doors", cats: ["Small Manufactured Items > Read Channel/Switch Items"] }),
  C("p-read-bracket", "Read Bracket", { group: "Doors", capture: "free" }),
  C("p-read-switch-bracket-spl", "Read Switch Bracket (SPL)", { group: "Doors", cats: ["Small Manufactured Items > Read Channel/Switch Items"] }),
  C("p-magnet", "Magnet", { group: "Doors", capture: "free" }),
  C("p-magnet-bracket", "Magnet Bracket", { group: "Doors", cats: ["Small Manufactured Items > Magnet Bracket"] }),
  C("p-magnet-trey", "Magnet trey", { group: "Doors", cats: ["Small Manufactured Items > Magnet Trey"] }),

  // Eco Space Structure Kit — R1000-only, fillable (items to be created in DB later).
  C("p-eco-space-structure-kit", "Eco Space Structure Kit", { group: "Cabin Items", capture: "free", drives: ["R1000"], specHint: "Colour: Graphite" }),
  C("p-structure-vartical-post", "Structure Vertical Post", { group: "Cabin Items", capture: "free", drives: ["R1000"], specHint: "2450mm / variable" }),
  C("p-structure-horizontanal-part", "Structure Horizontal Part", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("__new_eco_horiz_front", "Structure Horizontal Front Side", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("__new_eco_swing_linten", "Structure Swing Door Linten", { group: "Cabin Items", capture: "free", drives: ["R1000"], specHint: "714x135mm" }),
  C("__new_eco_swing_sill", "Structure Swing Door Sill", { group: "Cabin Items", capture: "free", drives: ["R1000"], specHint: "714x85mm" }),
  C("__new_eco_top_front", "Structure Horizontal Top Front Side", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("__new_eco_machine_cover", "Structure Machine Side Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("__new_eco_horiz_glass", "Horizontal Glass Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("__new_eco_vert_glass", "Vertical Glass Cover", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("__new_eco_pit_plate", "Pit Plate", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("__new_eco_net", "Structure Net (Small Jali)", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("__new_eco_magnet_bkt", "Magnet Bracket (Eco Space)", { group: "Cabin Items", capture: "free", drives: ["R1000"], specHint: "800x70mm" }),
  C("__new_eco_glass_pc", "Glass (Poly Carbonet) 6mm", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
  C("__new_eco_fasteners", "Eco Space Fasteners (Bolts/Screws/Rivets)", { group: "Cabin Items", capture: "free", drives: ["R1000"] }),
];

// New lines that don't reuse an existing key get a fresh slug.
const NEW = {
  "__new_i_bolt_belt": "p-i-bolt-belt",
  "__new_pulley_main": "p-pulley-main",
  "__new_pulley_counter": "p-pulley-counter",
  "__new_pulley_diverter": "p-pulley-diverter",
  "__new_door_sill": "p-door-sill",
  "__new_sill_angle": "p-sill-angle-bom",
  "__new_dead_weight": "p-dead-weight",
  "__new_tension_spring_home": "p-tension-spring-home",
  "__new_troughing_100": "p-troughing-100",
  "__new_header_system": "p-header-system",
  "__new_door_post": "p-door-post",
  "__new_door_panel": "p-door-panel",
  "__new_cabin_from_job": "p-cabin-from-job",
  "__new_eco_horiz_front": "p-eco-horiz-front",
  "__new_eco_swing_linten": "p-eco-swing-linten",
  "__new_eco_swing_sill": "p-eco-swing-sill",
  "__new_eco_top_front": "p-eco-top-front",
  "__new_eco_machine_cover": "p-eco-machine-cover",
  "__new_eco_horiz_glass": "p-eco-horiz-glass",
  "__new_eco_vert_glass": "p-eco-vert-glass",
  "__new_eco_pit_plate": "p-eco-pit-plate",
  "__new_eco_net": "p-eco-net",
  "__new_eco_magnet_bkt": "p-eco-magnet-bkt",
  "__new_eco_glass_pc": "p-eco-glass-pc",
  "__new_eco_fasteners": "p-eco-fasteners",
};

// Door-flag keys to PARK at the end (decided "later"), kept as-is.
const TAIL_FLAGS = ["p-gate-lock-keeper", "p-car-gate-arm", "p-imperforated-gate", "p-gate-fixing-kit"];

// Families that are FULLY decided (anything not curated/tail in these is dropped).
// We detect "decided" by: a key is decided if it's NOT in the Fastener/Other tail set.
// Tail = Fasteners + Other families (computed below) MINUS curated/merged keys.
const FAM = [["pull",/pull(e)?y/],["grail",/guide rail/],["rbrk",/rail bracket|combinition|combination|main rail bracket|counter rail bracket/],["rclip",/rail clip/],["rpack",/rail packing|rail fixing/],["fish",/fish plate/],["munit",/machine unit|gmv|nidec/],["mbeam",/machine (beam|base|support|lifting)/],["gov",/governor/],["wrope",/wire rope/],["rope",/rope belt|^belt|^rope/],["oil",/\boil\b|grease|mobil/],["thim",/thimbel|thimble/],["bull",/bull dog/],["dshk",/shackle/],["hdr",/header/],["sill",/sill/],["dpost",/door post|door frame/],["lint",/linton|lintone|lintly/],["safe",/safety frame|safety rod|up right channel|safety switch|safety tips/],["gshoe",/guide shoe/],["gclip",/gathering clip/],["cnt",/counter (weight|guard)|filler weight|dade weight|tension weight/],["lim",/limit/],["cam",/\bcam\b/],["can",/canopy/],["plat",/plat ?form/],["cab",/cabin/],["door",/swing door|collapsible|auto door|telescopic|door pannel|door panel|gate|imperforated|door closer|door catcher/],["fan",/fan grill/],["cable",/cable hanger|troughing/],["ctrl",/controller/]];
const famOf = (l) => { l = l.toLowerCase(); for (const [n, re] of FAM) if (re.test(l)) return n; return "TAIL"; };

// ---- build ----
const usedKeys = new Set();
const warn = [];
const out = [];
const groups = {};

for (const c of CURATED) {
  const isNew = c.key.startsWith("__new_");
  const finalKey = isNew ? NEW[c.key] : c.key;
  if (!finalKey) { warn.push("no slug for " + c.key); continue; }
  let src = isNew ? null : byKey.get(c.key);
  if (!isNew && !src) { warn.push("MISSING key: " + c.key); }
  usedKeys.add(c.key);
  for (const m of c.merge || []) { if (!byKey.has(m)) warn.push("MISSING merge key: " + m); usedKeys.add(m); }
  const capture = c.capture || (c.pin ? "fixed" : (src ? src.captureType : "item"));
  const cats = c.cats !== undefined ? c.cats : (src ? src.categoryPaths : []);
  const specHint = c.specHint !== undefined ? c.specHint : (src ? src.specHint : "");
  const entry = { key: finalKey, label: c.label, captureType: capture, categoryPaths: cats, specHint };
  if (c.drives) entry.drives = c.drives;
  if (c.doors) entry.doors = c.doors;
  if (c.pin) entry.pinnedItem = c.pin;
  out.push(entry);
  groups[finalKey] = c.group;
}

// Retired sections — now sourced elsewhere (False Ceiling comes from the Cabin Job's
// finish-fanned item). Mark used so they are neither curated nor parked.
for (const k of ["p-false-ceiling", "p-read-bracket-nice", "p-magnet-bracket-nice", "p-magnet-bracket-spl", "p-magnet-trey-fixing-plate", "p-pvc-magnet-holder-magnet-40mm", "p-car-frame-assembly-instruction-t-509-2-1", "p-kick-angel"]) usedKeys.add(k);

// TAIL: everything not used, split into (decided→dropped) vs (tail→kept at end).
const dropped = [];
const tail = [];
for (const s of SRC) {
  if (usedKeys.has(s.key)) continue;
  const fam = famOf(s.label);
  if (fam === "TAIL" || TAIL_FLAGS.includes(s.key)) tail.push(s);
  else dropped.push(s);
}
for (const s of tail) {
  out.push({ key: s.key, label: s.label, captureType: s.captureType, categoryPaths: s.categoryPaths, specHint: s.specHint });
  groups[s.key] = TAIL_FLAGS.includes(s.key) ? "Doors" : (s.captureType === "free" ? "Fasteners (parked)" : "Other (parked)");
}

// ---- emit ----
const esc = (v) => JSON.stringify(v);
const lines = out.map((s) => {
  const extra = (s.drives ? `\n    drives: ${esc(s.drives)},` : "") + (s.doors ? `\n    doors: ${esc(s.doors)},` : "") + (s.pinnedItem ? `\n    pinnedItem: ${esc(s.pinnedItem)},` : "");
  return `  {\n    key: ${esc(s.key)},\n    label: ${esc(s.label)},\n    captureType: ${esc(s.captureType)},\n    categoryPaths: ${esc(s.categoryPaths)},\n    specHint: ${esc(s.specHint)},${extra}\n  },`;
}).join("\n");

const ts = `/**
 * Packing-list template — the factory's MECHANICAL PART LIST format.
 *
 * CURATED by scripts/_partlist_build.js from the owner's family-by-family cleanup
 * (docs/partlist-cleanup-decisions.md). Front section = the curated, de-duplicated,
 * ordered particulars; fasteners + misc "(parked)" lines are kept at the end for now.
 *
 *   - key / label / captureType ('item' search | 'free' text | 'fixed' pinned item)
 *   - categoryPaths: ERP category PATH(s) scoping an item search ([] = all).
 *   - specHint: placeholder spec.
 *   - drives / doors: when set, the line only applies to those drive / door types
 *     (gating). pinnedItem: the exact inventory item name for a 'fixed' line.
 */

export type CaptureType = "item" | "free" | "fixed";

export interface PackingSection {
  key: string;
  label: string;
  captureType: CaptureType;
  categoryPaths: string[];
  specHint: string;
  /** Drive types this line applies to (omitted = all). Codes: MR/MRL/HOME/BELT/MRLBELT/HYD/CANTI/R1000. */
  drives?: string[];
  /** Door types this line applies to (omitted = all). Codes: COLLAPSIBLE/SWING/MT/AT/AFF/CO. */
  doors?: string[];
  /** For captureType 'fixed': the exact inventory item name to pin. */
  pinnedItem?: string;
}

export const PACKING_SECTIONS: PackingSection[] = [
${lines}
];

const SECTION_BY_KEY = new Map(PACKING_SECTIONS.map((s) => [s.key, s]));
export function packingSection(key: string): PackingSection | undefined {
  return SECTION_BY_KEY.get(key);
}

/** Does a section apply to a job's drive/door type? (no gate = always). */
export function sectionApplies(
  s: PackingSection,
  drive: string | null,
  door: string | null,
): boolean {
  if (s.drives && s.drives.length) {
    if (!drive || !s.drives.includes(drive.toUpperCase())) return false;
  }
  if (s.doors && s.doors.length) {
    if (!door || !s.doors.includes(door.toUpperCase())) return false;
  }
  return true;
}
`;

const outDir = path.join(__dirname, "..", "src", "lib", "packing-list");
fs.writeFileSync(path.join(outDir, "packing-list-sections.ts"), ts);
fs.writeFileSync(path.join(__dirname, "..", "src", "lib", "partlist", "section-groups.json"), JSON.stringify(groups));
// also refresh the brain-side mirror copy so they stay in lockstep
fs.writeFileSync(path.join(__dirname, "_packing_sections.json"), JSON.stringify(out.map((s) => ({ key: s.key, label: s.label, captureType: s.captureType, categoryPaths: s.categoryPaths, specHint: s.specHint, drives: s.drives, doors: s.doors, pinnedItem: s.pinnedItem }))));

console.log(`curated front: ${CURATED.length}  ·  tail parked: ${tail.length}  ·  dropped: ${dropped.length}  ·  TOTAL: ${out.length}  (was ${SRC.length})`);
const groupOrder = [...new Set(out.map((s) => groups[s.key]))];
console.log("groups: " + groupOrder.join(" | "));
if (warn.length) { console.log("\n!!! WARNINGS:"); for (const w of warn) console.log("  - " + w); }
