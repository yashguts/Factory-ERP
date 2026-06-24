/**
 * SPEC -> BOM prediction core. PURE functions only — no DB, no LLM, no server
 * directives — so the live server action AND the offline backtest run the
 * EXACT same code. Predicts a draft BOM for a target elevator spec by k-NN over
 * past jobs + section-wise consensus, label-noise aware (learns which sections
 * exist only from "complete" jobs that have first-phase items).
 *
 * Additive by nature: this only produces a draft the engineer reviews and
 * applies through the existing picker; it never writes anything.
 */
import { BOM_SECTIONS, PHASE_ORDER, FIRST_PHASE_SECTIONS } from "./bom-sections";
import { shouldRenderSection } from "./section-gating";

// ── Tunables (one block — re-run the backtest after changing) ──────────
export const TUNING = {
  // Neighbours: fewer, tighter is better now that similarity (drive + DOOR TYPE +
  // capacity) separates jobs cleanly — K=6 + sharper weighting beats K=8/flat.
  TARGET_K: 6,
  MIN_SIM: 0.45,
  HARD_FLOOR_K: 3,
  SECTION_THRESHOLD: 0.4,
  ITEM_THRESHOLD: 0.3,
  MAX_ITEMS_PER_SECTION: 4,
  // Weight neighbours by sim^SIM_SHARPEN. With door type in the similarity the
  // closest neighbours are genuinely the right build, so trusting them harder pays
  // (4 ≫ 2 in the backtest); kept at 4 (not higher) to stay a top-few blend rather
  // than degenerate to single-neighbour copy.
  SIM_SHARPEN: 4,
  CAP_SOFTNESS_KG: 220,
  FLOOR_SOFTNESS: 2.0,
  KG_PER_PASS: 68,
  // Similarity term weights (sum need not be 1 — normalised over present terms).
  // The two STRUCTURAL axes lead: drive type (which sections/topology) and door
  // type (which door-system SKUs). They're orthogonal — one drive spans many door
  // types — so both are needed. Capacity/floors size within that; finish/brand
  // only break ties. Calibrated by leave-one-out backtest (scripts/_bom_sweep.ts).
  W_DRIVE: 0.42,
  W_DOOR: 0.18,
  W_CAP: 0.22,
  W_FLOOR: 0.14,
  W_FINISH: 0.04,
  W_BRAND: 0.02,
  // Drive-adjacency shrinkage: a drive pair's learned soft-Jaccard is trusted in
  // proportion support/(support+K); below that it leans on the structural prior.
  DRIVE_SHRINK_K: 6,
  // Drive adjacency from the static structural prior only. Learning it from the
  // corpus (DRIVE_USE_LEARNED=true) was measured NET-NEUTRAL — the prior already
  // encodes the topology — and added cost + rare-drive dilution, so it's off. The
  // hook stays so the flywheel can revisit it once each drive has more jobs.
  DRIVE_USE_LEARNED: false,
  // Door-opening-width size matching (door-system sections only). When the drawing
  // gives the opening width, boost the same-width SKU variant and push down a
  // different-width one — the drawing→BOM eval showed 91% of door item-misses were
  // a wrong-width pick of the right family. No-op when width is absent.
  SIZE_BOOST: 4,
  SIZE_PENALTY: 0.3,
  SIZE_TOL: 30, // mm tolerance for door opening width (the SKU carries the exact width)
  SIZE_TOL_DBG: 55, // wider for DBG: HOME/BELT frames snap to ~100mm-spaced standard buckets
  COMPOSE_MIN_FRAC: 0.6, // compose a SKU only when it matches >=60% of available attribute weight
  COMPOSE_MIN_SCORE: 5, //  ...and at least this much absolute weight (≈2 strong attributes agreeing)
};

// Sections whose quantity scales ~per-floor; everything else is a fixed count.
const FLOOR_SCALED = new Set<string>([
  "RAIL", "Landing Door Panel", "Landing Header System", "Door Post / Frame",
  "Door Sill", "Gate Lock", "MAIN BRACKET", "COUNTER BRACKET", "RAIL CLIP",
  "Linton Panel", "MAGNET WITH BRACKET",
  "TROUGHING 50", "TROUGHING 100",
]);

// Drive-type STRUCTURAL PRIOR (symmetric; only the upper triangle is listed —
// lookup tries both orders). Encodes the two real axes of an elevator —
// machine location (MR / MRL / Home-pit) and suspension (rope / belt / hydraulic)
// — plus the special builds: CANTI (cantilever frame ≈ MRL topology), HYD
// (hydraulic, no counterweight/pulleys → genuinely different), R1000 (car-parking
// product, its own world). Calibrated against the live corpus' section-Jaccard
// (scripts/_bom_analysis.ts). KEY CORRECTION from the owner's drive-type split:
// HOME↔BELT (Home Belt) is the STRONGEST cross-drive pair (0.85) because a Home
// Belt lift is structurally a home lift — the old map wrongly had it at 0.30.
// This prior is only the FLOOR: buildDriveSim() overrides it with adjacency
// learned from the actual corpus wherever a drive pair has enough examples.
const DRIVE_PRIOR: Record<string, Record<string, number>> = {
  MR:      { MRL: 0.75, HOME: 0.6, BELT: 0.55, MRLBELT: 0.7, CANTI: 0.7, HYD: 0.45, R1000: 0.3 },
  MRL:     { HOME: 0.65, BELT: 0.6, MRLBELT: 0.8, CANTI: 0.75, HYD: 0.5, R1000: 0.35 },
  HOME:    { BELT: 0.85, MRLBELT: 0.65, CANTI: 0.6, HYD: 0.55, R1000: 0.3 },
  BELT:    { MRLBELT: 0.75, CANTI: 0.55, HYD: 0.6, R1000: 0.3 },
  MRLBELT: { CANTI: 0.65, HYD: 0.55, R1000: 0.3 },
  CANTI:   { HYD: 0.45, R1000: 0.3 },
  HYD:     { R1000: 0.3 },
  R1000:   {},
};
// Any pair not in the prior (e.g. a brand-new drive code). Deliberately not 0:
// even the most dissimilar drives in the corpus share ~half their sections, so a
// hard 0.05 (the old value) needlessly stranded rare/new drives.
const DRIVE_PRIOR_FALLBACK = 0.3;

