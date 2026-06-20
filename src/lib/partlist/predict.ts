/**
 * Runtime part-list predictor — RULES ONLY (no "similar job" neighbour copy).
 *
 * Presence: the door/drive template skeleton (which particulars apply) + a
 *   door-independent core. Spec: capacity-band sizing rules (guide rail / fish
 *   plate) + drawing-derived door width (sills/headers/linton) + each particular's
 *   standard spec (specHint). Quantity: mined formula (stops / travel).
 *
 * Everything here is deterministic and inspectable; the BOM is blended on top by
 * lib/actions/partlist-generate.ts. As engineers mark lists "Ready", those become
 * the corpus to re-mine better rules (mine-from-ready.js) — the flywheel.
 */
import templatesRaw from "./templates.json";
import sizingRaw from "./sizing-bands.json";
import quantityModelsRaw from "./quantity-models.json";
import travelModelsRaw from "./travel-models.json";
import { PACKING_SECTIONS } from "@/lib/packing-list/packing-list-sections";

export interface PredictSpec {
  stops: number | null;
  capPass?: number | null;
  capKg?: number | null;
  doorType?: string | null;
  driveType?: string | null;
  home?: boolean;
  goods?: boolean;
  v3f?: boolean;
  travelMm?: number | null;
  doorWidthMm?: number | null;
}

export interface PredictedLine {
  canon: string | null;
  sectionKey: string;
  captureType: "item" | "free";
  particular: string;
  specs: string[];
  qty: number;
  qtySource: "drawing" | "formula" | "default";
  source: string;
  confidence: "high" | "medium" | "low";
}

interface QtyModel { model: string; value?: number; a?: number; b?: number; source?: string; sectionKeys?: string[] }
interface TravelModel { kind: string; perMm: number; b: number }
interface Skeleton { door: string; drive: string | null; goods?: boolean; home?: boolean; sectionKeys: string[] }

const TEMPLATES = templatesRaw as unknown as Record<string, Skeleton>;
// band-conditioned sizing mined from the corpus: canon -> band -> most-common spec
const SIZING = sizingRaw as unknown as Record<string, Record<string, string>>;
const QMODELS = quantityModelsRaw as unknown as Record<string, QtyModel>;
const TMODELS = travelModelsRaw as unknown as Record<string, TravelModel>;

const SECTION = new Map(PACKING_SECTIONS.map((s) => [s.key, s]));

// sectionKey -> canon (inverted from the quantity models)
const SECTION_CANON = new Map<string, string>();
for (const [canon, m] of Object.entries(QMODELS)) for (const sk of m.sectionKeys ?? []) if (!SECTION_CANON.has(sk)) SECTION_CANON.set(sk, canon);

// door-independent CORE = section_keys present in most skeletons
const CORE_KEYS = (() => {
  const count = new Map<string, number>();
  const tmpl = Object.values(TEMPLATES);
  for (const t of tmpl) for (const k of t.sectionKeys) count.set(k, (count.get(k) ?? 0) + 1);
  const need = Math.ceil(tmpl.length * 0.7);
  return new Set([...count.entries()].filter(([, n]) => n >= need).map(([k]) => k));
})();

const KG_PER_PASS = 68;
const toKg = (s: PredictSpec) => (s.capKg ? s.capKg : s.capPass ? s.capPass * KG_PER_PASS : null);
const doorFam = (d?: string | null) => {
  const u = (d || "").toUpperCase();
  if (/COLLAPS/.test(u)) return "collapsible";
  if (/SWING|SWS/.test(u)) return "swing";
  if (/DUMB/.test(u)) return "dumb";
  if (/\bMT\b|MANUAL|TELESCOPIC/.test(u) && !/AUTO/.test(u)) return "manual";
  if (/ACO|AT|AFF|CO|AUTO/.test(u)) return "auto";
  return u ? "other" : "?";
};

