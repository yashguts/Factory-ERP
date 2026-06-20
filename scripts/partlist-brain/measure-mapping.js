/**
 * Diagnostic — non-BOM inventory mapping rate, per job (mirrors the live engine).
 *
 * Answers the owner's two questions:
 *   (1) AUDIT  — which item-particulars have NO inventory candidates at all (a
 *       missing/broken category mapping we should fix)?
 *   (2) RATE   — of the part-list lines that DON'T come from the BOM, how many do
 *       we auto-link to a real inventory item, on average per job?
 *
 * It re-implements (faithfully, from src/lib/partlist + src/lib/actions/partlist-
 * generate.ts) the rules-only predictor + BOM→section map + the inventory resolver,
 * then runs them over the LIVE jobs (job spec + cached drawing read + BOM).
 *
 * Read-only. Run: node scripts/partlist-brain/measure-mapping.js [--diag]
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const R = (p) => require(path.join(__dirname, "..", "..", "src", "lib", "partlist", p));
const TEMPLATES = R("templates.json");
const SIZING = R("sizing-bands.json");
const QMODELS = R("quantity-models.json");
const TMODELS = R("travel-models.json");
const OVERRIDES = R("partlist-overrides.json");
const SECTIONS = require(path.join(__dirname, "..", "_packing_sections.json"));
const SECTION = new Map(SECTIONS.map((s) => [s.key, s]));

const NON_INVENTORY = new Set(Object.entries(OVERRIDES).filter(([, o]) => o.nonInventory).map(([k]) => k));
const OTHER_SECTION_KEY = "other";

/* ---------- env / db ---------- */
function loadEnv() {
  const txt = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim(); }
  return env;
}
async function fetchAll(supabase, table, cols, filter) {
  const PAGE = 1000; let off = 0; const rows = [];
  for (;;) {
    let q = supabase.from(table).select(cols).range(off, off + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
    off += PAGE;
  }
  return rows;
}

/* ---------- predict.ts (rules-only) — ported verbatim ---------- */
const KG_PER_PASS = 68;
const toKg = (s) => (s.capKg ? s.capKg : s.capPass ? s.capPass * KG_PER_PASS : null);
const doorFam = (d) => {
  const u = (d || "").toUpperCase();
  if (/COLLAPS/.test(u)) return "collapsible";
  if (/SWING|SWS/.test(u)) return "swing";
  if (/DUMB/.test(u)) return "dumb";
  if (/\bMT\b|MANUAL|TELESCOPIC/.test(u) && !/AUTO/.test(u)) return "manual";
  if (/ACO|AT|AFF|CO|AUTO/.test(u)) return "auto";
  return u ? "other" : "?";
};
const SECTION_CANON = new Map();
for (const [canon, m] of Object.entries(QMODELS)) for (const sk of m.sectionKeys ?? []) if (!SECTION_CANON.has(sk)) SECTION_CANON.set(sk, canon);
const CORE_KEYS = (() => {
  const count = new Map(); const tmpl = Object.values(TEMPLATES);
  for (const t of tmpl) for (const k of t.sectionKeys) count.set(k, (count.get(k) ?? 0) + 1);
  const need = Math.ceil(tmpl.length * 0.7);
  return new Set([...count.entries()].filter(([, n]) => n >= need).map(([k]) => k));
})();
function pickSkeleton(target) {
  let best = null;
  for (const [name, t] of Object.entries(TEMPLATES)) {
    let s = 0;
    if (target.home && t.home) s += 6;
    if (!target.home) { if (doorFam(t.door) === doorFam(target.doorType)) s += 4; }
    if (target.goods && t.goods) s += 3;
    if (target.driveType && t.drive && target.driveType.toUpperCase() === t.drive.toUpperCase()) s += 2;
    if (target.v3f && t.drive === "V3F") s += 1;
    if (!best || s > best.score) best = { name, score: s };
  }
  const matchedDoor = !!best && best.score >= 4;
  const keys = new Set(CORE_KEYS);
  if (matchedDoor && best) for (const k of TEMPLATES[best.name].sectionKeys) keys.add(k);
  return { keys, matchedDoor };
}
function bandOf(target) {
  const kg = toKg(target);
  if (target.goods) { if (kg == null) return "GoodsMR2-2.5"; if (kg < 1500) return "GoodsMR<1.5"; if (kg <= 2500) return "GoodsMR2-2.5"; return "GoodsMR3"; }
  const pass = target.capPass ?? (kg != null ? Math.round(kg / KG_PER_PASS) : null);
  if (pass == null) return "13-16P";
  if (pass <= 10) return "4-10P";
  if (pass <= 16) return "13-16P";
  if ((kg ?? 0) >= 4000) return "4Ton";
  return ">1Ton";
}
function ruleSpec(sectionKey, canon, target) {
  if (target.doorWidthMm && /sill|header|linton|lintone|door-post/.test(sectionKey)) return `${target.doorWidthMm}mm`;
  const bm = canon ? SIZING[canon]?.[bandOf(target)] : null;
  if (bm) return bm;
  return SECTION.get(sectionKey)?.specHint || null;
}

/* ---------- generate.ts target building — ported ---------- */
const num = (s) => { const m = String(s ?? "").replace(/[, ]/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
function parseCapacity(c) { const s = (c || "").toUpperCase(); const p = s.match(/(\d+)\s*PASS/), k = s.match(/(\d+)\s*KG/); return { capPass: p ? +p[1] : null, capKg: k ? +k[1] : null }; }
function mapDoorErp(d) { if (!d) return null; const M = { COL: "COLLAPSIBLE", MT: "MT", CO: "CO", AT: "AT", AFF: "AFF", BYPART: "CO", SWS: "SWING", DUMB: "DUMB" }; return M[d.toUpperCase()] || d.toUpperCase(); }
function mapDoorDrawing(s) {
  const l = (s || "").toLowerCase(); if (!l) return null;
  if (/collaps/.test(l)) return "COLLAPSIBLE";
  if (/swing/.test(l)) return "SWING";
  if (/four|aff/.test(l)) return "AFF";
  if (/manual|\bmt\b/.test(l)) return "MT";
  if (/\bat\b|auto.*telesc|telescop/.test(l)) return "AT";
  if (/centre|center|\bco\b|auto/.test(l)) return "CO";
  return null;
}
function buildTarget(job, ext) {
  const cap = parseCapacity(job.capacity);
  const drive = (job.drive_type || "").toUpperCase() || null;
  const target = {
    stops: job.floors ?? null, capPass: cap.capPass, capKg: cap.capKg,
    doorType: mapDoorErp(job.door_type), driveType: drive, home: drive === "HOME",
    goods: (cap.capKg ?? 0) >= 2000, v3f: drive === "V3F" || drive === "MV3F",
    travelMm: null, doorWidthMm: null,
  };
  if (ext) {
    const d = ext;
    const travel = num(d?.dimensions?.travel_mm?.value); if (travel) target.travelMm = travel;
    const dDoor = mapDoorDrawing(d?.door_type?.value ?? null); if (dDoor) target.doorType = dDoor;
    if (target.capPass == null && target.capKg == null) { const c2 = parseCapacity(d?.capacity?.value ?? null); target.capPass = c2.capPass; target.capKg = c2.capKg; }
    if (target.stops == null && d?.floors?.value != null) target.stops = d.floors.value;
    const dw = num(d?.dimensions?.door_opening_width_mm?.value); if (dw) target.doorWidthMm = dw;
  }
  return target;
}

/* ---------- helpers.ts buildCategorySectionMap — ported ---------- */
function buildCategorySectionMap(cats) {
  const byParent = new Map();
  for (const c of cats) { const a = byParent.get(c.parent_id) ?? []; a.push(c); byParent.set(c.parent_id, a); }
  const resolvePath = (p) => {
    const segs = p.split(">").map((s) => s.trim()).filter(Boolean);
    let parentId = null, matched = null;
    for (const seg of segs) { const sibs = byParent.get(parentId) ?? []; const f = sibs.find((c) => c.name.toLowerCase() === seg.toLowerCase()); if (!f) return null; matched = f; parentId = f.id; }
    return matched?.id ?? null;
  };
  const descendants = (rootId) => { const out = [rootId], st = [rootId]; while (st.length) { const id = st.pop(); for (const ch of byParent.get(id) ?? []) { out.push(ch.id); st.push(ch.id); } } return out; };
  const map = new Map(), bestDepth = new Map();
  for (const sec of SECTIONS) for (const p of sec.categoryPaths) {
    const rootId = resolvePath(p); if (!rootId) continue;
    const depth = p.split(">").filter((s) => s.trim()).length;
    for (const id of descendants(rootId)) { const prev = bestDepth.get(id); if (prev === undefined || depth > prev) { map.set(id, sec.key); bestDepth.set(id, depth); } }
  }
  return map;
}

/* ---------- resolver (resolve.ts / resolve-inventory.js) — ported ---------- */
const STOP = new Set(["the", "for", "with", "and", "type", "nos", "no", "set", "pcs", "pc", "size", "of", "as", "per", "mm", "kg", "qty", "each", "new", "old", "sr"]);
const SHAPE = new Set(["l", "u", "c", "z", "t", "i", "h"]);
function tokenize(s) {
  const all = new Set(), sizes = new Set();
  for (let t of String(s || "").toLowerCase().replace(/[(),"']/g, " ").split(/[\s/]+/)) {
    t = t.replace(/[^a-z0-9.x+-]/g, ""); if (!t || STOP.has(t)) continue; if (t.length < 2 && !SHAPE.has(t)) continue;
    if (/[0-9]/.test(t)) { const sz = t.replace(/mm$/, ""); if (sz.length >= 2) t = sz; }
    else if (t === "rhs") t = "rh"; else if (t === "lhs") t = "lh";
    all.add(t); if (/[0-9]/.test(t)) sizes.add(t);
  }
  return { all, sizes };
}
function buildResolver(items, cats) {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const pathOf = (c) => { const p = []; let cur = c, g = 0; while (cur && g++ < 12) { p.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : null; } return p.join(" > "); };
  const idByPath = new Map(cats.map((c) => [pathOf(c), c.id]));
  const childrenOf = new Map();
  for (const c of cats) { if (!childrenOf.has(c.parent_id)) childrenOf.set(c.parent_id, []); childrenOf.get(c.parent_id).push(c.id); }
  const descendants = (roots) => { const out = new Set(), q = [...roots]; while (q.length) { const id = q.shift(); if (out.has(id)) continue; out.add(id); for (const ch of childrenOf.get(id) || []) q.push(ch); } return out; };
  const cabinRoot = cats.find((c) => c.name === "Cabin" && !c.parent_id);
  const cabinIds = cabinRoot ? descendants([cabinRoot.id]) : new Set();

  const CATEGORY_OVERRIDE = { "p-dade-weight-rod-ms": ["Header Systems > Dead Weight25x25"], "p-car-header-hanging-bkt": ["Header Systems > HEADER"] };
  for (const [sk, o] of Object.entries(OVERRIDES)) if (o.categoryPath) CATEGORY_OVERRIDE[sk] ??= [o.categoryPath];

  const itemsByCat = new Map(); const globalItems = [];
  for (const raw of items) { const it = { ...raw, tok: tokenize(raw.name) }; if (it.category_id) { if (!itemsByCat.has(it.category_id)) itemsByCat.set(it.category_id, []); itemsByCat.get(it.category_id).push(it); } if (!it.category_id || !cabinIds.has(it.category_id)) globalItems.push(it); }

  const candCache = new Map(), sizedCache = new Map();
  function candidates(sectionKey) {
    const key = sectionKey || "(none)"; if (candCache.has(key)) return candCache.get(key);
    const sec = sectionKey ? SECTION.get(sectionKey) : undefined;
    const paths = CATEGORY_OVERRIDE[key] || (sec ? sec.categoryPaths : []);
    let list;
    if (paths && paths.length) { const roots = paths.map((p) => idByPath.get(p)).filter(Boolean); const all = descendants(roots); const seen = new Set(); list = []; for (const cid of all) for (const it of itemsByCat.get(cid) || []) if (!seen.has(it.id)) { seen.add(it.id); list.push(it); } }
    else list = globalItems;
    candCache.set(key, list); return list;
  }
  function sizedFrac(cands, key) { if (sizedCache.has(key)) return sizedCache.get(key); const f = cands.length ? cands.filter((it) => it.tok.sizes.size > 0).length / cands.length : 0; sizedCache.set(key, f); return f; }
  function resolve(label, sectionKey, spec) {
    const key = sectionKey || "(none)"; const cands = candidates(sectionKey);
    if (!cands.length) return { item: null, reason: "no-category" };
    const q = tokenize(`${label} ${spec || ""}`);
    if (!q.all.size) return cands.length === 1 ? { item: cands[0], reason: "sole-candidate" } : { item: null, reason: "no-spec" };
    const sizeArr = [...q.sizes], allArr = [...q.all]; const sized = sizedFrac(cands, key) >= 0.5;
    let pool = cands, enforced = false;
    if (sizeArr.length && sized) {
      const subset = cands.filter((it) => it.tok.sizes.size > 0 && [...it.tok.sizes].every((t) => q.sizes.has(t)));
      if (subset.length) { pool = subset; enforced = true; }
      else { const exact = cands.filter((it) => sizeArr.every((t) => it.tok.all.has(t))); if (exact.length) { pool = exact; enforced = true; } else return { item: null, reason: "no-match" }; }
    }
    let best = null;
    for (const it of pool) {
      const allHit = allArr.filter((t) => it.tok.all.has(t)).length; const cov = allHit / allArr.length;
      const sizeSpecificity = [...it.tok.sizes].filter((t) => q.sizes.has(t)).length; const extra = [...it.tok.sizes].filter((t) => !q.sizes.has(t)).length;
      const score = sizeSpecificity * 1.0 + cov * 0.5 - 0.05 * extra;
      if (!best || score > best.score) best = { it, score, cov };
    }
    if (!best) return { item: null, reason: "no-match" };
    if (enforced || best.cov >= 0.45) return { item: best.it, reason: "matched", cov: +best.cov.toFixed(2) };
    return { item: null, reason: "no-match" };
  }
  return { resolve, candidates, sizedFrac };
}

/* ---------- main ---------- */
async function main() {
  const diag = process.argv.includes("--diag");
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const cats = await fetchAll(supabase, "item_categories", "id,name,parent_id");
  const items = await fetchAll(supabase, "items", "id,code,name,category_id", (q) => q.eq("is_active", true));
  const jobs = await fetchAll(supabase, "jobs", "id,job_number,floors,drive_type,capacity,door_type,gad_drawing_url");
  const exts = await fetchAll(supabase, "job_drawing_extractions", "job_id,extracted,extracted_at");
  const headers = await fetchAll(supabase, "job_bom_headers", "id,job_id");
  const bomLines = await fetchAll(supabase, "job_bom_lines", "job_bom_id,item_id,required_quantity");

  const resolver = buildResolver(items, cats);
  const catToSection = buildCategorySectionMap(cats);
  const itemById = new Map(items.map((i) => [i.id, i]));

  // latest extraction per job
  const extByJob = new Map();
  for (const e of exts.sort((a, b) => String(a.extracted_at).localeCompare(String(b.extracted_at)))) extByJob.set(e.job_id, e.extracted);
  // bom item category_ids per job (which sections the BOM covers)
  const headerJob = new Map(headers.map((h) => [h.id, h.job_id]));
  const bomSectionsByJob = new Map();
  const bomCountByJob = new Map();
  for (const l of bomLines) {
    const jobId = headerJob.get(l.job_bom_id); if (!jobId) continue;
    bomCountByJob.set(jobId, (bomCountByJob.get(jobId) || 0) + 1);
    const it = l.item_id ? itemById.get(l.item_id) : null;
    const sk = it?.category_id ? catToSection.get(it.category_id) : undefined;
    if (sk && sk !== OTHER_SECTION_KEY) { if (!bomSectionsByJob.has(jobId)) bomSectionsByJob.set(jobId, new Set()); bomSectionsByJob.get(jobId).add(sk); }
  }

  /* ---- AUDIT: item-particulars with zero inventory candidates ---- */
  const zeroCand = [], unscoped = [];
  for (const s of SECTIONS) {
    if (s.captureType !== "item" || NON_INVENTORY.has(s.key)) continue;
    const cands = resolver.candidates(s.key);
    const hasPath = !!(s.categoryPaths && s.categoryPaths.length) || !!OVERRIDES[s.key]?.categoryPath || ["p-dade-weight-rod-ms", "p-car-header-hanging-bkt"].includes(s.key);
    if (!cands.length) zeroCand.push({ key: s.key, label: s.label, path: (s.categoryPaths || [])[0] || OVERRIDES[s.key]?.categoryPath || "(none)" });
    else if (!hasPath) unscoped.push({ key: s.key, label: s.label, cands: cands.length });
  }

  /* ---- RATE: per-job non-BOM item-line resolution ---- */
  const perJob = [];
  const perSection = new Map(); // sk -> {label, total, resolved}
  for (const job of jobs) {
    const ext = extByJob.get(job.id);
    const target = buildTarget(job, ext);
    const { keys } = pickSkeleton(target);
    const bomSecs = bomSectionsByJob.get(job.id) || new Set();
    let itemLines = 0, resolved = 0, freeLines = 0, nonStock = 0;
    for (const sk of keys) {
      const sec = SECTION.get(sk); if (!sec) continue;
      if (bomSecs.has(sk)) continue;            // covered by BOM → not a "non-BOM" line
      if (sec.captureType === "free") { freeLines++; continue; }
      if (NON_INVENTORY.has(sk)) { nonStock++; continue; }
      itemLines++;
      const canon = SECTION_CANON.get(sk) ?? null;
      const spec = ruleSpec(sk, canon, target);
      const r = resolver.resolve(sec.label, sk, spec);
      const ps = perSection.get(sk) || { label: sec.label, total: 0, resolved: 0, specs: new Map(), reasons: new Map() }; ps.total++;
      ps.specs.set(spec || "(blank)", (ps.specs.get(spec || "(blank)") || 0) + 1);
      if (r.item) { resolved++; ps.resolved++; } else ps.reasons.set(r.reason, (ps.reasons.get(r.reason) || 0) + 1);
      perSection.set(sk, ps);
    }
    perJob.push({ job: job.job_number, hasExt: !!ext, bomLines: bomCountByJob.get(job.id) || 0, itemLines, resolved, freeLines, nonStock, rate: itemLines ? resolved / itemLines : null });
  }

  const withLines = perJob.filter((j) => j.itemLines > 0);
  const sum = (a, f) => a.reduce((x, j) => x + f(j), 0);
  const avg = (a, f) => (a.length ? sum(a, f) / a.length : 0);
  const totalItem = sum(perJob, (j) => j.itemLines), totalRes = sum(perJob, (j) => j.resolved);
  const pct = (a, b) => (100 * a / (b || 1)).toFixed(1) + "%";

  console.log(`\n=== NON-BOM INVENTORY MAPPING — per job (${jobs.length} jobs, ${jobs.filter(j=>extByJob.has(j.id)).length} with drawing read) ===\n`);
  console.log(`Avg non-BOM ITEM lines / job        : ${avg(perJob, (j) => j.itemLines).toFixed(1)}`);
  console.log(`Avg of those auto-mapped to SKU/job : ${avg(perJob, (j) => j.resolved).toFixed(1)}`);
  console.log(`Overall non-BOM item-line map rate  : ${pct(totalRes, totalItem)}  (${totalRes}/${totalItem})`);
  console.log(`Avg per-job map rate (jobs w/ lines): ${pct(sum(withLines, (j) => j.rate), withLines.length)}`);
  console.log(`Avg non-BOM free-text lines / job   : ${avg(perJob, (j) => j.freeLines).toFixed(1)}  (fasteners etc., not SKU-mapped)`);
  console.log(`Avg non-BOM non-stock lines / job   : ${avg(perJob, (j) => j.nonStock).toFixed(1)}  (legit non-inventory)`);

  // rate distribution
  const buckets = { "0-25%": 0, "25-50%": 0, "50-75%": 0, "75-100%": 0 };
  for (const j of withLines) { const r = j.rate; buckets[r < 0.25 ? "0-25%" : r < 0.5 ? "25-50%" : r < 0.75 ? "50-75%" : "75-100%"]++; }
  console.log(`\nPer-job map-rate distribution (${withLines.length} jobs w/ non-BOM item lines):`);
  for (const [b, n] of Object.entries(buckets)) console.log(`  ${b.padEnd(8)} ${String(n).padStart(3)} jobs  ${"█".repeat(Math.round(n / Math.max(1, withLines.length) * 40))}`);

  console.log(`\n=== AUDIT (ask 3): item-particulars we CANNOT map ===`);
  console.log(`\nZERO inventory candidates (category path empty/wrong → fix the mapping): ${zeroCand.length}`);
  for (const z of zeroCand.slice(0, 40)) console.log(`  ▢ ${z.label.slice(0, 42).padEnd(42)} [${z.key}]  path=${z.path}`);
  if (zeroCand.length > 40) console.log(`  …and ${zeroCand.length - 40} more`);

  console.log(`\nUNSCOPED (no category path → searches ALL inventory, low precision): ${unscoped.length}`);
  for (const u of unscoped.slice(0, 20)) console.log(`  ▢ ${u.label.slice(0, 50).padEnd(50)} [${u.key}]`);
  if (unscoped.length > 20) console.log(`  …and ${unscoped.length - 20} more`);

  // weakest sections that actually appear in real job skeletons
  const weak = [...perSection.entries()].filter(([, v]) => v.total >= 10 && v.resolved / v.total < 0.6).sort((a, b) => (b[1].total - b[1].resolved) - (a[1].total - a[1].resolved));
  console.log(`\nWEAK in practice (appears >=10 job-skeletons, <60% mapped):`);
  for (const [sk, v] of weak.slice(0, 22)) {
    const cands = resolver.candidates(sk);
    const topSpec = [...v.specs.entries()].sort((a, b) => b[1] - a[1])[0];
    const reasons = [...v.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}×${n}`).join(",");
    console.log(`  ${pct(v.resolved, v.total).padStart(6)}  ${String(v.resolved).padStart(3)}/${String(v.total).padStart(3)}  ${v.label.slice(0, 38).padEnd(38)} [${String(cands.length).padStart(5)} cands]  spec="${(topSpec?.[0]||"").slice(0,18)}"  ${reasons}`);
    if (process.argv.includes("--why")) console.log(`        cands: ${cands.slice(0, 6).map((c) => c.name).join(" | ").slice(0, 130)}`);
  }

  // ---- JOB-WISE table + CSV (owner ask: per job, non-BOM lines created vs linked) ----
  const sorted = [...perJob].sort((a, b) => String(a.job).localeCompare(String(b.job), undefined, { numeric: true }));
  const csv = ["job,bom_lines_all_included,nonbom_item_lines,nonbom_linked_to_inventory,link_pct,free_text_lines,non_stock_lines,drawing_read"];
  for (const j of sorted) csv.push([j.job, j.bomLines, j.itemLines, j.resolved, j.rate == null ? "" : (100 * j.rate).toFixed(0), j.freeLines, j.nonStock, j.hasExt ? "yes" : "no"].join(","));
  const csvPath = path.join(__dirname, "data", "per-job-mapping.csv");
  fs.writeFileSync(csvPath, csv.join("\n"));

  if (process.argv.includes("--jobs")) {
    console.log(`\n=== JOB-WISE — non-BOM lines created vs auto-linked (all ${sorted.length} jobs) ===`);
    console.log(`  ${"JOB".padEnd(14)} ${"BOM".padStart(4)} ${"nonBOM".padStart(7)} ${"linked".padStart(7)} ${"link%".padStart(6)} ${"free".padStart(5)} ${"n/stk".padStart(6)}`);
    for (const j of sorted) console.log(`  ${String(j.job).slice(0, 14).padEnd(14)} ${String(j.bomLines).padStart(4)} ${String(j.itemLines).padStart(7)} ${String(j.resolved).padStart(7)} ${(j.rate == null ? "-" : (100 * j.rate).toFixed(0) + "%").padStart(6)} ${String(j.freeLines).padStart(5)} ${String(j.nonStock).padStart(6)}`);
  }
  console.log(`\nWrote per-job CSV → scripts/partlist-brain/data/per-job-mapping.csv (${sorted.length} jobs)`);

  fs.writeFileSync(path.join(__dirname, "data", "mapping-measure.json"), JSON.stringify({
    jobs: jobs.length, overallRate: totalRes / (totalItem || 1), avgItemLines: avg(perJob, (j) => j.itemLines), avgResolved: avg(perJob, (j) => j.resolved),
    zeroCand, unscoped: unscoped.length, perJob: diag ? perJob : undefined,
  }, null, 0));
  console.log(`\nWrote scripts/partlist-brain/data/mapping-measure.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
