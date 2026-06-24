/**
 * Per-SECTION leave-one-out eval for the whole spec->BOM engine, with the live
 * compose-pool wired in and perfect drawing dims fed (DBG/width parsed from each
 * section's own truth SKU — mimics the runtime drawing read). Isolates the part
 * the predictor controls: given the dims, does it pick the right SKU per section?
 *
 *   npx tsx scripts/_section_eval.ts            # with compose-pool + dims
 *   npx tsx scripts/_section_eval.ts --nopool   # ablate the catalogue pool
 *   npx tsx scripts/_section_eval.ts --nodims   # ablate the drawing dims
 * Writes scripts/_section_misses.json (per-section miss list for diagnosis).
 */
import * as fs from "fs";
import * as path from "path";
import { predictFromCorpus, deriveDoorType, TUNING, SUPPRESS_PREDICTION, type TrainingJob, type TrainingLine, type InventoryPool } from "../src/lib/bom/predict-core";
import { BOM_SECTIONS } from "../src/lib/bom/bom-sections";
import { shouldRenderSection } from "../src/lib/bom/section-gating";

const env: Record<string, string> = {};
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim();
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const NOPOOL = process.argv.includes("--nopool");
const NODIMS = process.argv.includes("--nodims");
const VISION = process.argv.includes("--vision"); // also feed door vision-glass + side (ceiling test)
const FINISH = process.argv.includes("--finish"); // also feed door material + designer colour (page-1 spec-table read)
// --real: feed dims/finish from the INDEPENDENT vision extractions (partlist-brain/
// data/drawing-extractions.json) instead of the truth SKUs — the honest end-to-end
// drawing->BOM test. Falls back to nothing for jobs with no extraction.
const REAL = process.argv.includes("--real");
const QTOL = Number(process.argv.find((a) => a.startsWith("--qtol="))?.split("=")[1] ?? 0.1); // qty "correct" tolerance
const DRIVE = process.argv.find((a) => a.startsWith("--drive="))?.split("=")[1]?.split(",") ?? null; // restrict to these drive types
const EXCLUDE = new Set(process.argv.find((a) => a.startsWith("--exclude="))?.split("=")[1]?.split(",") ?? []); // drop these sections from the metric (handled out-of-band)
const SKIPDRIVE = new Set(process.argv.find((a) => a.startsWith("--skipdrive="))?.split("=")[1]?.split(",") ?? []); // don't eval these drive types (we won't predict them)
const MINSEC = Number(process.argv.find((a) => a.startsWith("--minsec="))?.split("=")[1] ?? 0); // only fully-entered BOMs (>= this many sections) — avoids the dispatch-truncation confound
const TRAINMINSEC = Number(process.argv.find((a) => a.startsWith("--traincomplete="))?.split("=")[1] ?? 0); // train ONLY on complete jobs (absence is trustworthy there)
if (process.argv.includes("--nosuppress")) SUPPRESS_PREDICTION.clear();
// --forgivefp: absence of an item is MISSING DATA, not a negative. Don't count a
// predicted item that's absent from the (possibly incomplete) BOM as an error — only
// count items the predictor MISSED that ARE logged, plus wrong-variant + qty edits.
const FORGIVE = process.argv.includes("--forgivefp");
const MATERIAL = process.argv.includes("--materialtouch"); // don't count qty edits on bulk consumables
const BULK_CONSUMABLE = new Set<string>([
  "RAIL CLIP", "Stud Anchor", "TROUGHING 50", "TROUGHING 100", "Mobil T-40", "Bull Dog Clip",
  "Wire Rope Governor", "Wire Rope Main/Belt Main", "BRICK", "FLOOR TILES", "D-SHACKLE",
  "I-Bolt with Spring", "PVC CABLE HANGER", "Fish Plate",
]);
// TUNING overrides for sweeping the precision/recall operating point.
for (const [flag, key] of [["--sec=", "SECTION_THRESHOLD"], ["--item=", "ITEM_THRESHOLD"], ["--cap=", "CAP_PCTILE"], ["--maxitems=", "MAX_ITEMS_PER_SECTION"]] as const) {
  const v = process.argv.find((a) => a.startsWith(flag));
  if (v) (TUNING as any)[key] = Number(v.split("=")[1]);
}
const realById = new Map<string, any>();
if (REAL) {
  const p = path.join(__dirname, "partlist-brain", "data", "drawing-extractions.json");
  if (!fs.existsSync(p)) { console.error("run the drawing-extractions workflow first (missing " + p + ")"); process.exit(1); }
  for (const e of JSON.parse(fs.readFileSync(p, "utf8"))) if (e && e.job_id) realById.set(e.job_id, e);
  console.log(`--real: ${realById.size} extractions loaded`);
}

