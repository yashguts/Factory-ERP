/**
 * Runtime part-list predictor (ported from scripts/partlist-brain/predict.js).
 *
 * Given a job spec (+ optional drawing-derived travel), find the most similar
 * historical job and copy its part-list structure, refining quantities by mined
 * formulas / travel models. This is the "brain" half of the blend — the BOM is
 * merged in by the blend engine (lib/actions/partlist-generate.ts).
 *
 * Single-nearest-neighbour by design: backtesting showed top-K consensus gives
 * no gain (jobs cluster tightly by door/drive/capacity). See ACCURACY-REPORT.md.
 */
import corpusRaw from "./corpus-compact.json";
import quantityModelsRaw from "./quantity-models.json";
import travelModelsRaw from "./travel-models.json";

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
}

interface CorpusLine { canon: string; sectionKey: string | null; spec: string; qty: number | null; captureType: string | null }
interface CorpusJob { sheet: string; spec: PredictSpec; lines: CorpusLine[] }
interface QtyModel { model: string; value?: number; a?: number; b?: number; source?: string; captureType?: string }
interface TravelModel { kind: string; perMm: number; b: number }

const CORPUS = corpusRaw as unknown as CorpusJob[];
const QMODELS = quantityModelsRaw as unknown as Record<string, QtyModel>;
const TMODELS = travelModelsRaw as unknown as Record<string, TravelModel>;

export interface PredictedLine {
  canon: string;
  sectionKey: string | null;
  captureType: string | null;
  particular: string;
  specs: string[];
  qty: number;
  qtySource: "travel" | "formula" | "knn";
  neighbour: string;
  sim: number;
}

const KG_PER_PASS = 68;
function toKg(s: PredictSpec): number | null {
  if (s.capKg) return s.capKg;
  if (s.capPass) return s.capPass * KG_PER_PASS;
  return null;
}

const DOOR_FAMILY: Record<string, string> = {
  ACO: "auto", AT: "auto", AFF: "auto", CO: "auto", AUTO: "auto",
  MT: "manual", TELESCOPIC: "manual", MANUAL: "manual",
  COLLAPSIBLE: "collapsible", COLLAPSIBEL: "collapsible",
  SWING: "swing", SWS: "swing", IMPERFORATED: "swing",
  DUMB: "dumb", DUMBWAITER: "dumb",
};
const fam = (d?: string | null) => (d ? DOOR_FAMILY[d] || d : "?");

export function similarity(a: PredictSpec, b: PredictSpec): number {
  const ds = a.stops != null && b.stops != null ? Math.abs(a.stops - b.stops) : 4;
  const sStops = Math.exp(-((ds / 2) ** 2));
  const ka = toKg(a), kb = toKg(b);
  let sCap = 0.4;
  if (ka != null && kb != null) sCap = Math.exp(-(((ka - kb) / 220) ** 2));
  let sDoor = 0.15;
  if (a.doorType && b.doorType) sDoor = a.doorType === b.doorType ? 1 : fam(a.doorType) === fam(b.doorType) ? 0.6 : 0.15;
  let sDrive = 0.4;
  if (a.driveType && b.driveType) sDrive = a.driveType === b.driveType ? 1 : 0.35;
  const sFlag = ((a.home === b.home ? 1 : 0) + (a.goods === b.goods ? 1 : 0)) / 2;
  return 0.34 * sDoor + 0.24 * sStops + 0.22 * sCap + 0.1 * sDrive + 0.1 * sFlag;
}

function applyFormula(m: QtyModel | undefined, stops: number): number | null {
  if (!m) return null;
  switch (m.model) {
    case "constant": return m.value ?? null;
    case "stops": return stops;
    case "stops+1": return stops + 1;
    case "stops-1": return stops - 1;
    case "2*stops": return 2 * stops;
    case "2*stops+1": return 2 * stops + 1;
    case "linear": return m.a != null && m.b != null ? Math.round(m.a * stops + m.b) : null;
    default: return null;
  }
}

function qtyFor(canon: string, stops: number | null, travelMm: number | null | undefined, fallback: number): { qty: number; src: PredictedLine["qtySource"] } {
  const tm = TMODELS[canon];
  if (tm && tm.kind === "travelLinear" && travelMm != null) {
    const t = Math.round(tm.perMm * travelMm + tm.b);
    if (t > 0) return { qty: t, src: "travel" };
  }
  const m = QMODELS[canon];
  if (m && m.source === "formula" && stops != null) {
    const f = applyFormula(m, stops);
    if (f != null && f >= 0) return { qty: f, src: "formula" };
  }
  return { qty: fallback, src: "knn" };
}

/** Most-similar past job's part list, qty-refined by formula/travel. */
export function predictPartList(target: PredictSpec): { lines: PredictedLine[]; neighbours: { sheet: string; sim: number }[] } {
  const ranked = CORPUS.map((rec) => ({ rec, sim: similarity(target, rec.spec) })).sort((a, b) => b.sim - a.sim);
  if (!ranked.length) return { lines: [], neighbours: [] };
  const best = ranked[0];
  const stops = target.stops != null ? target.stops : best.rec.spec.stops;

  const byCanon = new Map<string, { sectionKey: string | null; captureType: string | null; particular: string; qty: number; specs: string[] }>();
  for (const l of best.rec.lines) {
    if (!l.canon) continue;
    let e = byCanon.get(l.canon);
    if (!e) { e = { sectionKey: l.sectionKey, captureType: l.captureType, particular: l.canon, qty: 0, specs: [] }; byCanon.set(l.canon, e); }
    if (l.qty != null) e.qty += l.qty;
    if (l.spec) e.specs.push(l.spec);
  }

  const lines: PredictedLine[] = [];
  for (const [canon, e] of byCanon) {
    const { qty, src } = qtyFor(canon, stops, target.travelMm, e.qty);
    lines.push({ canon, sectionKey: e.sectionKey, captureType: e.captureType, particular: e.particular, specs: e.specs, qty, qtySource: src, neighbour: best.rec.sheet, sim: +best.sim.toFixed(3) });
  }
  return { lines, neighbours: ranked.slice(0, 5).map((r) => ({ sheet: r.rec.sheet, sim: +r.sim.toFixed(3) })) };
}
