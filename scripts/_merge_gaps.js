// Merge the agent-extracted rail-to-wall gaps (/tmp/_bracketgaps_*.json) into
// drawing-extractions.json by job_number. Only writes values the agent gave with
// non-null numbers; leaves existing fields untouched. Run after the agents finish.
const fs = require("fs"), path = require("path");
const EXT = path.join(__dirname, "partlist-brain/data/drawing-extractions.json");
const ext = JSON.parse(fs.readFileSync(EXT, "utf8"));
const byNum = new Map(ext.map((e) => [String(e.job_number), e]));
let merged = 0, car = 0, ctr = 0, missing = [];
const files = ["/tmp/_bracketgaps_0.json", "/tmp/_bracketgaps_1.json", "/tmp/_bracketgaps_2.json", "/tmp/_bracketgaps_3.json", "/tmp/_bracketgaps_4.json", "/tmp/_bracketgaps_5.json", "/tmp/_bracketgaps_manual.json"];
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  if (!fs.existsSync(f)) { missing.push(i); continue; }
  let arr;
  try { arr = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.log("bad json", f, e.message); continue; }
  for (const r of arr) {
    const e = byNum.get(String(r.job_number));
    if (!e) { console.log("no corpus job for", r.job_number); continue; }
    const c = Number(r.car_rail_to_wall_mm), k = Number(r.counter_rail_to_wall_mm);
    if (Number.isFinite(c) && c > 0) { e.car_rail_to_wall_mm = c; car++; }
    if (Number.isFinite(k) && k > 0) { e.counter_rail_to_wall_mm = k; ctr++; }
    merged++;
  }
}
fs.writeFileSync(EXT, JSON.stringify(ext, null, 1));
console.log(`merged ${merged} jobs | car gaps: ${car} | counter gaps: ${ctr}` + (missing.length ? ` | MISSING slices: ${missing.join(",")}` : ""));
