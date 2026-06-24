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
import { predictFromCorpus, deriveDoorType, type TrainingJob, type TrainingLine, type InventoryPool } from "../src/lib/bom/predict-core";
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

  for (const held of evalSet) {
    const train = corpus.filter((j) => j.id !== held.id);
    const spec = { ...held.spec } as any;
    if (!NODIMS) {
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
    for (const [sec, lines] of Object.entries(held.sections)) {
      if (!gateEligible(sec, held.spec.drive_type)) continue;
      const p = bump(sec);
      const predLines = pred.draft.filter((l) => l.section === sec);
      const predIds = new Set(predLines.map((l) => l.item_id));
      const got = predLines[0]?.item_name ?? "(none)";
      for (const it of new Set(lines.map((l) => l.item_id))) {
        p.tot++;
        if (predIds.has(it)) p.hit++;
        else p.miss.push({ drive: held.spec.drive_type, cap: held.spec.capacity, want: lines.find((l) => l.item_id === it)!.item_name, got });
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
})();
