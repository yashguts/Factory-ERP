// CNC import v2: improved matcher + data-driven material/finish fan-out.
// DRY RUN by default; --commit deletes any prior import (cnc_std_v1/v2) and re-inserts.
const fs = require("fs");
const PROJ = String.raw`C:\Users\yash_\OneDrive\Desktop\Factory ERP`;
const { createClient } = require(PROJ + String.raw`\node_modules\@supabase\supabase-js`);
const env = fs.readFileSync(PROJ + String.raw`\.env.local`, "utf-8");
const URL = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const KEY = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/)[1].trim();
const supabase = createClient(URL, KEY);
const COMMIT = process.argv.includes("--commit");
const TAG = "cnc_std_v2";
const programs = JSON.parse(fs.readFileSync(String.raw`C:\Users\yash_\AppData\Local\Temp\std_programs.json`, "utf-8"));

const SKIP = new Set(["FFFF0000", "FFFFFF00"]);
const LASER = new Set(["FF00FFFF", "FF9900FF", "FFFF00FF"]);
const STRUCT_PAREN = /^(STD|BIG|\d+(\.\d+)?\s*MM|FIRE\s*DOOR|RAILWAY|RH|LH|HOME)$/i;

const norm = (s) => (s || "").toUpperCase()
  .replace(/\bBKT\b\.?/g, "BRACKET").replace(/\bBRKT\b/g, "BRACKET").replace(/\bASSY\b/g, "ASSEMBLY")
  .replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const toks = (s) => new Set(norm(s).split(" ").filter(Boolean));
function matOf(s) { const u = (s || "").toUpperCase(); const ss = /(^|[^A-Z])SS([^A-Z]|$)|\/SS/.test(u), ms = /(^|[^A-Z])MS([^A-Z]|$)|\/MS/.test(u), gi = /(^|[^A-Z])GI([^A-Z]|$)|\/GI/.test(u); if (ss && !ms) return "SS"; if (ms && !ss) return "MS"; if (gi) return "GI"; return null; }
const isBig = (s) => /\(BIG\)/i.test(s || "");
function score(a, b) { let i = 0; for (const t of a) if (b.has(t)) i++; if (!i) return 0; return (i / Math.min(a.size, b.size)) * 0.6 + (i / (a.size + b.size - i)) * 0.4; }
function progMat(p) { const g = (p.mat || "").toUpperCase(); if (g.includes("SS") && !g.includes("MS")) return "SS"; if (g.includes("GI")) return "GI"; return "MS"; }
const thkNum = (p) => { const m = ((p.thk || "").toUpperCase().replace("O", "0")).match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : null; };
const dims = (s) => { const m = (s || "").toUpperCase().match(/(\d{3,4})\s*X\s*(\d{3,4})/); return m ? [+m[1], +m[2]].sort((a, b) => a - b) : null; };

