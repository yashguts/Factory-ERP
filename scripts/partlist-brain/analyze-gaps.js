/**
 * Diagnostic: (1) which part-list sheets have NO drawing (bridge candidates) and
 * which drawings are unmatched (to read internal codes); (2) a categorized
 * breakdown of WHY inventory item lines don't resolve.
 */
const fs = require("fs");
const path = require("path");
const corpus = require(path.join(__dirname, "data", "corpus.json"));
const DRAW_DIR = "C:/Users/yash_/Downloads/_drawings_extracted/PRODUCTION DRAWINGS ";

function tokens(raw) {
  let s = " " + raw.toUpperCase() + " ";
  s = s.replace(/EDITED_?/g, " ").replace(/\bLTNL\b/g, " ").replace(/\bRE\b/g, " ")
    .replace(/\bV\d+\b/g, " ").replace(/\(\d+\)/g, " ").replace(/_PAGE-?\d+/g, " ")
    .replace(/\bMERGED\b/g, " ").replace(/\bAPPROVED\b/g, " ").replace(/\bREVISED\b/g, " ")
    .replace(/\bREVISION\b/g, " ").replace(/\bGAD\b/g, " ").replace(/\bAPP\b/g, " ")
    .replace(/\bMODEL\b/g, " ").replace(/\bECO\b/g, " ").replace(/\bSHEET\b/g, " ").replace(/&/g, " ");
  const out = new Set(); let m;
  const re1 = /([A-Z]{2,6})[ \-_]*(\d{2,4})/g; while ((m = re1.exec(s))) out.add(m[1] + m[2].padStart(4, "0"));
  const re2 = /\b(\d{4,})\b/g; while ((m = re2.exec(s))) { const d = m[1]; for (let i = 0; i + 4 <= d.length; i += 4) out.add(d.slice(i, i + 4)); }
  return out;
}

const files = fs.readdirSync(DRAW_DIR).filter((f) => /\.(pdf)$/i.test(f));
const sheetTokens = new Map(corpus.map((r) => [r.sheet, [...tokens(r.sheet)]]));
const drawIndex = new Map();
for (const f of files) for (const t of tokens(f)) { if (!drawIndex.has(t)) drawIndex.set(t, []); drawIndex.get(t).push(f); }

// unmatched sheets
const unmatchedSheets = corpus.filter((r) => !(sheetTokens.get(r.sheet) || []).some((t) => drawIndex.has(t)));
// unmatched drawings (filename token hits no sheet)
const sheetTokenSet = new Set([].concat(...[...sheetTokens.values()]));
const unmatchedDraws = files.filter((f) => ![...tokens(f)].some((t) => sheetTokenSet.has(t)));

if (process.argv[2] === "bridge") {
  console.log("UNMATCHED part-list sheets:", unmatchedSheets.length);
  unmatchedSheets.forEach((r) => console.log(`  ${r.sheet.padEnd(16)} ${r.jobCode.padEnd(16)} ${String(r.specRaw).slice(0, 30)}`));
  console.log("\nUNMATCHED drawings (filename hits no sheet):", unmatchedDraws.length);
  // write the list for the workflow
  fs.writeFileSync(path.join(__dirname, "data", "_unmatched_draws.json"),
    JSON.stringify(unmatchedDraws.map((f) => path.join(DRAW_DIR, f).replace(/\//g, "\\"))));
  fs.writeFileSync(path.join(__dirname, "data", "_unmatched_sheets.json"),
    JSON.stringify(unmatchedSheets.map((r) => ({ sheet: r.sheet, jobCode: r.jobCode, specRaw: r.specRaw }))));
  console.log("(wrote _unmatched_draws.json + _unmatched_sheets.json)");
}