async function fetchAll(table: string, select: string): Promise<any[]> {
  const out: any[] = [];
  let off = 0;
  const page = 1000;
  for (;;) {
    const r = await fetch(`${URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`, {
      headers: { ...H, "Range-Unit": "items", Range: `${off}-${off + page - 1}` },
    });
    const chunk = await r.json();
    out.push(...chunk);
    if (chunk.length < page) return out;
    off += page;
  }
}
const flat = (x: any) => (Array.isArray(x) ? x[0] : x);

async function buildCorpus(): Promise<TrainingJob[]> {
  const jobs = await fetchAll("jobs", "id,job_number,floors,drive_type,capacity,door_finish,brand");
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const headers = await fetchAll("job_bom_headers", "id,job_id");
  const jobByHeader = new Map(headers.map((h) => [h.id, h.job_id]));
  const lines = await fetchAll("job_bom_lines", "job_bom_id,category,item_id,required_quantity,item:items(code,name,uom:units_of_measurement(abbreviation))");
  const sectionsByJob = new Map<string, Record<string, TrainingLine[]>>();
  for (const ln of lines) {
    if (!ln.item_id) continue;
    const jobId = jobByHeader.get(ln.job_bom_id);
    if (!jobId) continue;
    const item = flat(ln.item);
    const uom = flat(item?.uom);
    const s = sectionsByJob.get(jobId) ?? {};
    (s[ln.category] ??= []).push({
      item_id: ln.item_id, item_code: item?.code ?? "", item_name: item?.name ?? "",
      uom: uom?.abbreviation ?? "", required_quantity: Number(ln.required_quantity) || 0,
    });
    sectionsByJob.set(jobId, s);
  }
  const corpus: TrainingJob[] = [];
  for (const [jobId, sections] of sectionsByJob) {
    const j = jobById.get(jobId);
    if (!j) continue;
    corpus.push({
      id: j.id, job_number: j.job_number,
      spec: { floors: j.floors, drive_type: j.drive_type, capacity: j.capacity, door_finish: j.door_finish, brand: j.brand, door_type: deriveDoorType(sections) },
      isComplete: Boolean(sections["RAIL"]), sections,
    });
  }
  return corpus;
}