(async () => {
  let items = [], from = 0;
  while (true) {
    const { data, error } = await supabase.from("items")
      .select("id,code,name,category:item_categories!items_category_id_fkey(name)")
      .eq("is_active", true).order("code").range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    items = items.concat(data); if (data.length < 1000) break; from += 1000;
  }
  const idx = items.map((it) => ({ id: it.id, code: it.code, name: it.name, cat: (Array.isArray(it.category) ? it.category[0]?.name : it.category?.name) || "", normName: norm(it.name), tok: toks(it.name), mat: matOf(it.name) }));
  const byNorm = new Map(); const byId = new Map();
  for (const it of idx) { if (!byNorm.has(it.normName)) byNorm.set(it.normName, it); byId.set(it.id, it); }

  // dynamic finish vocabulary from trailing parens that aren't structural
  const finishSet = new Set();
  for (const it of idx) {
    const ps = [...it.name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
    for (const p of ps) if (!STRUCT_PAREN.test(p)) finishSet.add(p);
  }

  // sheets for input mapping
  const sheets = idx.filter((it) => it.code.startsWith("RM-")).map((it) => {
    const tm = it.name.match(/X\s*(\d+(?:\.\d+)?)\s*MM/i) || it.name.match(/(\d+(?:\.\d+)?)\s*MM/i);
    let mat = "MS"; if (/Designer/i.test(it.cat)) mat = "DESIGNER"; else if (/SS/i.test(it.cat)) mat = "SS"; else if (/GI/i.test(it.cat)) mat = "GI";
    return { ...it, sheetMat: mat, sheetThk: tm ? parseFloat(tm[1].replace(/.*[xX]/, "")) : null, d: dims(it.name) };
  });
  const matchSheet = (mat, thk, d) => (!thk || !d) ? null : (sheets.find((s) => s.sheetMat === mat && s.sheetThk === thk && s.d && s.d[0] === d[0] && s.d[1] === d[1]) || null);

  const { data: existing } = await supabase.from("operations").select("family_key,name,import_source");
  const existKeys = new Set((existing || []).filter((o) => !o.import_source).map((o) => o.family_key));
  const existNames = new Set((existing || []).filter((o) => !o.import_source).map((o) => o.name));

  function bestItem(part, mat) {
    const n = norm(part);
    if (byNorm.has(n)) return { it: byNorm.get(n), sc: 1 };
    const pt = toks(part); let b = null, bs = 0;
    for (const it of idx) {
      let s = score(pt, it.tok);
      if (it.mat && mat) { if (it.mat === mat) s += 0.10; else s -= 0.18; }
      if (isBig(it.name) && !/BIG/i.test(part)) s -= 0.08; // prefer STD when program doesn't say BIG
      if (s > bs) { bs = s; b = it; }
    }
    return { it: b, sc: bs };
  }
  const THRESH = 0.62;

  // sibling material/finish variants of a matched SKU (for fan-out)
  function siblingsOf(skuName) {
    const m = skuName.match(/\/(MS|SS|GI)\//);
    if (!m) return [];
    // stem = before material + after-material structural, finish removed
    const base = skuName; // e.g. Car Pannel CO/MS/NV/700(STD)
    const afterMat = base.slice(base.indexOf(m[0]) + m[0].length); // NV/700(STD)...
    // strip trailing finish parens from afterMat to get structural tail
    let tail = afterMat;
    const trailing = [...tail.matchAll(/\(([^)]+)\)\s*$/g)];
    // remove finish parens one by one from the end
    while (true) {
      const mm = tail.match(/\(([^)]+)\)\s*$/);
      if (mm && finishSet.has(mm[1].trim())) tail = tail.slice(0, mm.index).trim(); else break;
    }
    const prefix = base.slice(0, base.indexOf(m[0])); // Car Pannel CO
    // a sibling SKU: starts with prefix, has /MAT/, and its structural tail (finish-stripped) == tail
    const out = [];
    for (const it of idx) {
      if (!it.name.startsWith(prefix)) continue;
      const mm2 = it.name.match(/\/(MS|SS|GI)\//); if (!mm2) continue;
      let t2 = it.name.slice(it.name.indexOf(mm2[0]) + mm2[0].length);
      let finish = null;
      while (true) { const x = t2.match(/\(([^)]+)\)\s*$/); if (x && finishSet.has(x[1].trim())) { finish = finish ? x[1].trim() + " " + finish : x[1].trim(); t2 = t2.slice(0, x.index).trim(); } else break; }
      if (t2 === tail) out.push({ it, mat: mm2[1], finish, label: mm2[1] + (finish ? " " + finish : "") });
    }
    return out;
  }

  const built = []; const stats = { progs: 0, variants: 0, fanned: 0, skipped: 0, dupes: 0, outMatched: 0, outTBF: 0 };
  for (const p of programs) {
    if (SKIP.has(p.color) || !p.outputs?.length || /^LASER CUTTING$/i.test(p.name.trim())) { stats.skipped++; continue; }
    const family = p.name.trim();
    if (existKeys.has(family) || existNames.has(family)) { stats.dupes++; continue; }
    const mat = progMat(p), thk = thkNum(p), d = dims(p.sheet);
    const machine = (LASER.has(p.color) || /\bLC\b/.test(family.toUpperCase())) ? "cnc_laser" : "cnc_punch";
    stats.progs++;

    // base outputs
    const baseOut = p.outputs.map((o) => {
      const qty = o.qty && +o.qty > 0 ? +o.qty : 1;
      const r = bestItem(o.part, mat);
      return { part: o.part, qty, it: r.it && r.sc >= THRESH ? r.it : null };
    });
    const sheet = matchSheet(mat, thk, d);
    const baseInput = sheet ? { item_id: sheet.id, label: null } : { item_id: null, label: `${p.mat || mat} ${p.thk || "?"} ${p.sheet || "?"}`.trim() };

    // fan-out targets: from the first matched, material-coded output
    const primary = baseOut.find((o) => o.it && /\/(MS|SS|GI)\//.test(o.it.name));
    let targets = [{ matLabel: mat, transform: null }]; // base variant
    if ((thk == null || thk <= 2.0) && primary) {
      const sibs = siblingsOf(primary.it.name);
      const seen = new Set([primary.it.id]);
      const tset = new Map(); // label -> representative sibling list keyed by sku id of primary's family
      for (const s of sibs) { if (!tset.has(s.label)) tset.set(s.label, s); }
      // base variant uses primary's own material label
      const primaryLabel = matOf(primary.it.name) + (() => { let t = primary.it.name, f = null; while (true) { const x = t.match(/\(([^)]+)\)\s*$/); if (x && finishSet.has(x[1].trim())) { f = x[1].trim(); t = t.slice(0, x.index).trim(); } else break; } return f ? " " + f : ""; })();
      targets = [];
      for (const [label, s] of tset) targets.push({ matLabel: label, sib: s });
      if (!targets.find((t) => t.matLabel === primaryLabel)) targets.unshift({ matLabel: primaryLabel, sib: { it: primary.it, mat: matOf(primary.it.name) } });
      if (targets.length > 1) stats.fanned++;
    }

    const variants = targets.map((tg) => {
      // for each base output, find the variant SKU for this target material/finish
      const outs = baseOut.map((bo) => {
        let it = bo.it;
        if (tg.sib && bo.it && /\/(MS|SS|GI)\//.test(bo.it.name)) {
          // derive this output's sibling for target label
          const sibs = siblingsOf(bo.it.name);
          const match = sibs.find((s) => s.label === tg.matLabel) || (matOf(bo.it.name) + (/* base label */ "") === tg.matLabel ? { it: bo.it } : null);
          it = match ? match.it : null; // null -> to-be-filled in this variant
        }
        if (it) stats.outMatched++; else stats.outTBF++;
        return { item_id: it ? it.id : null, label: it ? null : bo.part, qty_per_run: bo.qty };
      });
      // input sheet for this material
      let inp = baseInput;
      if (tg.matLabel && tg.matLabel !== mat) {
        const tmat = tg.matLabel.startsWith("SS") ? (tg.matLabel === "SS" ? "SS" : "DESIGNER") : tg.matLabel.startsWith("GI") ? (tg.matLabel === "GI" ? "GI" : "DESIGNER") : "MS";
        const sh = matchSheet(tmat, thk, d);
        inp = sh ? { item_id: sh.id, label: null } : { item_id: null, label: `${tg.matLabel} ${p.thk || "?"} ${p.sheet || "?"}`.trim() };
      }
      stats.variants++;
      return { matLabel: tg.matLabel, machine, input: inp, outputs: outs };
    });

    const multi = variants.length > 1;
    for (const v of variants) {
      built.push({ name: multi ? `${family} (${v.matLabel})` : family, family_key: family, material_label: v.matLabel, machine: v.machine, input: v.input, outputs: v.outputs });
    }
  }

  console.log("STATS:", stats);
  console.log("Total operation rows to insert:", built.length);
  // sample fan-out
  const fam = {}; for (const b of built) (fam[b.family_key] ??= []).push(b);
  const multiFam = Object.entries(fam).filter(([, v]) => v.length > 1).slice(0, 4);
  console.log("\nSAMPLE FANNED FAMILIES:");
  for (const [k, v] of multiFam) console.log(`  ${k}: ${v.length} variants -> ${v.map((x) => x.material_label).join(", ")}`);

  if (!COMMIT) { console.log("\nDRY RUN — no writes."); return; }

  // delete prior import
  const del = await supabase.from("operations").delete().in("import_source", ["cnc_std_v1", "cnc_std_v2"]);
  if (del.error) { console.error("delete failed", del.error.message); process.exit(1); }
  console.log("Deleted prior import.");
  let ok = 0, fail = 0;
  for (const b of built) {
    const { data: op, error } = await supabase.from("operations").insert({ name: b.name, code: null, machine: b.machine, family_key: b.family_key, material_label: b.material_label, program_label: "Standard Programs", import_source: TAG }).select("id").single();
    if (error) { fail++; if (fail < 10) console.error("op fail", b.name, error.message); continue; }
    await supabase.from("operation_inputs").insert([{ operation_id: op.id, item_id: b.input.item_id, label: b.input.label, qty_per_run: 1, sort_order: 0 }]);
    await supabase.from("operation_outputs").insert(b.outputs.map((o, i) => ({ operation_id: op.id, item_id: o.item_id, label: o.label, qty_per_run: o.qty_per_run, sort_order: i })));
    ok++; if (ok % 100 === 0) console.log("inserted", ok);
  }
  console.log(`COMMIT done. inserted=${ok} failed=${fail}`);
})();
