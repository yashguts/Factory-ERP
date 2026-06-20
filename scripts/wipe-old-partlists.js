/**
 * MERGE-TIME ONLY — wipe the legacy BOM-seeded part lists so every job starts
 * fresh on the new brain-generated, watertight checklist. Run this WHEN the new
 * Part List UI goes live (owner decision: "wipe at merge"), NOT before — the DB
 * is shared with the live site, so wiping early empties the current live page.
 *
 *   node scripts/wipe-old-partlists.js          # dry run (counts only)
 *   node scripts/wipe-old-partlists.js --confirm # actually delete
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const txt = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim(); }
  return env;
}

async function main() {
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const confirm = process.argv.includes("--confirm");

  const { count: lines } = await supabase.from("packing_list_lines").select("id", { count: "exact", head: true });
  const { count: lists } = await supabase.from("packing_lists").select("id", { count: "exact", head: true });
  console.log(`Existing: ${lists} packing_lists, ${lines} packing_list_lines.`);

  if (!confirm) { console.log("\nDRY RUN — pass --confirm to delete all of the above (wipe at merge)."); return; }

  // delete lines first (FK), then headers
  const { error: e1 } = await supabase.from("packing_list_lines").delete().not("id", "is", null);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("packing_lists").delete().not("id", "is", null);
  if (e2) throw e2;
  console.log("Wiped. Every job now starts on the fresh brain-generated checklist.");
}
main().catch((e) => { console.error(e); process.exit(1); });
