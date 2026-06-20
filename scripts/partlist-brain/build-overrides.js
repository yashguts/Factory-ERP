/**
 * Turn the alias-mapping workflow result into a runtime override map:
 *   src/lib/partlist/partlist-overrides.json
 *     { sectionKey: { categoryPath?: string, nonInventory?: true, aliases?: string[] } }
 * Validates every categoryPath against the real ERP categories (drops hallucinations).
 *
 * Run: node scripts/partlist-brain/build-overrides.js <workflow-output.json>
 */
const fs = require("fs");
const path = require("path");
const invCats = require(path.join(__dirname, "_research", "inventory-cats.json"));
const validPaths = new Set(invCats.map((c) => c.path));

const outFile = process.argv[2];
const raw = JSON.parse(fs.readFileSync(outFile, "utf8"));
const mappings = (raw.result && raw.result.mappings) || raw.mappings || [];

const overrides = {};
let mapped = 0, nonInv = 0, dropped = 0;
for (const m of mappings) {
  if (!m || !m.sectionKey) continue;
  const cp = (m.categoryPath || "").replace(/&gt;/g, ">").replace(/\s*>\s*/g, " > ").trim();
  const aliases = Array.isArray(m.aliases) ? m.aliases.map((a) => String(a).toLowerCase().trim()).filter(Boolean).slice(0, 8) : [];
  if (cp && validPaths.has(cp)) {
    overrides[m.sectionKey] = { categoryPath: cp, ...(aliases.length ? { aliases } : {}) };
    mapped++;
  } else if (m.nonInventory) {
    overrides[m.sectionKey] = { nonInventory: true, ...(aliases.length ? { aliases } : {}) };
    nonInv++;
  } else {
    // agent gave a path that isn't a real ERP category -> don't apply (stays unscoped, engineer decides)
    dropped++;
    if (cp) console.log(`  dropped invalid path for ${m.sectionKey}: "${cp}"`);
  }
}

const dest = path.join(__dirname, "..", "..", "src", "lib", "partlist", "partlist-overrides.json");
fs.writeFileSync(dest, JSON.stringify(overrides));
fs.writeFileSync(path.join(__dirname, "data", "partlist-overrides.json"), JSON.stringify(overrides));
console.log(`overrides: ${Object.keys(overrides).length}  (category-mapped: ${mapped}, non-inventory: ${nonInv}, dropped invalid: ${dropped})`);
