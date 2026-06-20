/**
 * Pair each corpus job with its GA drawing (from the extracted zip), so the
 * vision backtest can read the drawing and we can score it vs the known spec.
 *
 * Run: node scripts/partlist-brain/gen-pairs.js
 * Out: data/pairs.json  [{ sheet, jobCode, drawingPath, truth:{...} }]
 */
const fs = require("fs");
const path = require("path");

const corpus = require(path.join(__dirname, "data", "corpus.json"));
const DRAW_DIR = "C:/Users/yash_/Downloads/_drawings_extracted/PRODUCTION DRAWINGS ";
const OUT = path.join(__dirname, "data", "pairs.json");

function tokens(raw) {
  let s = " " + raw.toUpperCase() + " ";
  s = s.replace(/EDITED_?/g, " ").replace(/\bLTNL\b/g, " ").replace(/\bRE\b/g, " ")
    .replace(/\bV\d+\b/g, " ").replace(/\(\d+\)/g, " ").replace(/_PAGE-?\d+/g, " ")
    .replace(/\bMERGED\b/g, " ").replace(/\bAPPROVED\b/g, " ").replace(/\bREVISED\b/g, " ")
    .replace(/\bREVISION\b/g, " ").replace(/\bGAD\b/g, " ").replace(/\bAPP\b/g, " ")
    .replace(/\bMODEL\b/g, " ").replace(/\bECO\b/g, " ").replace(/\bSHEET\b/g, " ")
    .replace(/&/g, " ");
  const out = new Set(); let m;
  const re1 = /([A-Z]{2,6})[ \-_]*(\d{2,4})/g; // allow spaced dashes ("ANDH - 045") + 2-digit nums
  while ((m = re1.exec(s))) out.add(m[1] + m[2].padStart(4, "0"));
  const re2 = /\b(\d{4,})\b/g;
  while ((m = re2.exec(s))) { const d = m[1]; for (let i = 0; i + 4 <= d.length; i += 4) out.add(d.slice(i, i + 4)); }
  return out;
}

const files = fs.readdirSync(DRAW_DIR).filter((f) => /\.(pdf|jpe?g|png)$/i.test(f));
const drawIndex = new Map();
for (const f of files) for (const t of tokens(f)) { if (!drawIndex.has(t)) drawIndex.set(t, []); drawIndex.get(t).push(f); }

const pairs = [];
for (const rec of corpus) {
  const ts = [...tokens(rec.sheet)];
  let file = null;
  for (const t of ts) { const hit = drawIndex.get(t); if (hit && hit.length === 1) { file = hit[0]; break; } }
  if (!file) for (const t of ts) { const hit = drawIndex.get(t); if (hit) { file = hit.sort((a, b) => a.length - b.length)[0]; break; } } // prefer cleanest name
  if (!file) continue;
  if (!/\.pdf$/i.test(file)) continue; // vision step: PDFs only (skip logo jpgs)
  pairs.push({
    sheet: rec.sheet, jobCode: rec.jobCode,
    drawingPath: path.join(DRAW_DIR, file).replace(/\//g, "\\"),
    truth: { stops: rec.spec.stops, capPass: rec.spec.capPass, capKg: rec.spec.capKg, doorType: rec.spec.doorType, driveType: rec.spec.driveType, home: rec.spec.home, goods: rec.spec.goods, specRaw: rec.specRaw },
  });
}

fs.writeFileSync(OUT, JSON.stringify(pairs, null, 0));
console.log(`Paired ${pairs.length} jobs with a PDF drawing (of ${corpus.length} corpus jobs).`);
console.log(`Sample:`); pairs.slice(0, 6).forEach((p) => console.log(`  ${p.sheet.padEnd(14)} ${p.truth.specRaw.slice(0, 34).padEnd(34)} <- ${path.basename(p.drawingPath)}`));
console.log(`Wrote ${OUT}`);
