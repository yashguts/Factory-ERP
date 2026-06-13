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
  TARGET_K: 8,
  MIN_SIM: 0.45,
  HARD_FLOOR_K: 3,
  SECTION_THRESHOLD: 0.4,
  ITEM_THRESHOLD: 0.3,
  MAX_ITEMS_PER_SECTION: 4,
  SIM_SHARPEN: 2,
  CAP_SOFTNESS_KG: 220,
  FLOOR_SOFTNESS: 2.0,
  KG_PER_PASS: 68,
};

// Sections whose quantity scales ~per-floor; everything else is a fixed count.
const FLOOR_SCALED = new Set<string>([
  "RAIL", "Landing Door Panel", "Landing Header System", "Door Post / Frame",
  "Door Sill", "Gate Lock", "MAIN BRACKET", "COUNTER BRACKET", "RAIL CLIP",
  "Linton Panel", "LIMIT SWITCH BRACKET", "MAGNET WITH BRACKET",
  "TROUGHING 50", "TROUGHING 100",
]);

// Drive-type adjacency (symmetric). Encodes that a rare HYD target shouldn't be
// flooded by MRL neighbours whose section topology is wrong for it.
const DRIVE_SIM: Record<string, Record<string, number>> = {
  MRL: { MR: 0.55, BELT: 0.45, HOME: 0.3 },
  MR: { MRL: 0.55, BELT: 0.35 },
  BELT: { MRL: 0.45, MR: 0.35, HOME: 0.3 },
  HOME: { MRL: 0.3, BELT: 0.3 },
  HYD: {},
  CANTI: {},
};

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
}
export interface PredictedLine {
  section: string;
  phase: string;
  item_id: string;
  item_code: string;
  item_name: string;
  uom: string;
  suggestedQty: number;
  qtyMethod: "floor-scaled" | "as-is";
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

function driveSim(a: string | null, b: string | null): number | null {
  if (!a || !b) return null; // field dropped
  if (a === b) return 1;
  return DRIVE_SIM[a]?.[b] ?? DRIVE_SIM[b]?.[a] ?? 0.05;
}

export function similarity(t: BomTargetSpec, p: TrainingJob["spec"]): number {
  const terms: { w: number; s: number }[] = [];
  const ds = driveSim(t.drive_type, p.drive_type);
  if (ds !== null) terms.push({ w: 0.45, s: ds });

  const tc = parseCapacity(t.capacity);
  const pc = parseCapacity(p.capacity);
  if (tc.kind !== "unknown" && pc.kind !== "unknown") {
    // goods (kg) vs passenger (pass) are different machines — hard penalty, not a soft gaussian
    const s =
      tc.kind !== pc.kind
        ? 0.12
        : Math.exp(-Math.pow((tc.kg - pc.kg) / TUNING.CAP_SOFTNESS_KG, 2));
    terms.push({ w: 0.25, s });
  }

  if (t.floors != null && p.floors != null) {
    const s = Math.exp(-Math.pow((t.floors - p.floors) / TUNING.FLOOR_SOFTNESS, 2));
    terms.push({ w: 0.2, s });
  }
  if (t.door_finish && p.door_finish)
    terms.push({ w: 0.06, s: t.door_finish === p.door_finish ? 1 : 0 });
  if (t.brand && p.brand) terms.push({ w: 0.04, s: t.brand === p.brand ? 1 : 0 });

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

export function aggregateDraft(
  target: BomTargetSpec,
  neighbours: { job: TrainingJob; meta: NeighbourMeta }[],
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

    const ranked = [...byItem.values()].sort((a, b) => b.w - a.w);
    const kept = ranked.filter((g) => g.w / haveW >= TUNING.ITEM_THRESHOLD).slice(0, TUNING.MAX_ITEMS_PER_SECTION);
    if (kept.length === 0 && ranked.length) kept.push(ranked[0]); // always at least the modal item

    for (const g of kept) {
      const cItem = g.w / haveW;
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
      const qty = Number.isInteger(g.item.required_quantity) ? Math.round(m) : Math.round(m * 10) / 10;
      draft.push({
        section,
        phase: (meta?.phase as string) ?? "Additional Items",
        item_id: g.item.item_id,
        item_code: g.item.item_code,
        item_name: g.item.item_name,
        uom: g.item.uom,
        suggestedQty: qty > 0 ? qty : g.item.required_quantity,
        qtyMethod: floorScaled ? "floor-scaled" : "as-is",
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

/** Top-level pure prediction (used by both the server action and the backtest). */
export function predictFromCorpus(target: BomTargetSpec, corpus: TrainingJob[]): BomPrediction {
  const scored = corpus.map((job) => ({ job, sim: similarity(target, job.spec) }));
  const neighbours = selectNeighbours(scored, target);
  const warnings: string[] = [];
  if (neighbours.length && neighbours[0].meta.sim < 0.6)
    warnings.push("Closest past job is only a loose match — review everything.");
  if ((target.drive_type === "HYD" || target.drive_type === "CANTI"))
    warnings.push(`Rare drive type (${target.drive_type}) — very few similar jobs; verify all.`);
  const { draft, completenessSource, warnings: aw } = aggregateDraft(target, neighbours);
  const overall = draft.length ? draft.reduce((a, l) => a + l.confidence, 0) / draft.length : 0;
  return {
    draft,
    neighbours: neighbours.map((n) => n.meta),
    completenessSource,
    overallConfidence: overall,
    warnings: [...warnings, ...aw],
  };
}
