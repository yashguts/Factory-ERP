/**
 * Produce inputs for the alias/mapping research pass:
 *   _research/inventory-cats.json  — ERP inventory category leaves (path + item count + samples)
 *   _research/unresolved.json      — part-list ITEM particulars that don't resolve today
 * Run: node scripts/partlist-brain/dump-research-inputs.js
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const sections = require(path.join(__dirname, "..", "_packing_sections.json"));
const corpus = require(path.join(__dirname, "data", "corpus.json"));

function loadEnv() {
  const txt = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim(); }
  return env;
}
async function fetchAll(sb, table, cols, filter) {
  const PAGE = 1000; let off = 0; const out = [];
  for (;;) { let q = sb.from(table).select(cols).range(off, off + PAGE - 1); if (filter) q = filter(q); const { data, error } = await q; if (error) throw error; out.push(...data); if (data.length < PAGE) break; off += PAGE; }
  return out;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const cats = await fetchAll(sb, "item_categories", "id,name,parent_id");
  const byId = new Map(cats.map((c) => [c.id, c]));
  const pathOf = (c) => { const p = []; let cur = c, g = 0; while (cur && g++ < 12) { p.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : null; } return p.join(" > "); };
  const items = await fetchAll(sb, "items", "id,name,category_id,is_active", (q) => q.eq("is_active", true));
  const byCat = new Map();
  for (const it of items) { if (!it.category_id) continue; (byCat.get(it.category_id) || byCat.set(it.category_id, []).get(it.category_id)).push(it.name); }

  // exclude the Cabin subtree (out of mechanical scope)
  const childrenOf = new Map(); for (const c of cats) { (childrenOf.get(c.parent_id) || childrenOf.set(c.parent_id, []).get(c.parent_id)).push(c.id); }
  const desc = (root) => { const s = new Set(), q = [root]; while (q.length) { const id = q.shift(); if (s.has(id)) continue; s.add(id); for (const ch of childrenOf.get(id) || []) q.push(ch); } return s; };
  const cabinRoot = cats.find((c) => c.name === "Cabin" && !c.parent_id);
  const cabinIds = cabinRoot ? desc(cabinRoot.id) : new Set();

  const invCats = [];
  for (const c of cats) {
    if (cabinIds.has(c.id)) continue;
    const names = byCat.get(c.id) || [];
    if (!names.length) continue;
    invCats.push({ path: pathOf(c), count: names.length, samples: names.slice(0, 4) });
  }
  invCats.sort((a, b) => a.path.localeCompare(b.path));

  // particulars: item-type, with their current category mapping + corpus example specs
  const specEx = new Map(); // sectionKey -> a couple example specs
  for (const rec of corpus) for (const l of rec.lines) { if (l.sectionKey && l.spec) { const a = specEx.get(l.sectionKey) || new Set(); if (a.size < 3) a.add(l.spec); specEx.set(l.sectionKey, a); } }
  const particulars = sections.filter((s) => s.captureType === "item").map((s) => ({
    sectionKey: s.key, label: s.label, categoryPaths: s.categoryPaths,
    exampleSpecs: [...(specEx.get(s.key) || [])],
  }));

  const dir = path.join(__dirname, "_research"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "inventory-cats.json"), JSON.stringify(invCats, null, 0));
  fs.writeFileSync(path.join(dir, "particulars.json"), JSON.stringify(particulars, null, 0));
  console.log(`inventory category leaves (non-cabin, with items): ${invCats.length}`);
  console.log(`item particulars: ${particulars.length}  (with category: ${particulars.filter((p) => p.categoryPaths.length).length}, unscoped: ${particulars.filter((p) => !p.categoryPaths.length).length})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