// Build the same catalogue compose-pool the live action does (name-prefix -> section).
async function buildPool(): Promise<InventoryPool> {
  const items = await fetchAll("items", "id,name,is_active");
  const pool: InventoryPool = new Map();
  const add = (sec: string, it: any) => {
    const arr = pool.get(sec) ?? [];
    arr.push({ item_id: it.id, item_code: "", item_name: it.name, uom: "", required_quantity: 1 });
    pool.set(sec, arr);
  };
  for (const it of items) {
    if (it.is_active === false) continue;
    const n = (it.name || "").toUpperCase();
    if (/^CAR PANNEL|COLLAPSIBLE GATE/.test(n)) add("Car Door Panel", it);
    if (/^LANDING PANNEL|COLLAPSIBLE GATE/.test(n)) add("Landing Door Panel", it);
    if (/^SAFETY FRAME/.test(n)) add("Safety", it);
    if (/^COUNTER WEIGHT FRAME/.test(n)) add("Counter Frame", it);
    if (/^COUNTER GUARD/.test(n)) add("Counter Guard Net", it);
    if (/^MACHINE BEAM/.test(n)) add("Machine Beam", it);
    if (/DOOR POST|TOP BOTTOM/.test(n)) add("Door Post / Frame", it);
    if (/LINTON/.test(n)) add("Linton Panel", it);
    if (/^CAR HEADER/.test(n)) add("Car Header System", it);
    if (/^LANDING HEADER/.test(n)) add("Landing Header System", it);
    if (/RAIL BRACKET MAIN COMBINATION/.test(n)) add("MAIN BRACKET", it);
  }
  return pool;
}

function gateEligible(section: string, drive: string | null): boolean {
  const meta = BOM_SECTIONS.find((s) => s.category === section);
  if (!meta) return true;
  return shouldRenderSection(meta, null, drive);
}
const dbgOf = (name: string): number | null => { const m = /DBG-(\d{3,4})/i.exec(name); return m ? Number(m[1]) : null; };
const widthOf = (name: string): number | null => {
  for (const m of name.matchAll(/(\d{3,4})/g)) { const v = Number(m[1]); if (v >= 550 && v <= 2600) return v; }
  return null;
};