/** Which template skeleton best fits this job (door + drive + flags)? */
function pickSkeleton(target: PredictSpec): { keys: Set<string>; matchedDoor: boolean } {
  const tf = target.home ? "auto-home" : doorFam(target.doorType);
  let best: { name: string; score: number } | null = null;
  for (const [name, t] of Object.entries(TEMPLATES)) {
    let s = 0;
    if (target.home && t.home) s += 6;
    if (!target.home) {
      const f = doorFam(t.door);
      if (f === doorFam(target.doorType)) s += 4;
    }
    if (target.goods && t.goods) s += 3;
    if (target.driveType && t.drive && target.driveType.toUpperCase() === t.drive.toUpperCase()) s += 2;
    if (target.v3f && t.drive === "V3F") s += 1;
    if (!best || s > best.score) best = { name, score: s };
  }
  // a real door-family match scores >= 4 (or home). otherwise fall back to core only.
  const matchedDoor = !!best && best.score >= 4;
  const keys = new Set<string>(CORE_KEYS);
  if (matchedDoor && best) for (const k of TEMPLATES[best.name].sectionKeys) keys.add(k);
  return { keys, matchedDoor };
}

function bandOf(target: PredictSpec): string {
  const kg = toKg(target);
  if (target.goods) {
    if (kg == null) return "GoodsMR2-2.5";
    if (kg < 1500) return "GoodsMR<1.5";
    if (kg <= 2500) return "GoodsMR2-2.5";
    return "GoodsMR3";
  }
  const pass = target.capPass ?? (kg != null ? Math.round(kg / KG_PER_PASS) : null);
  if (pass == null) return "13-16P";
  if (pass <= 10) return "4-10P";
  if (pass <= 16) return "13-16P";
  if ((kg ?? 0) >= 4000) return "4Ton";
  return ">1Ton";
}

function applyModel(m: QtyModel | undefined, stops: number | null): number | null {
  if (!m) return null;
  const s = stops ?? 0;
  switch (m.model) {
    case "constant": return m.value ?? null;
    case "stops": return s;
    case "stops+1": return s + 1;
    case "stops-1": return s - 1;
    case "2*stops": return 2 * s;
    case "2*stops+1": return 2 * s + 1;
    case "linear": return m.a != null && m.b != null ? Math.round(m.a * s + m.b) : null;
    default: return null;
  }
}

function ruleQty(canon: string | null, target: PredictSpec): { qty: number; src: PredictedLine["qtySource"]; reliable: boolean } {
  if (canon) {
    const tm = TMODELS[canon];
    if (tm && tm.kind === "travelLinear" && target.travelMm != null) {
      const t = Math.round(tm.perMm * target.travelMm + tm.b);
      if (t > 0) return { qty: t, src: "drawing", reliable: true };
    }
    const m = QMODELS[canon];
    const f = applyModel(m, target.stops);
    if (f != null && f >= 0) return { qty: Math.max(0, f) || 1, src: "formula", reliable: m?.source === "formula" };
  }
  return { qty: 1, src: "default", reliable: false };
}

function ruleSpec(sectionKey: string, canon: string | null, target: PredictSpec): { spec: string | null; sized: boolean } {
  // door-width-driven parts use the drawing's actual clear opening when available
  if (target.doorWidthMm && /sill|header|linton|lintone|door-post/.test(sectionKey)) {
    return { spec: `${target.doorWidthMm}mm`, sized: true };
  }
  // band-conditioned mined size (beats the old hand-parsed Rules table; see compare-rules-vs-neighbor)
  const bm = canon ? SIZING[canon]?.[bandOf(target)] : null;
  if (bm) return { spec: bm, sized: true };
  return { spec: SECTION.get(sectionKey)?.specHint || null, sized: false };
}

/** Rule-based draft lines for the applicable skeleton. */
export function predictPartList(target: PredictSpec): { lines: PredictedLine[]; matchedDoor: boolean } {
  const { keys, matchedDoor } = pickSkeleton(target);
  const lines: PredictedLine[] = [];
  for (const sk of keys) {
    const sec = SECTION.get(sk);
    if (!sec) continue;
    const canon = SECTION_CANON.get(sk) ?? null;
    const { spec, sized } = ruleSpec(sk, canon, target);
    const { qty, src, reliable } = ruleQty(canon, target);
    const confidence: PredictedLine["confidence"] = sized || src === "drawing" || reliable ? "high" : src === "formula" ? "medium" : "low";
    lines.push({
      canon, sectionKey: sk, captureType: sec.captureType, particular: sec.label,
      specs: spec ? [spec] : [], qty, qtySource: src,
      source: src === "drawing" ? "rule + drawing" : "rule", confidence,
    });
  }
  return { lines, matchedDoor };
}