function drivePrior(a: string, b: string): number {
  if (a === b) return 1;
  return DRIVE_PRIOR[a]?.[b] ?? DRIVE_PRIOR[b]?.[a] ?? DRIVE_PRIOR_FALLBACK;
}

// ── Door type ────────────────────────────────────────────────────────────────
// Sections whose SKU FAMILY is set by the door type (not by drive/capacity).
const DOOR_SECTIONS = new Set<string>([
  "Car Door Panel", "Landing Door Panel", "Car Header System",
  "Landing Header System", "Door Sill", "Door Post / Frame",
  "Linton Panel", "Gate Lock",
]);

/**
 * Normalise a door descriptor — an item name, a vision door_type string, or a
 * form value — to a door-type CODE. Order matters: AFF before AT (four-fold is
 * auto), Collapsible before CO, Manual-Telescopic before bare CO. Returns null
 * when no token is recognised (a non-door item, or an unlabelled header).
 */
export function classifyDoorToken(text: string | null | undefined): string | null {
  if (!text || typeof text !== "string") return null;
  const n = " " + text.toUpperCase().replace(/[^A-Z0-9]+/g, " ") + " ";
  if (/\bAFF\b/.test(n) || /FOUR ?FOLD/.test(n) || /\b4 ?FOLD/.test(n)) return "AFF";
  if (/COLLAPS/.test(n) || /\bCOLL?\b/.test(n)) return "COL";
  if (/\bMT\b/.test(n) || /MANUAL TELESCOPIC/.test(n)) return "MT";
  if (/\bAT\b/.test(n) || /AUTO ?TELESCOPIC/.test(n) || /\bATD?\b/.test(n)) return "AT";
  if (/\bCO\b/.test(n) || /CENT(RE|ER) ?OPENING/.test(n)) return "CO";
  if (/SWING/.test(n) || /\bSWS\b/.test(n)) return "SWS";
  if (/DUMB/.test(n)) return "DUMB";
  if (/BIPART/.test(n) || /BYPART/.test(n) || /BY ?PARTING/.test(n)) return "BYPART";
  return null;
}
export const normaliseDoorType = classifyDoorToken;

/**
 * Vote a job's door type from its own door-section item names (majority across
 * the door sections). Used to label corpus jobs so the engine can condition on
 * door type; the live target's door type instead comes from the drawing read.
 */
export function deriveDoorType(sections: Record<string, TrainingLine[]>): string | null {
  const votes = new Map<string, number>();
  for (const sec of DOOR_SECTIONS) {
    for (const ln of sections[sec] ?? []) {
      const t = classifyDoorToken(ln.item_name);
      if (t) votes.set(t, (votes.get(t) ?? 0) + 1);
    }
  }
  let best: string | null = null, bv = 0;
  for (const [t, v] of votes) if (v > bv) { best = t; bv = v; }
  return best;
}

// Which DRAWING DIMENSION sets each section's SKU size — mined from the corpus
// (scripts/_mine_signals.ts): the dimension value appears baked into the SKU name.
//  • door-system SKUs  -> door OPENING WIDTH ("Car Pannel CO/SS/LV/800", "...Sill
//    CO 800mm/LT/1660", "Linton ... 800mm").
//  • Safety frame + main buffer channel -> car DBG (distance between car guides).
//  • counterweight frame/guard/filler/counter buffer -> counter DBG.
// When the drawing gives that dimension we boost the matching variant and demote a
// conflicting one. A no-op when the dimension is absent.
type SizeDim = "door_opening_width" | "dbg_main" | "dbg_counter";
const SIZE_RULES: Record<string, SizeDim> = {
  "Car Door Panel": "door_opening_width", "Landing Door Panel": "door_opening_width",
  "Car Header System": "door_opening_width", "Landing Header System": "door_opening_width",
  "Door Sill": "door_opening_width", "Door Post / Frame": "door_opening_width",
  "Linton Panel": "door_opening_width", "Gate Lock": "door_opening_width",
  "Sill Angle": "door_opening_width",
  // DBG (distance between guides) sizes the safety + counterweight frames. Only the
  // sections where the backtest showed a NET GAIN are kept: Safety (+11pt), Counter
  // Frame / Guard Net (+2pt). Filler Weight + Buffer Channels had a weak signal that
  // regressed, so they're deliberately excluded (left to the retrieval median).
  "Safety": "dbg_main",
  "Counter Frame": "dbg_counter", "Counter Guard Net": "dbg_counter",
  "Machine Beam": "dbg_counter",
};
// Numbers in a structural-dimension window (mm); excludes tiny counts and the
// 2000+ door heights / long sill lengths that would create false matches.
function namedDims(name: string): number[] {
  const out: number[] = [];
  for (const m of name.matchAll(/\d{3,4}/g)) {
    const v = Number(m[0]);
    if (v >= 320 && v <= 1800) out.push(v);
  }
  return out;
}
function sizeTargetFor(section: string, target: BomTargetSpec): number | null | undefined {
  const rule = SIZE_RULES[section];
  if (!rule) return null;
  return rule === "door_opening_width" ? target.door_opening_width
    : rule === "dbg_main" ? target.dbg_main_mm : target.dbg_counter_mm;
}
function sizeFactor(name: string, section: string, target: BomTargetSpec): number {
  const rule = SIZE_RULES[section];
  if (!rule) return 1;
  const tv = sizeTargetFor(section, target);
  if (!tv) return 1;
  const tol = rule === "door_opening_width" ? TUNING.SIZE_TOL : TUNING.SIZE_TOL_DBG;
  const ds = namedDims(name);
  if (ds.length === 0) return 1; // no dimension token in the name — neutral
  if (ds.some((d) => Math.abs(d - tv) <= tol)) return TUNING.SIZE_BOOST;
  return TUNING.SIZE_PENALTY; // a different, conflicting dimension
}