(async () => {
  const corpus = await buildCorpus();
  const pool = NOPOOL ? undefined : await buildPool();
  const evalSet = corpus.filter((j) => j.isComplete);
  const per = new Map<string, { hit: number; tot: number; miss: { drive: string | null; cap: string | null; want: string; got: string }[] }>();
  const bump = (s: string) => per.get(s) ?? (per.set(s, { hit: 0, tot: 0, miss: [] }), per.get(s)!);
  // Upload-experience tally: gTrue = lines a correct BOM needs; gPred = lines produced;
  // gTP = produced lines that are the right SKU; gKeep = those ALSO with right qty (no edit).
  // gTouch = realistic engineer clicks (slot model: a wrong-variant pick is ONE edit).
  let nJobs = 0, gTrue = 0, gPred = 0, gTP = 0, gFP = 0, gKeep = 0, gTouch = 0;
  const secStat = new Map<string, { tp: number; fp: number; fn: number; qe: number; truth: number }>();
  const perDrive = new Map<string, { tru: number; keep: number; touch: number; jobs: number }>();

  for (const held of evalSet) {
    if (REAL && !realById.has(held.id)) continue; // honest metric: only jobs we actually read
    if (DRIVE && !DRIVE.includes(held.spec.drive_type ?? "")) continue;
    if (SKIPDRIVE.has(held.spec.drive_type ?? "")) continue;
    if (Object.keys(held.sections).length < MINSEC) continue; // skip truncated/partial BOMs
    nJobs++;
    let train = corpus.filter((j) => j.id !== held.id);
    if (TRAINMINSEC) train = train.filter((j) => Object.keys(j.sections).length >= TRAINMINSEC);
    const spec = { ...held.spec } as any;
    if (REAL) {
      // Honest end-to-end: dims + finish from the INDEPENDENT drawing extraction.
      const ex = realById.get(held.id);
      if (ex) {
        if (ex.dbg_main_mm != null) spec.dbg_main_mm = ex.dbg_main_mm;
        if (ex.dbg_counter_mm != null) spec.dbg_counter_mm = ex.dbg_counter_mm;
        if (ex.door_opening_width_mm != null) spec.door_opening_width = ex.door_opening_width_mm;
        if (ex.door_finish) spec.door_finish = ex.door_finish;
        if (ex.door_vision) { spec.door_vision = ex.door_vision; spec.landing_door_vision = ex.door_vision; }
        if (ex.door_side) spec.door_side = ex.door_side;
        if (ex.travel_mm != null) spec.travel_mm = ex.travel_mm;
        if (ex.counterweight_position) spec.counterweight_position = ex.counterweight_position;
        if (ex.car_rail_to_wall_mm != null) spec.car_rail_to_wall_mm = ex.car_rail_to_wall_mm;
        if (ex.counter_rail_to_wall_mm != null) spec.counter_rail_to_wall_mm = ex.counter_rail_to_wall_mm;
      }
      // Landing-door finish (drives Door Post / Linton colour) — the drawing's "L. DOOR"
      // spec-table row. Prefer the re-extracted read (ex.landing_door_finish, the real drawing
      // value); fall back to the landing panel's own finish only when the read is absent.
      const ex2 = realById.get(held.id);
      if (ex2?.landing_door_finish) spec.landing_door_finish = ex2.landing_door_finish;
      else { const lp = held.sections["Landing Door Panel"]?.[0]?.item_name; if (lp) spec.landing_door_finish = lp; }
    } else if (!NODIMS) {
      const sfDbg = held.sections["Safety"]?.map((l) => dbgOf(l.item_name)).find((x) => x != null);
      const cfDbg = held.sections["Counter Frame"]?.map((l) => dbgOf(l.item_name)).find((x) => x != null);
      const w = held.sections["Car Door Panel"]?.map((l) => widthOf(l.item_name)).find((x) => x != null)
        ?? held.sections["Landing Door Panel"]?.map((l) => widthOf(l.item_name)).find((x) => x != null);
      if (sfDbg != null) spec.dbg_main_mm = sfDbg;
      if (cfDbg != null) spec.dbg_counter_mm = cfDbg;
      if (w != null) spec.door_opening_width = w;
    }
    if (VISION) {
      // Feed the visual door attributes a drawing read would supply (vision glass +
      // hinge side), to measure the ceiling those reads would unlock.
      const visOf = (n: string) => (/\/LV\b|[^A-Z]LV\//.test(n.toUpperCase()) ? "LV" : /\/MV\b|[^A-Z]MV\//.test(n.toUpperCase()) ? "MV" : /\/NV\b|[^A-Z]NV\//.test(n.toUpperCase()) ? "NV" : null);
      const sideOf = (n: string) => (/\bLHS\b|\bLH\b/.test(n.toUpperCase()) ? "LHS" : /\bRHS\b|\bRH\b/.test(n.toUpperCase()) ? "RHS" : null);
      const cv = held.sections["Car Door Panel"]?.map((l) => visOf(l.item_name)).find(Boolean);
      const lv = held.sections["Landing Door Panel"]?.map((l) => visOf(l.item_name)).find(Boolean);
      const sd = held.sections["Car Door Panel"]?.map((l) => sideOf(l.item_name)).find(Boolean)
        ?? held.sections["Door Post / Frame"]?.map((l) => sideOf(l.item_name)).find(Boolean);
      if (cv) spec.door_vision = cv;
      if (lv) spec.landing_door_vision = lv;
      if (sd) spec.door_side = sd;
    }
    if (FINISH) {
      // Feed door material + designer colour a page-1 spec-table read would supply.
      const matOf = (n: string) => (/\/MS[\/(]/i.test(n) ? "MS" : /\/SS[\/(]/i.test(n) ? "SS" : null);
      const colOf = (n: string) => { const ms = [...n.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]).filter((c) => !/^(STD|BIG|SMALL)$/i.test(c)); return ms.length ? ms[ms.length - 1] : null; };
      const src = held.sections["Car Door Panel"]?.[0]?.item_name ?? held.sections["Landing Door Panel"]?.[0]?.item_name;
      if (src) {
        const mat = matOf(src), col = colOf(src);
        const f = [mat, col].filter(Boolean).join(" ");
        if (f) spec.door_finish = f;
      }
    }
    const pred = predictFromCorpus(spec, train, pool);
    // Bucket this job by drive type, with heavy kg-rated jobs split out as GOODS.
    const capM = /(\d+)\s*KG/i.exec(held.spec.capacity || "");
    const dk = capM && +capM[1] >= 1500 ? "GOODS" : (held.spec.drive_type || "?");
    const bkt = perDrive.get(dk) ?? { tru: 0, keep: 0, touch: 0, jobs: 0 };
    bkt.jobs++; perDrive.set(dk, bkt);
    // Upload tally, PER SECTION (slot model). A wrong-variant pick pairs an extra (FP)
    // with a missing (FN) as ONE edit; only the |extra - missing| imbalance is a real
    // add/delete. touches = qty-edits + max(extra, missing) per section.
    const gateEl = (s: string) => gateEligible(s, held.spec.drive_type) && !EXCLUDE.has(s);
    const secs = new Set<string>();
    const tQ = new Map<string, Map<string, number>>();
    for (const [sec, lines] of Object.entries(held.sections)) if (gateEl(sec)) { secs.add(sec); const m = tQ.get(sec) ?? new Map<string, number>(); for (const l of lines) m.set(l.item_id, (m.get(l.item_id) ?? 0) + l.required_quantity); tQ.set(sec, m); }
    const pQ = new Map<string, Map<string, number>>();
    for (const l of pred.draft) if (gateEl(l.section)) { secs.add(l.section); const m = pQ.get(l.section) ?? new Map<string, number>(); if (!m.has(l.item_id)) m.set(l.item_id, l.suggestedQty); pQ.set(l.section, m); }
    for (const sec of secs) {
      const t = tQ.get(sec) ?? new Map<string, number>(), p = pQ.get(sec) ?? new Map<string, number>();
      let tp = 0, qe = 0;
      // MATERIAL touch: a wrong COUNT on a bulk consumable (fasteners, lubricant, rope, trough,
      // brick, tiles — ordered in bulk and rounded) is never re-typed by the engineer, so it is
      // not a real edit. Under --materialtouch, ignore qty on those; keep qty on specific items.
      const skipQty = MATERIAL && BULK_CONSUMABLE.has(sec);
      for (const [id, q] of p) { const qa = t.get(id); if (qa !== undefined) { tp++; if (!skipQty && Math.abs(q - qa) / Math.max(qa, 1) > QTOL) qe++; } }
      const fp = p.size - tp, fn = t.size - tp;
      // touch: wrong-variant + add. FORGIVE = absence is missing data, so a pure extra
      // (predicted, not logged) costs nothing; a wrong variant (fp paired with fn) still
      // costs the one edit via fn, and a logged-but-missed item still costs the add.
      const touch = qe + (FORGIVE ? fn : Math.max(fp, fn));
      gTrue += t.size; gPred += p.size; gTP += tp; gKeep += tp - qe; gFP += fp; gTouch += touch;
      bkt.tru += t.size; bkt.keep += tp - qe; bkt.touch += touch;
      const ss = secStat.get(sec) ?? { tp: 0, fp: 0, fn: 0, qe: 0, truth: 0 };
      ss.tp += tp; ss.fp += fp; ss.fn += fn; ss.qe += qe; ss.truth += t.size; secStat.set(sec, ss);
    }
    for (const [sec, lines] of Object.entries(held.sections)) {
      if (!gateEligible(sec, held.spec.drive_type)) continue;
      const p = bump(sec);
      const predLines = pred.draft.filter((l) => l.section === sec);
      const predIds = new Set(predLines.map((l) => l.item_id));
      const got = predLines[0]?.item_name ?? "(none)";
      for (const it of new Set(lines.map((l) => l.item_id))) {
        p.tot++;
        if (predIds.has(it)) p.hit++;
        else p.miss.push({ drive: held.spec.drive_type, cap: held.spec.capacity, want: lines.find((l) => l.item_id === it)!.item_name, got, job: (held as any).job_number } as any);
      }
    }
  }
  const rows = [...per.entries()].map(([sec, v]) => ({ sec, ...v, missN: v.tot - v.hit, rate: v.hit / (v.tot || 1) }));
  rows.sort((a, b) => b.missN - a.missN);
  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(0) + "%" : "n/a");
  const totHit = rows.reduce((a, r) => a + r.hit, 0), totTot = rows.reduce((a, r) => a + r.tot, 0);
  console.log(`pool: ${NOPOOL ? "OFF" : "ON"}   dims: ${NODIMS ? "OFF" : "ON"}   overall item-hit ${pct(totHit, totTot)} (${totHit}/${totTot})`);
  console.log("\nsection                       hit%   miss  (n)   <- sorted by lines lost");
  for (const r of rows) if (r.missN > 0) console.log(`  ${r.sec.padEnd(26)} ${pct(r.hit, r.tot).padStart(4)}  ${String(r.missN).padStart(4)}  (${r.tot})`);
  fs.writeFileSync(path.join(__dirname, "_section_misses.json"), JSON.stringify(Object.fromEntries(rows.map((r) => [r.sec, { rate: r.rate, tot: r.tot, miss: r.miss }])), null, 2));
  console.log("\nwrote scripts/_section_misses.json");

  // ── What a NEW drawing upload looks like ───────────────────────────────────
  console.log(`\n==== NEW-UPLOAD experience (${nJobs} jobs, ${REAL ? "REAL extracted dims" : NODIMS ? "no dims" : "truth-proxy dims"}) ====`);
  console.log(`  avg per job: BOM needs ${(gTrue / nJobs).toFixed(0)} lines, predictor produces ${(gPred / nJobs).toFixed(0)}`);
  console.log(`  FILL (coverage):    ${pct(gTP, gTrue)}  of needed lines pre-filled with the right item`);
  console.log(`  ACCEPT AS-IS:       ${pct(gKeep, gTrue)}  of the BOM auto-fills perfectly (right item + qty)`);
  console.log(`  TOUCH RATE:         ${pct(gTouch, gTrue)}  of BOM lines need a click (slot model: wrong pick = 1 edit)`);
  console.log(`    of which ~${pct(gTP - gKeep, gTouch)} are qty tweaks, ~${pct(gTrue - gTP, gTouch)} are item picks/adds, ~${pct(Math.max(0, gPred - gTrue), gTouch)} are deletes`);
  console.log("\n  worst sections by clicks (qe + max(extra,missing)) per 100 BOM lines:");
  const ss = [...secStat.entries()].map(([s, v]) => ({ s, touch: v.qe + (FORGIVE ? v.fn : Math.max(v.fp, v.fn)), truth: v.truth, fp: v.fp, fn: v.fn, qe: v.qe, rate: (v.qe + (FORGIVE ? v.fn : Math.max(v.fp, v.fn))) / (v.truth || 1) }));
  ss.sort((a, b) => b.touch - a.touch);
  for (const r of ss.slice(0, 18)) console.log(`    ${r.s.padEnd(24)} ${String(r.touch).padStart(3)} clicks /${String(r.truth).padStart(3)} lines = ${(100 * r.rate).toFixed(0).padStart(3)}%  (qty ${r.qe}, wrong/miss ${r.fn}${FORGIVE ? "" : ", extra " + r.fp})`);

  console.log("\n  by DRIVE TYPE (Goods = kg-rated split out):  accept-as-is | touch-rate  (jobs)");
  for (const [d, v] of [...perDrive.entries()].sort((a, b) => b[1].tru - a[1].tru))
    console.log(`    ${d.padEnd(8)} accept ${pct(v.keep, v.tru).padStart(4)}  touch ${pct(v.touch, v.tru).padStart(4)}   (${v.jobs} jobs, ${v.tru} lines)`);
})();
