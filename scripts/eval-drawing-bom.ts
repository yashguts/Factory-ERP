/**
 * REALISTIC drawing -> BOM evaluation + error miner — the spec->BOM flywheel tool.
 *
 * For every job that has BOTH a finished BOM and a CACHED drawing read
 * (job_drawing_extractions; handles the rich_v1 and *_backfill shapes), it builds
 * the target spec the engine sees in production — drive/floors/capacity are
 * authoritative from the job (the engineer enters them), while DOOR TYPE and the
 * door OPENING WIDTH come from the drawing — predicts the BOM leave-one-out with
 * the SAME pure core the live action uses, and diffs against the actual BOM.
 *
 * Reports overall item-hit / keep-rate, how accurate the drawing read itself is,
 * a per-section miss breakdown, and writes every missed line to
 * scripts/drawing-bom-errors.csv so the next round of rules can be mined from it.
 * As the team audits more jobs (and more drawings are read with the key), re-run
 * this to find the next systematic error. Read-only, no API key.
 *
 * Run:  npx tsx scripts/eval-drawing-bom.ts        (NOSIZE=1 to ablate size match)
 */
import * as fs from "fs";
import * as path from "path";
import {
  predictFromCorpus, deriveDoorType, normaliseDoorType,
  type TrainingJob, type TrainingLine,
} from "../src/lib/bom/predict-core";
import { BOM_SECTIONS } from "../src/lib/bom/bom-sections";
import { shouldRenderSection } from "../src/lib/bom/section-gating";

const env: Record<string, string> = {};
for (const l of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].trim();
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function all(t: string, s: string): Promise<any[]> {
  const o: any[] = []; let f = 0;
  for (;;) {
    const r = await fetch(`${URL}/rest/v1/${t}?select=${encodeURIComponent(s)}`, { headers: { ...H, "Range-Unit": "items", Range: `${f}-${f + 999}` } });
    const c = await r.json(); if (!Array.isArray(c)) { console.error(c); return o; }
    o.push(...c); if (c.length < 1000) return o; f += 1000;
  }
}
const flat = (x: any) => (Array.isArray(x) ? x[0] : x);
// a cached field may be a SpecField {value} (rich_v1) or a flat scalar (backfill)
const fv = (x: any): any => (x && typeof x === "object" && !Array.isArray(x) && "value" in x ? x.value : x);

interface Drawing { door_type: string | null; openingWidth: number | null; drive_type: string | null; }
// Door-opening width lives under a clean key in the rich_v1 reads but under many
// free-form keys in the agent backfill ("door_opening", "clear_opening", …) with
// messy values ("800 mm (OPENING 800)"). Scan candidates in priority order and
// take the first number in the door-width window (500–1400) — distinct from the
// wall/hoistway numbers that also appear in the same string.
const OW_KEYS = [
  "door_opening_width_mm", "door_opening_width", "door_opening_mm", "door_opening_clear",
  "door_opening", "clear_opening", "opening_clear_mm", "opening_mm", "opening",
  "clear_entrance", "car_and_landing_door_opening", "car_door_opening", "hall_door_opening",
];
function openingWidthFromDims(dims: any): number | null {
  if (!dims || typeof dims !== "object") return null;
  for (const k of OW_KEYS) {
    if (!(k in dims)) continue;
    const raw = fv(dims[k]);
    if (raw == null) continue;
    for (const m of String(raw).matchAll(/\d{3,4}/g)) {
      const v = Number(m[0]);
      if (v >= 500 && v <= 1400) return v;
    }
  }
  return null;
}
function drawingOf(ext: any): Drawing {
  const r = ext.extracted ?? {}, sp = ext.spec ?? {};
  return {
    door_type: normaliseDoorType(fv(r.door_type) ?? fv(sp.door_type) ?? null),
    openingWidth: openingWidthFromDims(r.dimensions),
    drive_type: (fv(r.drive_type) ?? fv(sp.drive_type) ?? null) || null,
  };
}

async function build() {
  const jobs = await all("jobs", "id,job_number,floors,drive_type,capacity,door_finish,brand");
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const headers = await all("job_bom_headers", "id,job_id");
  const jobByHeader = new Map(headers.map((h) => [h.id, h.job_id]));
  const lines = await all("job_bom_lines", "job_bom_id,category,item_id,required_quantity,item:items(code,name,uom:units_of_measurement(abbreviation))");
  const sByJob = new Map<string, Record<string, TrainingLine[]>>();
  for (const ln of lines) {
    if (!ln.item_id) continue; const jobId = jobByHeader.get(ln.job_bom_id); if (!jobId) continue;
    const item = flat(ln.item); const uom = flat(item?.uom);
    const s = sByJob.get(jobId) ?? {};
    (s[ln.category] ??= []).push({ item_id: ln.item_id, item_code: item?.code ?? "", item_name: item?.name ?? "", uom: uom?.abbreviation ?? "", required_quantity: Number(ln.required_quantity) || 0 });
    sByJob.set(jobId, s);
  }
  const corpus: TrainingJob[] = [];
  for (const [jobId, sections] of sByJob) {
    const j = jobById.get(jobId); if (!j) continue;
    corpus.push({ id: j.id, job_number: j.job_number, spec: { floors: j.floors, drive_type: j.drive_type, capacity: j.capacity, door_finish: j.door_finish, brand: j.brand, door_type: deriveDoorType(sections) }, isComplete: Boolean(sections["RAIL"]), sections });
  }
  const ext = await all("job_drawing_extractions", "job_id,spec,extracted,extracted_at");
  const drawByJob = new Map<string, Drawing>();
  for (const e of ext.sort((a, b) => String(a.extracted_at).localeCompare(String(b.extracted_at)))) drawByJob.set(e.job_id, drawingOf(e)); // last read wins
  return { corpus, drawByJob };
}

