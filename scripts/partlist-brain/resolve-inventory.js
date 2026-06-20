/**
 * Layer 3 — Inventory resolution.
 *
 * Answers the core question: of all the real part-list item lines, what fraction
 * can be auto-linked to an actual inventory item_id (category + specification
 * match)?  The rest are flagged "needs item" for the engineer (owner's rule).
 *
 * For each (sectionKey -> categoryPaths) + specification, search items inside
 * that category subtree and match the size/spec token in the item name.
 *
 * Run: node scripts/partlist-brain/resolve-inventory.js
 * Out: scripts/partlist-brain/data/resolution.json
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const corpus = require(path.join(__dirname, "data", "corpus.json"));
const sections = require(path.join(__dirname, "..", "_packing_sections.json"));
const OUT = path.join(__dirname, "data", "resolution.json");

function loadEnv() {
  const txt = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim(); }
  return env;
}
const sectionByKey = new Map(sections.map((s) => [s.key, s]));

const STOP = new Set(["the", "for", "with", "and", "type", "nos", "no", "set", "pcs", "pc",
  "size", "of", "as", "per", "mm", "kg", "qty", "each", "new", "old", "sr"]);
const SHAPE = new Set(["l", "u", "c", "z", "t", "i", "h"]); // shape codes worth keeping ("L"Type)
// tokens of a string -> { all:Set, sizes:Set } where sizes carry a digit (decisive).
function tokenize(s) {
  const all = new Set(), sizes = new Set();
  for (let t of String(s || "").toLowerCase().replace(/[(),"']/g, " ").split(/[\s\/]+/)) {
    t = t.replace(/[^a-z0-9.x+-]/g, "");
    if (!t || STOP.has(t)) continue;
    if (t.length < 2 && !SHAPE.has(t)) continue;
    // normalise the size unit: "350mm" -> "350" so a "350mm" spec matches a "350" SKU
    // (only when >=2 chars remain, to keep single-digit thicknesses like "8mm" intact)
    if (/[0-9]/.test(t)) { const sz = t.replace(/mm$/, ""); if (sz.length >= 2) t = sz; }
    // normalise side: part-list says "RHS"/"LHS", SKUs say "(RH)"/"(LH)" — pick the right side
    else if (t === "rhs") t = "rh"; else if (t === "lhs") t = "lh";
    all.add(t);
    if (/[0-9]/.test(t)) sizes.add(t);
  }
  return { all, sizes };
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

async function main() {
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  // categories + tree
  const cats = await fetchAll(supabase, "item_categories", "id,name,parent_id");
  const byId = new Map(cats.map((c) => [c.id, c]));
  const pathOf = (c) => { const p = []; let cur = c, g = 0; while (cur && g++ < 12) { p.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : null; } return p.join(" > "); };
  const idByPath = new Map(cats.map((c) => [pathOf(c), c.id]));
  const childrenOf = new Map();
  for (const c of cats) { if (!childrenOf.has(c.parent_id)) childrenOf.set(c.parent_id, []); childrenOf.get(c.parent_id).push(c.id); }
  const descendants = (rootIds) => { const out = new Set(); const q = [...rootIds]; while (q.length) { const id = q.shift(); if (out.has(id)) continue; out.add(id); for (const ch of (childrenOf.get(id) || [])) q.push(ch); } return out; };

  // cabin subtree to exclude from global (unscoped) search
  const cabinRoot = cats.find((c) => c.name === "Cabin" && !c.parent_id);
  const cabinIds = cabinRoot ? descendants([cabinRoot.id]) : new Set();

  // items (active), grouped by category, with precomputed name tokens
  const items = await fetchAll(supabase, "items", "id,code,name,category_id,is_active", (q) => q.eq("is_active", true));
  const itemsByCat = new Map();
  const globalItems = [];
  for (const it of items) {
    it.tok = tokenize(it.name);
    if (it.category_id) { if (!itemsByCat.has(it.category_id)) itemsByCat.set(it.category_id, []); itemsByCat.get(it.category_id).push(it); }
    if (!it.category_id || !cabinIds.has(it.category_id)) globalItems.push(it);
  }

  // Resolver-side category fixes: particulars whose template categoryPath is empty
  // or points at the wrong category, but whose SKU exists elsewhere (verified in DB).
  // Cheaper + safer than regenerating the live packing template.
  const CATEGORY_OVERRIDE = {
    "p-dade-weight-rod-ms": ["Header Systems > Dead Weight25x25"], // SKU "Dead Weight25x25 600MM"
    "p-car-header-hanging-bkt": ["Header Systems > HEADER"],        // SKU "HEADER Hanging Car Bkt"
  };

  // resolve categoryPaths -> candidate items, cached per section
  const candCache = new Map();
  function candidates(sectionKey) {
    if (candCache.has(sectionKey)) return candCache.get(sectionKey);
    const sec = sectionByKey.get(sectionKey);
    const overridePaths = CATEGORY_OVERRIDE[sectionKey];
    let list = [];
    const paths = overridePaths || (sec && sec.categoryPaths);
    if (paths && paths.length) {
      const roots = paths.map((p) => idByPath.get(p)).filter(Boolean);
      const all = descendants(roots);
      const seen = new Set();
      for (const cid of all) for (const it of (itemsByCat.get(cid) || [])) if (!seen.has(it.id)) { seen.add(it.id); list.push(it); }
    } else {
      list = globalItems; // unscoped -> search everything (minus cabin)
    }
    candCache.set(sectionKey, list);
    return list;
  }

  // Is this category SIZE-DISCRIMINATED (many sized SKUs, e.g. Guide Rail) or a
  // BASE-PART category (one SKU; the line's size is just a cut length)?
  const sizedFracCache = new Map();
  function sizedFrac(cands, sectionKey) {
    if (sizedFracCache.has(sectionKey)) return sizedFracCache.get(sectionKey);
    const f = cands.filter((it) => it.tok.sizes.size > 0).length / cands.length;
    sizedFracCache.set(sectionKey, f); return f;
  }

  function resolve(label, sectionKey, spec) {
    const cands = candidates(sectionKey);
    if (!cands.length) return { item: null, reason: "no-category" };
    const q = tokenize(`${label} ${spec || ""}`);
    if (!q.all.size) return cands.length === 1 ? { item: cands[0], reason: "sole-candidate" } : { item: null, reason: "no-spec" };
    const sizeArr = [...q.sizes], allArr = [...q.all];
    const sized = sizedFrac(cands, sectionKey) >= 0.5;

    let pool = cands, enforced = false;
    if (sizeArr.length && sized) {
      // The part-list spec is verbose ("DBG-850mm/100x40x40x3/1.7M", "8mm (34mtr x 6nos)")
      // but contains the canonical size. Match SKUs whose OWN size tokens all appear
      // in the spec (item ⊆ spec), preferring the most specific (most size tokens).
      const subset = cands.filter((it) => it.tok.sizes.size > 0 && [...it.tok.sizes].every((t) => q.sizes.has(t)));
      if (subset.length) { pool = subset; enforced = true; }
      else {
        // fallback: SKU carries every spec size token (item is the verbose one)
        const exact = cands.filter((it) => sizeArr.every((t) => it.tok.all.has(t)));
        if (exact.length) { pool = exact; enforced = true; } else return { item: null, reason: "no-match" };
      }
    }
    let best = null;
    for (const it of pool) {
      const allHit = allArr.filter((t) => it.tok.all.has(t)).length;
      const cov = allHit / allArr.length;
      const sizeSpecificity = [...it.tok.sizes].filter((t) => q.sizes.has(t)).length; // reward most-specific size match
      const extra = [...it.tok.sizes].filter((t) => !q.sizes.has(t)).length; // penalise stray sizes
      const score = sizeSpecificity * 1.0 + cov * 0.5 - 0.05 * extra;
      if (!best || score > best.score) best = { it, score, cov };
    }
    if (!best) return { item: null, reason: "no-match" };
    if (enforced || best.cov >= 0.45) return { item: best.it, reason: "matched", cov: +best.cov.toFixed(2) };
    return { item: null, reason: "no-match" };
  }
  // cache resolution by (sectionKey | specNorm | labelNorm)
  const resolveCache = new Map();
  function resolveCached(label, sectionKey, spec) {
    const k = `${sectionKey}|${String(spec || "").toLowerCase().trim()}|${String(label).toLowerCase().trim()}`;
    if (resolveCache.has(k)) return resolveCache.get(k);
    const r = resolve(label, sectionKey, spec); resolveCache.set(k, r); return r;
  }

  // run over all corpus item lines that have a sectionKey
  let total = 0, resolved = 0, noCat = 0, noMatch = 0, noSpec = 0;
  const perCat = new Map(); // categoryPath -> {total,resolved}
  const perSection = new Map(); // sectionKey -> {total,resolved,label,unres:Map(spec->n)}
  const unresolved = new Map(); // "sectionKey | spec" -> count
  for (const rec of corpus) {
    for (const l of rec.lines) {
      if (l.captureType !== "item" || !l.sectionKey) continue;
      total++;
      const sec = sectionByKey.get(l.sectionKey);
      const cp = sec && sec.categoryPaths && sec.categoryPaths[0] ? sec.categoryPaths[0] : "(unscoped)";
      const pc = perCat.get(cp) || { total: 0, resolved: 0 }; pc.total++;
      const ps = perSection.get(l.sectionKey) || { total: 0, resolved: 0, label: (sec && sec.label) || l.particular, unres: new Map() }; ps.total++;
      const r = resolveCached(l.particular, l.sectionKey, l.spec);
      if (r.item) { resolved++; pc.resolved++; ps.resolved++; }
      else {
        if (r.reason === "no-category") noCat++;
        else if (r.reason === "no-spec") noSpec++;
        else noMatch++;
        const k = `${l.sectionKey} | ${l.spec || "(blank)"}`;
        unresolved.set(k, (unresolved.get(k) || 0) + 1);
        ps.unres.set(l.spec || "(blank)", (ps.unres.get(l.spec || "(blank)") || 0) + 1);
      }
      perCat.set(cp, pc); perSection.set(l.sectionKey, ps);
    }
  }

  if (process.argv[2] === "diag") {
    const weak = [...perSection.entries()].filter(([, v]) => v.total >= 25 && v.resolved / v.total < 0.75)
      .sort((a, b) => (b[1].total - b[1].resolved) - (a[1].total - a[1].resolved));
    console.log(`RESOLVER DIAGNOSTIC — weak sections (>=25 lines, <75% resolved):\n`);
    for (const [key, v] of weak.slice(0, 16)) {
      const cands = candidates(key);
      const sf = cands.length ? sizedFrac(cands, key) : 0;
      console.log(`■ ${v.label}  [${key}]  ${v.resolved}/${v.total} resolved  | ${cands.length} candidates, sizedFrac=${sf.toFixed(2)}`);
      console.log(`   candidate names: ${cands.slice(0, 6).map((c) => c.name).join(" | ") || "(none)"}`);
      const us = [...v.unres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      console.log(`   unresolved specs: ${us.map(([s, n]) => `"${s}"x${n}`).join(", ")}\n`);
    }
    return;
  }

  const pct = (a, b) => (100 * a / (b || 1)).toFixed(1) + "%";
  const report = {
    totalItemLines: total, resolved, rate: resolved / total,
    breakdown: { noCategory: noCat, noSpecAmbiguous: noSpec, noMatch },
  };
  fs.writeFileSync(OUT, JSON.stringify(report));

  console.log(`INVENTORY RESOLUTION  (corpus item lines)\n`);
  console.log(`  total item lines     : ${total}`);
  console.log(`  auto-resolved to SKU : ${resolved}  (${pct(resolved, total)})`);
  console.log(`  unresolved -> flag   : ${total - resolved}`);
  console.log(`     no category scope : ${noCat}`);
  console.log(`     spec blank/ambig  : ${noSpec}`);
  console.log(`     no size match     : ${noMatch}\n`);

  const cats2 = [...perCat.entries()].filter(([, v]) => v.total >= 30).sort((a, b) => b[1].total - a[1].total);
  console.log(`Per-category resolution (>=30 lines):`);
  for (const [cp, v] of cats2.slice(0, 22)) console.log(`  ${pct(v.resolved, v.total).padStart(6)}  ${String(v.resolved).padStart(4)}/${String(v.total).padStart(4)}  ${cp.slice(0, 46)}`);

  console.log(`\nTop UNRESOLVED (sectionKey | spec):`);
  for (const [k, n] of [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${k.slice(0, 60)}`);
  console.log(`\nWrote ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
