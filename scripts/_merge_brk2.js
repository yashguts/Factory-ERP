// Merge the sharp bracket re-reads (C:/tmp/_brk2_*.json) into drawing-extractions.json:
// car/counter rail-to-wall bracket-arm projection, bracket spacing, and the OPTICAL combination
// flag (-> counterweight_position, which gates the combination-bracket compose). Confidence>=med.
const fs = require("fs"), path = require("path");
const EXT = path.join(__dirname, "partlist-brain/data/drawing-extractions.json");
const ext = JSON.parse(fs.readFileSync(EXT, "utf8"));
const byNum = new Map(ext.map((e) => [String(e.job_number), e]));
let car = 0, ctr = 0, sp = 0, combo = 0, jobs = 0; const missing = [];
const ok = (c) => c !== "low";
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
for (let i = 0; i < 6; i++) {
  const f = `C:/tmp/_brk2_${i}.json`;
  if (!fs.existsSync(f)) { missing.push(i); continue; }
  let arr; try { arr = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.log("bad json", f, e.message); continue; }
  for (const r of arr) {
    const e = byNum.get(String(r.job_number)); if (!e) { console.log("no corpus job for", r.job_number); continue; }
    jobs++;
    const c = num(r.car_rail_to_wall_mm), k = num(r.counter_rail_to_wall_mm), s = num(r.bracket_spacing_mm);
    if (c && ok(r.confidence)) { e.car_rail_to_wall_mm = c; car++; }
    if (k && ok(r.confidence)) { e.counter_rail_to_wall_mm = k; ctr++; }
    if (s && ok(r.confidence)) { e.bracket_spacing_mm = s; sp++; }
    if (r.combination && ok(r.confidence)) { e.counterweight_position = /y/i.test(r.combination) ? "side" : "rear"; combo++; }
  }
}
fs.writeFileSync(EXT, JSON.stringify(ext, null, 1));
console.log(`merged ${jobs} jobs | car ${car} | counter ${ctr} | spacing ${sp} | combo->cwtpos ${combo}` + (missing.length ? ` | MISSING: ${missing.join(",")}` : ""));