// ── Multi-attribute SKU composition ──────────────────────────────────────────
// Reverse-engineered from the corpus (scripts/_sku_rules.json): these SKUs encode
// several drawing attributes in the name — a door panel is type/material/vision/
// width/colour, a safety/counter frame is frame-type + DBG. We derive each
// attribute from the target's drawing fields and pick the corpus SKU whose name
// matches the most of them (weighted) — composing the SKU the way the engineer
// does, from the WHOLE corpus pool (not just neighbours).
function targetMaterial(t: BomTargetSpec): string | null {
  const s = `${t.door_finish ?? ""}`.toUpperCase();
  if (/\bM\.?S\b|MILD STEEL|POWDER/.test(s)) return "MS";
  if (/\bS\.?S\b|STAINLESS|HAIRLINE|MIRROR|ROSE ?GOLD|CHAMPAGNE|LINEN|GOLDEN/.test(s)) return "SS";
  return null;
}
function skuMaterial(s: string): string | null {
  const u = s.toUpperCase();
  if (/(^|[^A-Z])MS([^A-Z]|$)/.test(u)) return "MS";
  if (/(^|[^A-Z])SS([^A-Z]|$)/.test(u)) return "SS";
  return null;
}
function targetVision(t: BomTargetSpec): string | null {
  if (t.door_vision === "LV" || t.door_vision === "MV" || t.door_vision === "NV") return t.door_vision; // VISUAL read wins
  const s = `${t.door_finish ?? ""} ${t.door_type ?? ""}`.toUpperCase();
  if (/LONG VISION|FULL VISION|\bLV\b/.test(s)) return "LV";
  if (/MEDIUM VISION|\bMV\b/.test(s)) return "MV";
  if (/NO VISION|\bNV\b|BLIND/.test(s)) return "NV";
  if (classifyDoorToken(t.door_type) === "MT") return "PV"; // manual telescopic is always partial vision
  // Otherwise UNKNOWN — do NOT guess (CO/AT vision is ~50/50 when the drawing is
  // silent). Returning null lets composition match the other attributes and the
  // frequency tie-break pick the modal vision, rather than forcing a wrong guess.
  return null;
}
function skuVision(s: string): string | null {
  const u = s.toUpperCase();
  if (/\/LV\b|[^A-Z]LV\//.test(u)) return "LV";
  if (/\/MV\b|[^A-Z]MV\//.test(u)) return "MV";
  if (/\/NV\b|[^A-Z]NV\//.test(u)) return "NV";
  if (/\/PV\b|[^A-Z]PV\//.test(u)) return "PV";
  return null;
}
const COLOR_PHRASES = [
  "ROSE GOLD LINEN", "ROSE GOLD MIRROR", "ROSE GOLD", "BLACK MIRROR", "SILVER MIRROR",
  "CHAMPAGNE", "GOLDEN", "TITANIUM", "GRANITE", "COPPER", "BRONZE", "WOOD",
];
function targetColor(t: BomTargetSpec): string | null {
  const s = `${t.door_finish ?? ""}`.toUpperCase();
  for (const c of COLOR_PHRASES) if (s.includes(c)) return c;
  return null; // Hairline / plain SS / MS → no colour token (the SKU is plain/STD)
}
function skuColor(s: string): string | null {
  const u = s.toUpperCase();
  for (const c of COLOR_PHRASES) if (u.includes(c)) return c;
  return null;
}
function targetFrameType(t: BomTargetSpec): string | null {
  const cap = parseCapacity(t.capacity);
  if (cap.kind === "kg" && cap.kg >= 1000) return "GOODS";
  const d = t.drive_type;
  if (d === "HOME" || d === "BELT") return "HOME";
  if (d === "HYD") return "HYD";
  if (d === "MRL" || d === "MR" || d === "MRLBELT" || d === "CANTI") return "R1"; // traction frame family
  return null;
}
function skuFrameType(s: string): string | null {
  const u = s.toUpperCase();
  if (/\bGOODS\b/.test(u)) return "GOODS";
  if (/\bHOME\b/.test(u)) return "HOME";
  if (/HYDRAULIC|\bHYD\b|\bGMV\b/.test(u)) return "HYD";
  if (/\bR1\b|\bSTD\b/.test(u)) return "R1"; // R1 and Std are both the traction family
  return null;
}
function skuSide(s: string): string | null {
  const u = s.toUpperCase();
  if (/\bLHS\b|\bLH\b|\bLEFT\b/.test(u)) return "LHS";
  if (/\bRHS\b|\bRH\b|\bRIGHT\b/.test(u)) return "RHS";
  return null;
}

// Collapsible gate SKUs are named by their CHANNEL count, not width:
// "Collapsible Gate 7+1Channel". Channels ≈ opening width / 100 (mined per the rule
// pass): 700→6, 760→7, 800→8, 900→9, 1000→10, 1500→15, 2000→20.
function channelsFromWidth(w: number): number {
  if (w <= 730) return 6;
  if (w <= 780) return 7;
  if (w <= 850) return 8;
  if (w <= 950) return 9;
  if (w <= 1200) return 10;
  if (w <= 1700) return 15;
  return 20;
}
type AttrKey = "doorType" | "material" | "vision" | "landingVision" | "width" | "color" | "side" | "channels" | "frameType" | "dbgCar" | "dbgCtr";
interface AttrDef { weight: number; target: (t: BomTargetSpec) => string | number | null; match: (sku: string, v: string | number) => boolean; }
const ATTRS: Record<AttrKey, AttrDef> = {
  doorType: { weight: 3, target: (t) => classifyDoorToken(t.door_type), match: (s, v) => classifyDoorToken(s) === v },
  material: { weight: 2, target: targetMaterial, match: (s, v) => skuMaterial(s) === v },
  vision: { weight: 2, target: targetVision, match: (s, v) => skuVision(s) === v },
  landingVision: { weight: 2, target: (t) => ((t.landing_door_vision === "LV" || t.landing_door_vision === "MV" || t.landing_door_vision === "NV") ? t.landing_door_vision : targetVision(t)), match: (s, v) => skuVision(s) === v },
  // Width drives non-collapsible door SKUs; a collapsible gate carries channels, not width.
  width: { weight: 3, target: (t) => (classifyDoorToken(t.door_type) === "COL" || t.door_opening_width == null ? null : t.door_opening_width), match: (s, v) => namedDims(s).some((d) => Math.abs(d - (v as number)) <= TUNING.SIZE_TOL) },
  color: { weight: 2, target: targetColor, match: (s, v) => skuColor(s) === v },
  side: { weight: 2, target: (t) => (t.door_side === "LHS" || t.door_side === "RHS" ? t.door_side : null), match: (s, v) => skuSide(s) === v },
  channels: { weight: 3, target: (t) => (classifyDoorToken(t.door_type) === "COL" && t.door_opening_width ? channelsFromWidth(t.door_opening_width) : null), match: (s, v) => new RegExp(`\\b${v}\\s*\\+?\\s*1?\\s*CHANNEL`).test(s.toUpperCase()) },
  frameType: { weight: 3, target: targetFrameType, match: (s, v) => skuFrameType(s) === v },
  dbgCar: { weight: 4, target: (t) => t.dbg_main_mm ?? null, match: (s, v) => namedDims(s).some((d) => Math.abs(d - (v as number)) <= TUNING.SIZE_TOL_DBG) },
  dbgCtr: { weight: 4, target: (t) => t.dbg_counter_mm ?? null, match: (s, v) => namedDims(s).some((d) => Math.abs(d - (v as number)) <= TUNING.SIZE_TOL_DBG) },
};
// Which attributes compose each section's SKU (from the reverse-engineering pass).
const COMPOSE: Record<string, AttrKey[]> = {
  "Car Door Panel": ["doorType", "material", "vision", "width", "color", "side", "channels"],
  "Landing Door Panel": ["doorType", "material", "landingVision", "width", "color", "side", "channels"],
  "Linton Panel": ["doorType", "material", "width", "color"],
  "Door Sill": ["doorType", "width"],
  "Door Post / Frame": ["doorType", "material", "color", "side"], // door post SKU carries no width
  "Car Header System": ["doorType", "width", "side"],
  "Landing Header System": ["doorType", "width", "side"],
  "Safety": ["frameType", "dbgCar"],
  "Counter Frame": ["frameType", "dbgCtr"],
  "Counter Guard Net": ["frameType", "dbgCtr"],
  "Filler Weight": ["frameType", "dbgCtr"],
  "Machine Beam": ["frameType", "dbgCtr"],
};
function composeScore(sku: string, attrs: AttrKey[], target: BomTargetSpec): { score: number; max: number; present: number } | null {
  let score = 0, max = 0, present = 0;
  for (const k of attrs) {
    const a = ATTRS[k];
    const v = a.target(target);
    if (v == null || v === "") continue;
    present++;
    max += a.weight;
    if (a.match(sku, v)) score += a.weight;
  }
  return present ? { score, max, present } : null;
}

export type DriveSimFn = (a: string | null, b: string | null) => number | null;

/**
 * Learn drive-type adjacency FROM THE CORPUS: two drive types are "close" when
 * their complete jobs use the same BOM sections. We build a per-drive section-
 * presence vector (fraction of that drive's jobs carrying each section) and take
 * the soft-Jaccard between vectors, then shrink toward DRIVE_PRIOR by how much
 * evidence the pair has. Result: well-populated pairs (MRL↔Home, 45×15 jobs)
 * trust the data; sparse pairs (MRL Belt, HYD, R1000) lean on the structural
 * prior. Self-updating — as the team audits more jobs the adjacency sharpens with
 * no retrain, which is exactly the flywheel the owner wants. Returns null when
 * either side has no drive_type (so the term is dropped, not penalised).
 */
export function buildDriveSim(corpus: TrainingJob[]): DriveSimFn {
  // Default path: the static structural prior (the learned blend was net-neutral).
  if (!TUNING.DRIVE_USE_LEARNED)
    return (a, b) => (!a || !b ? null : drivePrior(a, b));

  const agg = new Map<string, { n: number; secs: Map<string, number> }>();
  for (const j of corpus) {
    if (!j.isComplete || !j.spec.drive_type) continue;
    const d = j.spec.drive_type;
    let e = agg.get(d);
    if (!e) { e = { n: 0, secs: new Map() }; agg.set(d, e); }
    e.n++;
    for (const sec of Object.keys(j.sections)) e.secs.set(sec, (e.secs.get(sec) ?? 0) + 1);
  }
  const vec = new Map<string, Map<string, number>>();
  const nByDrive = new Map<string, number>();
  for (const [d, e] of agg) {
    nByDrive.set(d, e.n);
    const v = new Map<string, number>();
    for (const [sec, c] of e.secs) v.set(sec, c / e.n);
    vec.set(d, v);
  }
  const softJaccard = (a: Map<string, number>, b: Map<string, number>): number => {
    let mn = 0, mx = 0;
    const keys = new Set([...a.keys(), ...b.keys()]);
    for (const k of keys) {
      const x = a.get(k) ?? 0, y = b.get(k) ?? 0;
      mn += Math.min(x, y);
      mx += Math.max(x, y);
    }
    return mx > 0 ? mn / mx : 0;
  };
  const cache = new Map<string, number>();
  return (a, b) => {
    if (!a || !b) return null; // field dropped on one side
    if (a === b) return 1;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const prior = drivePrior(a, b);
    const va = vec.get(a), vb = vec.get(b);
    let sim = prior;
    if (TUNING.DRIVE_USE_LEARNED && va && vb) {
      const support = Math.min(nByDrive.get(a) ?? 0, nByDrive.get(b) ?? 0);
      const learned = softJaccard(va, vb);
      const wData = support / (support + TUNING.DRIVE_SHRINK_K);
      sim = wData * learned + (1 - wData) * prior;
    }
    cache.set(key, sim);
    return sim;
  };
}

export interface TrainingLine {
  item_id: string;
  item_code: string;
  item_name: string;
  uom: string;
  required_quantity: number;
}
export interface TrainingJob {
  id: string;
  job_number: string;
  spec: {
    floors: number | null;
    drive_type: string | null;
    capacity: string | null;
    door_finish: string | null;
    brand: string | null;
    door_type?: string | null; // derived from this job's own door-section items
  };
  isComplete: boolean; // has a RAIL section line
  sections: Record<string, TrainingLine[]>;
}
export interface BomTargetSpec {
  floors: number | null;
  drive_type: string | null;
  capacity: string | null;
  door_finish?: string | null;
  brand?: string | null;
  /**
   * Door type CODE (CO/AT/COL/AFF/MT/SWS/…). The single biggest determinant of
   * the door-system SKUs (door panels, headers, sill, frame, linton) — a CO and a
   * Collapsible job share a drive/capacity but use completely different door
   * families. Optional: for a live target it comes from the drawing read
   * (normaliseDoorType on the vision door_type); when absent the door term is
   * simply dropped, so behaviour is unchanged until it's wired through.
   */
  door_type?: string | null;
  /**
   * Door OPENING WIDTH in mm (the "700"/"800"/… that distinguishes door-system
   * SKU variants of the same family). From the drawing's door_opening_width_mm.
   * When known, item selection prefers the matching-width variant. Optional.
   */
  door_opening_width?: number | null;
  /**
   * DBG — distance between guide rails (mm). dbg_main = car guides (sets the
   * SAFETY frame + main buffer channel size); dbg_counter = counterweight guides
   * (sets the COUNTER frame / guard net / filler weight / counter buffer size).
   * Mined from the corpus: these dimensions appear in those SKUs' names. From the
   * drawing. Optional — size-matching for those sections is a no-op when absent.
   */
  dbg_main_mm?: number | null;
  dbg_counter_mm?: number | null;
  /**
   * VISUAL door attributes — read from the drawing PICTURE (door elevation + plan),
   * not the text. door_vision = LV/MV/NV (extent of the glass drawn on the door);
   * door_side = LHS/RHS (which side a telescopic door operator parks). These resolve
   * what the spec text leaves silent. Optional — composition falls back to text when
   * absent.
   */
  door_vision?: string | null;
  landing_door_vision?: string | null; // landing door can differ from the car door
  door_side?: string | null;
}
export interface PredictedLine {
  section: string;
  phase: string;
  item_id: string;
  item_code: string;
  item_name: string;
  uom: string;
  suggestedQty: number;
  qtyMethod: "floor-scaled" | "as-is" | "rule";
  confidence: number; // 0..1
  confidenceBand: "high" | "medium" | "low";
  supportingJobs: string[];
}
export interface NeighbourMeta {
  id: string;
  job_number: string;
  sim: number;
  weight: number;
  isComplete: boolean;
}
export interface BomPrediction {
  draft: PredictedLine[];
  neighbours: NeighbourMeta[];
  completenessSource: "complete-neighbours" | "gate-fallback";
  overallConfidence: number;
  warnings: string[];
}

// ── Spec parsing ───────────────────────────────────────────────────────
export type CapKind = "pass" | "kg" | "unknown";
export function parseCapacity(cap: string | null | undefined): { kind: CapKind; kg: number } {
  if (!cap) return { kind: "unknown", kg: NaN };
  const s = cap.toUpperCase().replace(/\s+/g, "");
  let m = /^(\d+)\s*PASS/.exec(s);
  if (m) return { kind: "pass", kg: Number(m[1]) * TUNING.KG_PER_PASS };
  m = /(\d+)\s*KG/.exec(s);
  if (m) return { kind: "kg", kg: Number(m[1]) };
  return { kind: "unknown", kg: NaN };
}

export function similarity(t: BomTargetSpec, p: TrainingJob["spec"], dsim: DriveSimFn): number {
  const terms: { w: number; s: number }[] = [];
  const ds = dsim(t.drive_type, p.drive_type);
  if (ds !== null) terms.push({ w: TUNING.W_DRIVE, s: ds });

  // Door type: exact-match the door FAMILY. Decisive for the door-system SKUs and
  // orthogonal to drive type (one drive spans many door types), so it's the key
  // signal for the worst sections (car/landing door panel, header, sill, frame).
  if (t.door_type && p.door_type)
    terms.push({ w: TUNING.W_DOOR, s: t.door_type === p.door_type ? 1 : 0 });

  const tc = parseCapacity(t.capacity);
  const pc = parseCapacity(p.capacity);
  if (tc.kind !== "unknown" && pc.kind !== "unknown") {
    // goods (kg) vs passenger (pass) are different machines — hard penalty, not a soft gaussian
    const s =
      tc.kind !== pc.kind
        ? 0.12
        : Math.exp(-Math.pow((tc.kg - pc.kg) / TUNING.CAP_SOFTNESS_KG, 2));
    terms.push({ w: TUNING.W_CAP, s });
  }

  if (t.floors != null && p.floors != null) {
    const s = Math.exp(-Math.pow((t.floors - p.floors) / TUNING.FLOOR_SOFTNESS, 2));
    terms.push({ w: TUNING.W_FLOOR, s });
  }
  if (t.door_finish && p.door_finish)
    terms.push({ w: TUNING.W_FINISH, s: t.door_finish === p.door_finish ? 1 : 0 });
  if (t.brand && p.brand) terms.push({ w: TUNING.W_BRAND, s: t.brand === p.brand ? 1 : 0 });

  if (terms.length === 0) return 0;
  const wSum = terms.reduce((a, x) => a + x.w, 0);
  return terms.reduce((a, x) => a + x.w * x.s, 0) / wSum;
}

export function selectNeighbours(
  scored: { job: TrainingJob; sim: number }[],
  target: BomTargetSpec,
): { job: TrainingJob; meta: NeighbourMeta }[] {
  const sorted = [...scored].sort((a, b) => b.sim - a.sim);
  let chosen = sorted.filter((x) => x.sim >= TUNING.MIN_SIM).slice(0, TUNING.TARGET_K);

  if (chosen.length < TUNING.HARD_FLOOR_K) {
    // Rare drive type: prefer same-drive jobs absolutely, then best-by-sim.
    const same = sorted.filter((x) => x.job.spec.drive_type === target.drive_type);
    const others = sorted.filter((x) => x.job.spec.drive_type !== target.drive_type);
    chosen = [...same].slice(0, TUNING.TARGET_K);
    for (const o of others) {
      if (chosen.length >= TUNING.HARD_FLOOR_K) break;
      chosen.push(o);
    }
  }

  const wRaw = chosen.map((x) => Math.pow(x.sim, TUNING.SIM_SHARPEN));
  const wSum = wRaw.reduce((a, b) => a + b, 0) || 1;
  return chosen.map((x, i) => ({
    job: x.job,
    meta: {
      id: x.job.id,
      job_number: x.job.job_number,
      sim: x.sim,
      weight: wRaw[i] / wSum,
      isComplete: x.job.isComplete,
    },
  }));
}

export function weightedMedian(vals: number[], weights: number[]): number {
  if (vals.length === 0) return 0;
  const pairs = vals.map((v, i) => ({ v, w: weights[i] })).sort((a, b) => a.v - b.v);
  const total = pairs.reduce((a, p) => a + p.w, 0);
  let acc = 0;
  for (const p of pairs) {
    acc += p.w;
    if (acc >= total / 2) return p.v;
  }
  return pairs[pairs.length - 1].v;
}

function band(c: number): "high" | "medium" | "low" {
  return c >= 0.75 ? "high" : c >= 0.5 ? "medium" : "low";
}

const SECTION_META = new Map(BOM_SECTIONS.map((s) => [s.category, s]));

// ── Deterministic quantity rules (rulebook Part 6.1) ─────────────────────────
// High-confidence, evidence-backed counts that OVERRIDE the retrieved median for
// items whose quantity is a known function of the served-landing count L (= the
// target's total stops, post-migration 024) or a fixed per-config constant.
// Returns null to fall back to retrieval. Each rule is gated by the leave-one-out
// backtest (scripts/backtest-bom-predict.ts) and kept only if it doesn't regress
// the 71.7% keep-rate. itemName is the ground-truth match key — DB typos are
// load-bearing (see rulebook appendix: Alluminium, Pannel, …).
//
// Landing-side door parts that count once per served landing (rulebook §1.1).
const LANDING_SECTIONS = new Set<string>([
  "Landing Door Panel", "Landing Header System", "Door Post / Frame",
  "Linton Panel", "MAGNET WITH BRACKET", "Gate Lock",
]);

// Single-car / single-machine parts: exactly 1 in EVERY studied job (zero
// exceptions in the corpus). Safety/Governor (double on heavy goods), Car Door
// Panel (CO 2-leaf, up to 8) and Car Header (×2 on goods) are deliberately
// EXCLUDED — they legitimately exceed 1.
const CAR_SINGLETON_SECTIONS = new Set<string>([
  "Machine", "Machine Beam", "Counter Frame", "CONT. STAND",
  "STA. CAM", "Danger Plate", "Safety Tips Plate",
]);

function deterministicQty(itemName: string, section: string, L: number | null): number | null {
  const n = itemName.toLowerCase();

  // Rule A (§6.1 #5) — the terminal limit-switch set is a hard 6, NEVER stop-
  // scaled. `Final Limit Switch N/C` (121 lines) and `Limit Switch Bkt STD/GOODS`
  // (113 lines) are 6 in every job, 2-stop to 14-stop. Exclude `Bkt Home` (=1).
  if (/^final limit switch/.test(n)) return 6;
  if (/limit switch bkt/.test(n) && !n.includes("home")) return 6;

  // Rule D (§6.1 #4) — single-car/single-machine parts = 1 (independent of stops).
  if (CAR_SINGLETON_SECTIONS.has(section)) return 1;

  if (L == null || L <= 0) return null; // landing-scaled rules need the stop count

  // Rule C1 (§6.1 #2) — the sill ANGLE is one per served landing (qty−floors ≈ 0
  // across every angle SKU). Distinct from the finished aluminium sill.
  if (/sill angle/.test(n)) return L;

  // Re-test (2026-06-24): aluminium sill qty = stops+1 (= L+1), the modal across
  // every door type (CO 32/54, AT 33/58, COL 6/12 per the by-door-type breakdown).
  if (/all?uminium sill/.test(n) && L) return L + 1;

  // Rule B (§6.1 #1, the strongest rule) — every landing-side door part counts
  // once per served landing L. Measured qty−floors ≈ 0 (sd 0.28–0.77) across all
  // six sections. The single most reliable quantity in the whole corpus.
  if (LANDING_SECTIONS.has(section)) return L;

  return null;
}

export type SectionPool = Map<string, { line: TrainingLine; count: number; drives: Set<string> }[]>;

export function aggregateDraft(
  target: BomTargetSpec,
  neighbours: { job: TrainingJob; meta: NeighbourMeta }[],
  sectionPool?: SectionPool,
): { draft: PredictedLine[]; completenessSource: BomPrediction["completenessSource"]; warnings: string[] } {
  const warnings: string[] = [];
  let complete = neighbours.filter((n) => n.meta.isComplete);
  let completenessSource: BomPrediction["completenessSource"] = "complete-neighbours";
  if (complete.length === 0) {
    complete = neighbours;
    completenessSource = "gate-fallback";
    warnings.push("No complete similar jobs — sections guessed from the standard gate model.");
  }
  const completeW = complete.reduce((a, n) => a + n.meta.weight, 0) || 1;

  // Candidate sections: union seen across neighbours + gate-eligible standard sections.
  const candidate = new Set<string>();
  for (const n of neighbours) for (const c of Object.keys(n.job.sections)) candidate.add(c);
  for (const s of BOM_SECTIONS)
    if (shouldRenderSection(s, null, target.drive_type ?? null)) candidate.add(s.category);

  const draft: PredictedLine[] = [];
  for (const section of candidate) {
    const meta = SECTION_META.get(section);
    // Respect the gate: never suggest a section the target's drive type excludes.
    if (meta && !shouldRenderSection(meta, null, target.drive_type ?? null)) continue;

    // C_section: weighted fraction of COMPLETE neighbours that have this section.
    const cSection =
      complete.filter((n) => n.job.sections[section]).reduce((a, n) => a + n.meta.weight, 0) /
      completeW;
    const isAlways = meta?.gate.kind === "always" || meta?.gate.kind === "driveTypeExclude";
    if (cSection < TUNING.SECTION_THRESHOLD && !(isAlways && completenessSource === "complete-neighbours" && cSection > 0))
      continue;

    // Gather contributing lines from ALL neighbours that have the section.
    const have = neighbours.filter((n) => n.job.sections[section]);
    const haveW = have.reduce((a, n) => a + n.meta.weight, 0) || 1;
    type Agg = { item: TrainingLine; w: number; jobs: string[]; qtys: number[]; qw: number[] };
    const byItem = new Map<string, Agg>();
    for (const n of have) {
      const tFloors = target.floors ?? null;
      for (const ln of n.job.sections[section]) {
        let g = byItem.get(ln.item_id);
        if (!g) {
          g = { item: ln, w: 0, jobs: [], qtys: [], qw: [] };
          byItem.set(ln.item_id, g);
        }
        g.w += n.meta.weight;
        g.jobs.push(n.meta.job_number);
        // Floor-scale qty for per-stop sections when both floor counts are known.
        let q = ln.required_quantity;
        if (FLOOR_SCALED.has(section) && tFloors && n.job.spec.floors && n.job.spec.floors > 0)
          q = (ln.required_quantity / n.job.spec.floors) * tFloors;
        g.qtys.push(q);
        g.qw.push(n.meta.weight);
      }
    }

    // Size match: when the drawing gives the dimension that sets this section's SKU
    // size (door opening width for the door system; car/counter DBG for the safety
    // & counterweight frames), re-weight candidates toward the matching-size variant
    // before ranking/thresholding. A no-op for sections without a SIZE_RULE or when
    // the dimension is absent. (A finish-matching factor was tried and measured
    // net-zero — door SKU finish tokens don't align with the spec finish — so cut.)
    if (SIZE_RULES[section] && sizeTargetFor(section, target))
      for (const g of byItem.values()) g.w *= sizeFactor(g.item.item_name, section, target);

    // Composition: these SKUs encode the drawing's attributes in the name (door panel
    // = type/material/vision/width/colour; safety/counter frame = frame-type + DBG).
    // Pick the corpus SKU — from the WHOLE pool, not just neighbours — that matches the
    // most target attributes, and give it a dominant weight. Composes the SKU the way
    // the engineer does, even when no neighbour used it. Gated by COMPOSE_MIN_* so it
    // only fires on a confident match; otherwise retrieval stands.
    const pool = sectionPool?.get(section);
    const attrs = COMPOSE[section];
    if (pool && attrs) {
      const drive = target.drive_type ?? null;
      let best: { line: TrainingLine; score: number; max: number; drive: boolean; count: number } | null = null;
      for (const e of pool) {
        const r = composeScore(e.line.item_name, attrs, target);
        if (!r || r.max === 0) continue;
        const driveOk = !!(drive && e.drives.has(drive));
        if (
          !best ||
          r.score > best.score ||
          (r.score === best.score && driveOk && !best.drive) ||
          (r.score === best.score && driveOk === best.drive && e.count > best.count)
        ) {
          best = { line: e.line, score: r.score, max: r.max, drive: driveOk, count: e.count };
        }
      }
      if (best && best.score >= TUNING.COMPOSE_MIN_FRAC * best.max && best.score >= TUNING.COMPOSE_MIN_SCORE) {
        let g = byItem.get(best.line.item_id);
        if (!g) { g = { item: best.line, w: 0, jobs: [], qtys: [], qw: [] }; byItem.set(best.line.item_id, g); }
        g.w = Math.max(g.w, haveW * 2);
        if (g.qtys.length === 0) { g.qtys.push(best.line.required_quantity || 1); g.qw.push(1); }
      }
    } else if (pool && SIZE_RULES[section] && sizeTargetFor(section, target)) {
      // Single-dimension fallback (size-keyed sections not yet in COMPOSE).
      const matches = pool.filter((e) => sizeFactor(e.line.item_name, section, target) === TUNING.SIZE_BOOST);
      if (matches.length) {
        const drive = target.drive_type ?? null;
        matches.sort((a, b) => {
          const ad = drive && a.drives.has(drive) ? 1 : 0;
          const bd = drive && b.drives.has(drive) ? 1 : 0;
          return bd - ad || b.count - a.count;
        });
        const top = matches[0];
        let g = byItem.get(top.line.item_id);
        if (!g) { g = { item: top.line, w: 0, jobs: [], qtys: [], qw: [] }; byItem.set(top.line.item_id, g); }
        g.w = Math.max(g.w, haveW * 1.5);
        if (g.qtys.length === 0) { g.qtys.push(1); g.qw.push(1); }
      }
    }

    const ranked = [...byItem.values()].sort((a, b) => b.w - a.w);
    const kept = ranked.filter((g) => g.w / haveW >= TUNING.ITEM_THRESHOLD).slice(0, TUNING.MAX_ITEMS_PER_SECTION);
    if (kept.length === 0 && ranked.length) kept.push(ranked[0]); // always at least the modal item

    for (const g of kept) {
      const cItem = Math.min(1, g.w / haveW); // a size boost can exceed haveW — cap the confidence
      const m = weightedMedian(g.qtys, g.qw);
      const floorScaled = FLOOR_SCALED.has(section);
      // C_qty: 1 - normalized weighted dispersion (floored at 0.3).
      const mad = weightedMedian(g.qtys.map((q) => Math.abs(q - m)), g.qw);
      const cQty = Math.max(0.3, Math.min(1, 1 - mad / (m + 1e-6)));
      // C_support: Kish effective sample size damping.
      const sw = g.qw.reduce((a, b) => a + b, 0);
      const sw2 = g.qw.reduce((a, b) => a + b * b, 0) || 1;
      const neff = (sw * sw) / sw2;
      const cSupport = neff / (neff + 2);
      let conf = cSection * cItem * cQty * cSupport;
      if (completenessSource === "gate-fallback") conf *= 0.7;
      const medianQty = Number.isInteger(g.item.required_quantity) ? Math.round(m) : Math.round(m * 10) / 10;
      // A deterministic rule, when it fires, replaces the retrieved median.
      const det = deterministicQty(g.item.item_name, section, target.floors ?? null);
      const qty = det ?? medianQty;
      if (det != null) conf = Math.max(conf, 0.85); // hard rule fired — trust it
      draft.push({
        section,
        phase: (meta?.phase as string) ?? "Additional Items",
        item_id: g.item.item_id,
        item_code: g.item.item_code,
        item_name: g.item.item_name,
        uom: g.item.uom,
        suggestedQty: qty > 0 ? qty : g.item.required_quantity,
        qtyMethod: det != null ? "rule" : floorScaled ? "floor-scaled" : "as-is",
        confidence: conf,
        confidenceBand: band(conf),
        supportingJobs: [...new Set(g.jobs)],
      });
    }
  }

  // Order by phase then section, matching the form.
  const phaseIdx = (p: string) => {
    const i = (PHASE_ORDER as readonly string[]).indexOf(p);
    return i < 0 ? 999 : i;
  };
  draft.sort((a, b) => phaseIdx(a.phase) - phaseIdx(b.phase) || a.section.localeCompare(b.section));
  return { draft, completenessSource, warnings };
}

/** Build the section→item pool (every item ever used per section, with how many
 *  jobs used it and which drive types) — for name-composition on size-keyed sections. */
/** A section's full inventory pool: every catalogued SKU for that section, so
 *  composition can resolve the exact attribute combo even if no past job used it. */
export type InventoryPool = Map<string, TrainingLine[]>;

function buildSectionPool(corpus: TrainingJob[], inventory?: InventoryPool): SectionPool {
  const pool: SectionPool = new Map();
  for (const j of corpus) {
    const drive = j.spec.drive_type ?? "";
    for (const [sec, lines] of Object.entries(j.sections)) {
      if (!SIZE_RULES[sec] && !COMPOSE[sec]) continue; // only needed for composable / size-keyed sections
      let arr = pool.get(sec);
      if (!arr) { arr = []; pool.set(sec, arr); }
      const seen = new Set<string>();
      for (const ln of lines) {
        if (seen.has(ln.item_id)) continue;
        seen.add(ln.item_id);
        let e = arr.find((x) => x.line.item_id === ln.item_id);
        if (!e) { e = { line: ln, count: 0, drives: new Set() }; arr.push(e); }
        e.count++;
        if (drive) e.drives.add(drive);
      }
    }
  }
  // Fold in the full catalogue for composable sections — items not used by any past
  // job become available to compose (count 0 so a past-used SKU still wins ties).
  if (inventory) {
    for (const [sec, lines] of inventory) {
      if (!COMPOSE[sec]) continue;
      let arr = pool.get(sec);
      if (!arr) { arr = []; pool.set(sec, arr); }
      for (const ln of lines) {
        if (!arr.some((x) => x.line.item_id === ln.item_id)) arr.push({ line: ln, count: 0, drives: new Set() });
      }
    }
  }
  return pool;
}

/** Top-level pure prediction (used by both the server action and the backtest). */
export function predictFromCorpus(target: BomTargetSpec, corpus: TrainingJob[], inventory?: InventoryPool): BomPrediction {
  const dsim = buildDriveSim(corpus);
  const scored = corpus.map((job) => ({ job, sim: similarity(target, job.spec, dsim) }));
  const neighbours = selectNeighbours(scored, target);
  const warnings: string[] = [];
  if (neighbours.length && neighbours[0].meta.sim < 0.6)
    warnings.push("Closest past job is only a loose match — review everything.");
  if ((target.drive_type === "HYD" || target.drive_type === "CANTI"))
    warnings.push(`Rare drive type (${target.drive_type}) — very few similar jobs; verify all.`);
  const sectionPool = buildSectionPool(corpus, inventory);
  const { draft, completenessSource, warnings: aw } = aggregateDraft(target, neighbours, sectionPool);
  const overall = draft.length ? draft.reduce((a, l) => a + l.confidence, 0) / draft.length : 0;
  return {
    draft,
    neighbours: neighbours.map((n) => n.meta),
    completenessSource,
    overallConfidence: overall,
    warnings: [...warnings, ...aw],
  };
}
