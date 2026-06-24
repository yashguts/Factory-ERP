/**
 * Per-section leave-one-out eval, focused on the frame-type sections
 * (Safety / Counter Frame / Counter Guard Net / Filler Weight / Machine Beam).
 * Mirrors backtest-bom-predict.ts exactly (no inventory pool) but breaks the
 * item-hit rate out per section so the frame-type change is measurable in
 * isolation. Run:  npx tsx scripts/_safety_eval.ts
 */
import * as fs from "fs";
import * as path from "path";
import { predictFromCorpus, deriveDoorType, type TrainingJob, type TrainingLine } from "../src/lib/bom/predict-core";
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

function gateEligible(section: string, drive: string | null): boolean {
  const meta = BOM_SECTIONS.find((s) => s.category === section);
  if (!meta) return true;
  return shouldRenderSection(meta, null, drive);
}

// Frame-type token of a Safety/Counter SKU name (the four live classes).
function frameToken(name: string): string {
  const u = name.toUpperCase();
  if (/\bGOODS\b/.test(u)) return "GOODS";
  if (/\bHOME\b/.test(u)) return "HOME";
  if (/HYDRAULIC|\bGMV\b/.test(u)) return "HYD";
  if (/\bSTD\b/.test(u)) return "STD";
  if (/\bR1\b/.test(u)) return "R1";
  if (/CANTIL/.test(u)) return "CANTI";
  return "?";
}
// First DBG number in a SKU name, e.g. "...DBG-1242/150mm" -> 1242.
function dbgOf(name: string): number | null {
  const m = /DBG-(\d{3,4})/i.exec(name);
  return m ? Number(m[1]) : null;
}

const PROVIDE_DBG = process.argv.includes("--dbg"); // feed the truth DBG (mimics a drawing read)

(async () => {
  const corpus = await buildCorpus();
  const evalSet = corpus.filter((j) => j.isComplete);
  let hit = 0, tot = 0, ftHit = 0, ftTot = 0;
  const ftMiss: string[] = [];

  for (const held of evalSet) {
    const truth = held.sections["Safety"];
    if (!truth || !gateEligible("Safety", held.spec.drive_type)) continue;
    const train = corpus.filter((j) => j.id !== held.id);
    // Mimic the runtime drawing read: hand the predictor the car DBG so the DBG
    // dimension is solved and only the frame TYPE is in question (the user's case).
    const spec = { ...held.spec } as any;
    if (PROVIDE_DBG) {
      const d = truth.map((l) => dbgOf(l.item_name)).find((x) => x != null);
      if (d != null) spec.dbg_main_mm = d;
    }
    const pred = predictFromCorpus(spec, train);
    const predLines = pred.draft.filter((l) => l.section === "Safety");
    const predIds = new Set(predLines.map((l) => l.item_id));
    const predName = predLines[0]?.item_name ?? "(none)";
    for (const l of truth) {
      tot++;
      if (predIds.has(l.item_id)) hit++;
      // frame-type-only score: did we get the right CLASS (ignoring DBG/size)?
      ftTot++;
      const want = frameToken(l.item_name), got = frameToken(predName);
      if (want === got) ftHit++;
      else ftMiss.push(`${held.spec.drive_type}/${held.spec.capacity}: want ${want} ("${l.item_name}") got ${got} ("${predName}")`);
    }
  }
  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
  console.log(`Safety eval  (DBG provided: ${PROVIDE_DBG})`);
  console.log(`  exact item-hit:  ${pct(hit, tot)}  (${hit}/${tot})`);
  console.log(`  frame-TYPE hit:  ${pct(ftHit, ftTot)}  (${ftHit}/${ftTot})   <- the residual`);
  console.log("\n---- frame-TYPE misses ----");
  for (const m of ftMiss) console.log("  " + m);
})();