const gateOk = (section: string, drive: string | null) => {
  const meta = BOM_SECTIONS.find((s) => s.category === section);
  return meta ? shouldRenderSection(meta, null, drive) : true;
};

(async () => {
  const { corpus, drawByJob } = await build();
  const noSize = process.env.NOSIZE === "1";
  const evalSet = corpus.filter((j) => j.isComplete && drawByJob.has(j.id));
  const withW = evalSet.filter((j) => drawByJob.get(j.id)!.openingWidth != null).length;
  console.log(`corpus ${corpus.length} | complete + cached drawing: ${evalSet.length} | with opening width: ${withW}${noSize ? "  [SIZE OFF]" : ""}\n`);

  let itemHit = 0, itemTot = 0, keepNum = 0, keepDen = 0, tpSec = 0, fpSec = 0, doorRight = 0, doorTot = 0;
  const bySection = new Map<string, { hit: number; tot: number; pres: number; item: number }>();
  const sget = (k: string) => { let a = bySection.get(k); if (!a) { a = { hit: 0, tot: 0, pres: 0, item: 0 }; bySection.set(k, a); } return a; };
  const errRows: string[] = ["job,section,kind,truth_item,pred_item,truth_qty,drive,door_drawing,door_actual,openingW"];

  for (const held of evalSet) {
    const d = drawByJob.get(held.id)!;
    const doorActual = deriveDoorType(held.sections);
    if (d.door_type && doorActual) { doorTot++; if (d.door_type === doorActual) doorRight++; }
    const target = {
      floors: held.spec.floors, drive_type: held.spec.drive_type, capacity: held.spec.capacity,
      door_finish: held.spec.door_finish, brand: held.spec.brand,
      door_type: d.door_type, door_opening_width: noSize ? null : d.openingWidth,
    };
    const pred = predictFromCorpus(target, corpus.filter((j) => j.id !== held.id));
    const predBySec = new Map<string, Set<string>>();
    const predFirst = new Map<string, string>();
    for (const l of pred.draft) { (predBySec.get(l.section) ?? predBySec.set(l.section, new Set()).get(l.section)!).add(l.item_id); if (!predFirst.has(l.section)) predFirst.set(l.section, l.item_name); }
    const truthSecs = Object.keys(held.sections).filter((s) => gateOk(s, held.spec.drive_type));
    const predSet = new Set(pred.draft.map((l) => l.section));
    for (const s of predSet) (new Set(truthSecs).has(s) ? tpSec++ : fpSec++);
    for (const s of truthSecs) {
      const a = sget(s); const pe = predBySec.get(s);
      for (const it of new Set(held.sections[s].map((l) => l.item_id))) {
        itemTot++; keepDen++; a.tot++;
        const ln = held.sections[s].find((l) => l.item_id === it)!;
        const tq = held.sections[s].filter((l) => l.item_id === it).reduce((x, y) => x + y.required_quantity, 0);
        if (pe?.has(it)) {
          itemHit++; a.hit++;
          const qp = pred.draft.find((l) => l.section === s && l.item_id === it)!.suggestedQty;
          if (Math.abs(qp - tq) / Math.max(tq, 1) <= 0.1) keepNum++;
        } else {
          if (!pe) a.pres++; else a.item++;
          errRows.push(`${held.job_number},${s},${pe ? "item" : "presence"},"${ln.item_name}","${pe ? predFirst.get(s) ?? "" : ""}",${tq},${held.spec.drive_type},${d.door_type ?? ""},${doorActual ?? ""},${d.openingWidth ?? ""}`);
        }
      }
    }
  }
  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
  console.log("=== drawing -> BOM (door type + opening width FROM the cached drawing) ===");
  console.log(`item hit:       ${pct(itemHit, itemTot)}`);
  console.log(`keep-rate:      ${pct(keepNum, keepDen)}`);
  console.log(`false-section:  ${pct(fpSec, tpSec + fpSec)}`);
  console.log(`drawing door-type read accuracy: ${pct(doorRight, doorTot)}\n`);
  console.log("=== per-section misses (worst first; pres = section dropped, item = wrong SKU) ===");
  const rows = [...bySection.entries()].map(([s, a]) => ({ s, a, lost: a.pres + a.item })).filter((r) => r.a.tot >= 4).sort((x, y) => y.lost - x.lost);
  console.log("section".padEnd(26) + "tot".padStart(5) + "hit%".padStart(7) + "pres".padStart(6) + "item".padStart(6));
  for (const { s, a } of rows.slice(0, 16)) console.log(s.slice(0, 25).padEnd(26) + String(a.tot).padStart(5) + pct(a.hit, a.tot).padStart(7) + String(a.pres).padStart(6) + String(a.item).padStart(6));
  fs.writeFileSync(path.join(__dirname, "drawing-bom-errors.csv"), errRows.join("\n"));
  console.log(`\nwrote ${errRows.length - 1} miss rows -> scripts/drawing-bom-errors.csv`);
})();
