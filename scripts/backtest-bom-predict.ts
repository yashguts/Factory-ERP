/**
 * Leave-one-out backtest of the SPEC->BOM engine on the REAL job history.
 * Uses the SAME pure core the live action uses (predict-core.ts). No API key.
 * Run:  npx tsx scripts/backtest-bom-predict.ts
 */
import * as fs from "fs";
import * as path from "path";
import {
  predictFromCorpus,
  parseCapacity,
  type TrainingJob,
  type TrainingLine,
} from "../src/lib/bom/predict-core";
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

function flat(x: any) {
  return Array.isArray(x) ? x[0] : x;
}

async function buildCorpus(): Promise<TrainingJob[]> {
  const jobs = await fetchAll("jobs", "id,job_number,floors,drive_type,capacity,door_finish,brand");
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const headers = await fetchAll("job_bom_headers", "id,job_id");
  const jobByHeader = new Map(headers.map((h) => [h.id, h.job_id]));
  const lines = await fetchAll(
    "job_bom_lines",
    "job_bom_id,category,item_id,required_quantity,item:items(code,name,uom:units_of_measurement(abbreviation))",
  );
  const sectionsByJob = new Map<string, Record<string, TrainingLine[]>>();
  for (const ln of lines) {
    if (!ln.item_id) continue;
    const jobId = jobByHeader.get(ln.job_bom_id);
    if (!jobId) continue;
    const item = flat(ln.item);
    const uom = flat(item?.uom);
    const s = sectionsByJob.get(jobId) ?? {};
    (s[ln.category] ??= []).push({
      item_id: ln.item_id,
      item_code: item?.code ?? "",
      item_name: item?.name ?? "",
      uom: uom?.abbreviation ?? "",
      required_quantity: Number(ln.required_quantity) || 0,
    });
    sectionsByJob.set(jobId, s);
  }
  const corpus: TrainingJob[] = [];
  for (const [jobId, sections] of sectionsByJob) {
    const j = jobById.get(jobId);
    if (!j) continue;
    corpus.push({
      id: j.id,
      job_number: j.job_number,
      spec: { floors: j.floors, drive_type: j.drive_type, capacity: j.capacity, door_finish: j.door_finish, brand: j.brand },
      isComplete: Boolean(sections["RAIL"]),
      sections,
    });
  }
  return corpus;
}

// gate-eligible truth sections only (don't penalize the engine for a section the
// gate would never show for this drive type)
function gateEligible(section: string, drive: string | null): boolean {
  const meta = BOM_SECTIONS.find((s) => s.category === section);
  if (!meta) return true; // ad-hoc — count it
  return shouldRenderSection(meta, null, drive);
}

(async () => {
  const corpus = await buildCorpus();
  const evalSet = corpus.filter((j) => j.isComplete);
  console.log(`corpus: ${corpus.length} jobs with BOM | complete (eval): ${evalSet.length}`);

  let tpSec = 0, fpSec = 0, fnSec = 0;
  let itemHits = 0, itemTotal = 0;
  let qtyWithin10 = 0, qtyTotal = 0;
  let keepNum = 0, keepDen = 0;
  let baseItemHits = 0, baseItemTotal = 0;
  const perDrive: Record<string, { jobs: number; hit: number; tot: number; qok: number; qtot: number }> = {};

  // global modal item + median qty per section (for the gate-only baseline)
  const globalItemCount = new Map<string, Map<string, number>>();
  const globalQtys = new Map<string, number[]>();
  for (const j of corpus)
    for (const [sec, lines] of Object.entries(j.sections)) {
      const m = globalItemCount.get(sec) ?? new Map();
      for (const ln of lines) {
        m.set(ln.item_id, (m.get(ln.item_id) ?? 0) + 1);
        (globalQtys.get(sec) ?? globalQtys.set(sec, []).get(sec)!).push(ln.required_quantity);
      }
      globalItemCount.set(sec, m);
    }
  const globalModal = (sec: string) => {
    const m = globalItemCount.get(sec);
    if (!m) return null;
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  for (const held of evalSet) {
    const train = corpus.filter((j) => j.id !== held.id);
    const pred = predictFromCorpus(held.spec, train);
    const drive = held.spec.drive_type ?? "?";
    perDrive[drive] ??= { jobs: 0, hit: 0, tot: 0, qok: 0, qtot: 0 };
    perDrive[drive].jobs++;

    const truthSecs = Object.keys(held.sections).filter((s) => gateEligible(s, held.spec.drive_type));
    const predSecs = [...new Set(pred.draft.map((l) => l.section))];
    const truthSet = new Set(truthSecs);
    const predSet = new Set(predSecs);
    for (const s of predSet) (truthSet.has(s) ? (tpSec++) : (fpSec++));
    for (const s of truthSet) if (!predSet.has(s)) fnSec++;

    for (const s of truthSecs) {
      if (!predSet.has(s)) {
        keepDen += new Set(held.sections[s].map((l) => l.item_id)).size;
        continue;
      }
      const truthItems = new Set(held.sections[s].map((l) => l.item_id));
      const predItems = new Set(pred.draft.filter((l) => l.section === s).map((l) => l.item_id));
      for (const it of truthItems) {
        itemTotal++;
        keepDen++;
        perDrive[drive].tot++;
        if (predItems.has(it)) {
          itemHits++;
          perDrive[drive].hit++;
          const qa = held.sections[s].filter((l) => l.item_id === it).reduce((a, l) => a + l.required_quantity, 0);
          const qp = pred.draft.find((l) => l.section === s && l.item_id === it)!.suggestedQty;
          qtyTotal++;
          perDrive[drive].qtot++;
          if (Math.abs(qp - qa) / Math.max(qa, 1) <= 0.1) {
            qtyWithin10++;
            perDrive[drive].qok++;
            keepNum++; // fully-correct line
          }
        }
      }
      // baseline (gate-only): modal item present?
      const bm = globalModal(s);
      for (const it of truthItems) {
        baseItemTotal++;
        if (bm === it) baseItemHits++;
      }
    }
  }

  const P = tpSec / (tpSec + fpSec || 1);
  const R = tpSec / (tpSec + fnSec || 1);
  const f1 = (2 * P * R) / (P + R || 1);
  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

  console.log("\n================ BACKTEST (leave-one-out, complete jobs) ================");
  console.log(`section presence:  F1 ${f1.toFixed(2)}  (precision ${P.toFixed(2)}, recall ${R.toFixed(2)})`);
  console.log(`item hit rate:     ${pct(itemHits, itemTotal)}   (right item in the right section)`);
  console.log(`qty within 10%:    ${pct(qtyWithin10, qtyTotal)}   (of items we got right)`);
  console.log(`BOM keep-rate:     ${pct(keepNum, keepDen)}   (full lines an engineer could accept as-is)`);
  console.log(`false-section rate:${pct(fpSec, tpSec + fpSec)}   (sections we suggested that the job lacked)`);
  console.log(`\nBASELINE gate-only item hit: ${pct(baseItemHits, baseItemTotal)}  (engine must beat this)`);
  console.log("\nper drive type:");
  for (const [d, s] of Object.entries(perDrive).sort((a, b) => b[1].jobs - a[1].jobs))
    console.log(`  ${d.padEnd(6)} jobs ${String(s.jobs).padStart(3)} | item ${pct(s.hit, s.tot).padStart(6)} | qty10 ${pct(s.qok, s.qtot).padStart(6)}`);
})();
