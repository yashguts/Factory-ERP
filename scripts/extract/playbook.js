// ─────────────────────────────────────────────────────────────────────────────
// MASTER EXTRACTION + DERIVATION PLAYBOOK  (BOM predictor foundation)
// The owner's architecture: (1) capture EVERY data point from each drawing into an
// open record, (2) join to the BOM lines the job used, (3) derive the rest by
// CALCULATION + DEPENDENCY + the elevator rules we've already learned, (4) leave a
// SMALL set of genuinely-underivable fields for manual fill, (5) recurse.
//
// `source` legend:  drawing = read off a labelled region (see `region`)
//                   calc    = engineering formula from other fields
//                   depend  = one item's qty from another's
//                   learned = a rule already coded in predict-core (keep it)
//                   manual  = underivable by any method -> owner fills per job
// `status`: have | extend | NEW | keep | manual
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  // ── A. DRAWING-EXTRACTED — where to take the picture + what to read in it ────
  regions: {
    "P1.specTable": { anchor: "SPECIFICATION", status: "extend", fields: [
      "model", "capacity_kg", "persons", "speed_mps", "drive_type", "control_type",
      "power_supply", "stops", "openings", "door_type", "door_operator",
      "opening_w", "opening_h", "car_door_finish", "landing_door_finish",
      "vision_glass", "cabin_finish", "flooring", "brand", "machine_make_model", "roping_ratio" ] },
    "P1.plan": { anchor: "HOISTWAY PLAN", status: "extend", fields: [
      "hoistway_w", "hoistway_d", "car_w", "car_d", "platform_w", "platform_d",
      "dbg_car", "dbg_counter", "cwt_position", "cwt_offset", "opening_w", "betwall",
      "wall_left_type", "wall_right_type", "wall_back_type",
      "car_rail_gap_L", "car_rail_gap_R", "counter_rail_gap", "controller_pos", "air_gap" ] },
    "P1.doorElev": { anchor: "DOOR", status: "NEW", fields: [
      "opening_w", "opening_h", "panel_count", "panel_widths", "vision_extent", "glass_size", "sill_type", "lintel_h" ] },
    "P1.sectionAA": { anchor: "SEC", status: "NEW", fields: [ "floor_height", "lintel_level", "clear_entrance_h" ] },
    "P1.notes": { anchor: "NOTES", status: "NEW", fields: [ "structure", "bracket_notes", "finish_notes", "scope_supply" ] },
    "P1.titleBlock": { anchor: null, status: "have", fields: [ "job_number", "customer", "location", "brand", "drawing_no", "revision", "date" ] },
    "P2.section": { anchor: "HOISTWAY SECTION", status: "NEW", fields: [
      "pit_depth", "overhead", "travel", "floor_heights", "bracket_spacing", "rope_falls", "buffer_type", "cwt_travel", "top_clear", "bottom_clear" ] },
    "P2.sling": { anchor: "SAFETY|SLING|CAR FRAME", status: "NEW", fields: [
      "safety_frame_type", "sling_w", "sling_d", "safety_gear", "guide_shoe", "car_pulley_present", "car_pulley_dia", "platform_dims" ] },
    "P2.machine": { anchor: "MACHINE|BEAM|HOOK", status: "NEW", fields: [
      "machine_make_model", "sheave_dia", "machine_beam", "lifting_hook", "machine_room" ] },
    "P2.forces": { anchor: "FORCES|REACTION|LOAD", status: "NEW", fields: [
      "car_weight", "cwt_weight", "total_load", "reaction_R1", "reaction_R2", "buffer_load" ] },
  },

  // ── B. CALCULATED — engineering formulas (drawing-fields -> derived value) ───
  calc: {
    floors:            "= stops (spec) OR count(floor_heights)",
    roping_ratio:      "= 2:1 if car_pulley_present OR rope_falls==2 ; else 1:1",
    bracket_count_rail:"= floor(travel / bracket_spacing) + 1",
    main_bracket_total:"= 2*bracket_count_rail (car rails) ; combination on counter rails when cwt_position=side",
    counter_bkt_total: "= 2*bracket_count_rail (counter rails)",
    guide_rail_pieces: "= ceil(travel / 5000)  (5 m stock) per rail x rails",
    rope_length:       "= (travel + overhead + termination) * roping_ratio * n_ropes",
    troughing_len:     "= travel + machine-room run  (page-2 cable run)",
    safety_frame_type: "= Goods if capacity_kg>=1200/DBG wide ; Home if HOME drive ; R1 if roping_ratio==2:1 ; Std if 1:1   (pulley-below-frame insight + drive map)",
  },

  // ── C. DEPENDENCY — qty of one item from another (ratios learned from corpus) ─
  depend: {
    "RAIL CLIP":   "= k * main_bracket_total            (k learned per rail size; ~2)",
    "Stud Anchor": "= k * main_bracket_total            (~2-3)",
    "Fish Plate":  "= guide_rail_pieces - rails          (joints)",
    "Bull Dog Clip / D-Shackle": "= per rope termination * n_ropes",
  },

  // ── D. LEARNED RULES already in predict-core (KEEP — do not regress) ─────────
  learned: [
    "drive_type -> safety-frame family (MR=Std, MRL/MRLBELT/R1000=R1, CANTI=Home, Goods@>=1200kg)",
    "Combination main bracket: DBG = COUNTERWEIGHT DBG, gated by counterweight_position=side",
    "landing-side parts (Door Post/Linton/Landing panel) take the LANDING door colour; headers/sill plain",
    "door side = opening direction from the landing (park on wider jamb, open toward narrower)",
    "pulley material C.I./PVC via similar-jobs (neighbour) tie-break",
    "per-landing parts = stops (qty = L or L+1); per-shaft consumables scale with travel not floors",
    "per-section item cap = corpus data max (multi-item sections like MAIN BRACKET keep all variants)",
    "absence = missing data (item not on a past BOM may be dispatched-pre-ERP) -> never suppress/penalise",
  ],

  // ── E. LEAVE FOR MANUAL — genuinely underivable (owner fills per job). Cap ~6 ─
  manual: [
    "Cabin Glass (owner: not predictable from drawing/spec)",
    "Pulley material C.I. vs PVC (6-pass bucket is a true coin-flip even among similar jobs)",
    // reserve up to ~4 more, to be FINALISED only after the relationship pass proves
    // they resist drawing + calc + dependency. Do not pad this list pre-emptively.
  ],
};
