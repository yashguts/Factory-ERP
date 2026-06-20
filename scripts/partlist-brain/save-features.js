// Extract the feature-extraction workflow result into data/features.json
const fs = require("fs");
const path = require("path");
const OUT = process.argv[2];
const raw = JSON.parse(fs.readFileSync(OUT, "utf8"));
const results = (raw.result && raw.result.results) || raw.results || [];
const feats = results.filter((r) => r && r.f).map((r) => ({ sheet: r.sheet, ...r.f }));
fs.writeFileSync(path.join(__dirname, "data", "features.json"), JSON.stringify(feats));
console.log("Saved", feats.length, "feature records.");
// quick coverage of the key fields
const cov = (k) => feats.filter((f) => f[k] != null).length;
for (const k of ["stops", "travelMm", "floorHeightMm", "openingsPerFloor", "shaftWidthMm", "doorOpeningWidthMm", "capacityKg"]) console.log(`  ${k}: ${cov(k)}/${feats.length}`);
