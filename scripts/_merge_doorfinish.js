// Merge the re-extracted DOOR fields (C:/tmp/_doorfinish_*.json) into drawing-extractions.json
// by job_number: car door_finish (with designer colour), landing_door_finish, door_vision,
// door_side. Only overwrites with non-null, confidence>=med reads. Run after the agents finish.
const fs = require("fs"), path = require("path");
const EXT = path.join(__dirname, "partlist-brain/data/drawing-extractions.json");
const ext = JSON.parse(fs.readFileSync(EXT, "utf8"));
const byNum = new Map(ext.map((e) => [String(e.job_number), e]));
let fin = 0, land = 0, vis = 0, side = 0, jobs = 0; const missing = [];
const ok = (c) => c !== "low";
for (let i = 0; i < 6; i++) {
  const f = `C:/tmp/_doorfinish_${i}.json`;
  if (!fs.existsSync(f)) { missing.push(i); continue; }
  let arr; try { arr = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.log("bad json", f, e.message); continue; }
  for (const r of arr) {
    const e = byNum.get(String(r.job_number)); if (!e) { console.log("no corpus job for", r.job_number); continue; }
    jobs++;
    if (r.car_door_finish && ok(r.confidence)) { e.door_finish = r.car_door_finish; fin++; }
    if (r.landing_door_finish && ok(r.confidence)) { e.landing_door_finish = r.landing_door_finish; land++; }
    if (r.door_vision && ok(r.confidence)) { e.door_vision = r.door_vision; vis++; }
    if (r.door_side && ok(r.confidence)) { e.door_side = r.door_side; side++; }
  }
}
fs.writeFileSync(EXT, JSON.stringify(ext, null, 1));
console.log(`merged ${jobs} jobs | finish ${fin} | landing ${land} | vision ${vis} | side ${side}` + (missing.length ? ` | MISSING slices: ${missing.join(",")}` : ""));
