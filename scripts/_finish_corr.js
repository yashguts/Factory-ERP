// Finish-correlation miner: for each door-system section, does its colour follow the
// CAR door colour or the LANDING door colour? (owner: door post = landing). Uses the
// truth SKUs, so it finds the RULE without needing the drawing re-read.
const fs = require("fs"), path = require("path");
const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n").forEach((l) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].trim(); });
const U = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, ""), H = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: "Bearer " + env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
const fa = async (t, s) => { let o = [], f = 0; for (;;) { const r = await fetch(`${U}/rest/v1/${t}?select=${encodeURIComponent(s)}`, { headers: { ...H, "Range-Unit": "items", Range: `${f}-${f + 999}` } }); const c = await r.json(); o.push(...c); if (c.length < 1000) return o; f += 1000; } };
const COLORS = ["ROSE GOLD LINEN", "ROSE GOLD MIRROR", "ROSE GOLD", "BLACK MIRROR", "SILVER MIRROR", "CHAMPAGNE", "GOLDEN", "TITANIUM", "GRANITE", "COPPER", "BRONZE", "WOOD"];
const colorOf = (s) => { const u = (s || "").toUpperCase(); for (const c of COLORS) if (u.includes(c)) return c; return /\bMS\b/.test(u) ? "MS" : "PLAIN"; };
const matOf = (s) => (/\/MS[\/(]| MS\b/i.test(s || "") ? "MS" : "SS");
(async () => {
  const hdr = await fa("job_bom_headers", "id,job_id"); const byH = new Map(hdr.map((h) => [h.id, h.job_id]));
  const ln = await fa("job_bom_lines", "job_bom_id,category,item:items(name)");
  const first = new Map(); // job -> {section: name}
  for (const l of ln) { const j = byH.get(l.job_bom_id); if (!j) continue; const o = first.get(j) || {}; if (!o[l.category]) o[l.category] = (Array.isArray(l.item) ? l.item[0] : l.item)?.name || ""; first.set(j, o); }
  const SECS = ["Door Post / Frame", "Linton Panel", "Car Header System", "Landing Header System", "Door Sill", "Sill Angle"];
  console.log("section               n   follows CAR colour | follows LANDING colour  (which finish drives it)");
  for (const sec of SECS) {
    let n = 0, car = 0, land = 0;
    for (const [, o] of first) {
      const carC = colorOf(o["Car Door Panel"]), landC = colorOf(o["Landing Door Panel"]), secC = colorOf(o[sec]);
      if (!o[sec] || !o["Car Door Panel"] || !o["Landing Door Panel"]) continue;
      if (carC === landC) continue; // only count jobs where car != landing (the discriminating ones)
      n++; if (secC === carC) car++; if (secC === landC) land++;
    }
    if (n < 3) { console.log(`${sec.padEnd(22)} ${n}  (too few car!=landing jobs)`); continue; }
    console.log(`${sec.padEnd(22)} ${String(n).padStart(2)}   CAR ${(100 * car / n).toFixed(0)}%            LANDING ${(100 * land / n).toFixed(0)}%   -> ${land > car ? "LANDING" : "CAR"}`);
  }
})();
