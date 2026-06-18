/**
 * Bulk-seed packing lists for every job that has a BOM and no packing list yet.
 * Additive + idempotent: jobs with an existing packing_lists row are skipped, so
 * re-running never duplicates. Mirrors ensurePackingList() in
 * src/lib/actions/packing-list.ts (same first-claim category→section mapping).
 *
 *   node scripts/seed-packing-lists.js --dry   # preview counts, write nothing
 *   node scripts/seed-packing-lists.js         # seed for real (parallel)
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const DRY = process.argv.includes("--dry");
const CONCURRENCY = 8;
const OTHER = "other";

function loadEnv() {
  const txt = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return env;
}

async function runPool(items, worker, concurrency) {
  const results = [];
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}

async function main() {
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const sections = JSON.parse(fs.readFileSync(path.join(__dirname, "_packing_sections.json"), "utf8"));

  // ---- category → section map (first-claim, register order) ----
  const { data: cats, error: catErr } = await supabase
    .from("item_categories").select("id, name, parent_id");
  if (catErr) throw catErr;
  const byParent = new Map();
  for (const c of cats) {
    const arr = byParent.get(c.parent_id ?? null) ?? [];
    arr.push(c);
    byParent.set(c.parent_id ?? null, arr);
  }
  const resolvePath = (p) => {
    const segs = p.split(">").map((s) => s.trim()).filter(Boolean);
    let parentId = null, matched = null;
    for (const seg of segs) {
      const sibs = byParent.get(parentId) ?? [];
      const found = sibs.find((c) => c.name.toLowerCase() === seg.toLowerCase());
      if (!found) return null;
      matched = found; parentId = found.id;
    }
    return matched ? matched.id : null;
  };
  const descendants = (rootId) => {
    const out = [rootId], stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      for (const ch of byParent.get(id) ?? []) { out.push(ch.id); stack.push(ch.id); }
    }
    return out;
  };
  const catToSection = new Map();
  for (const sec of sections) {
    for (const p of sec.categoryPaths) {
      const rootId = resolvePath(p);
      if (!rootId) continue;
      for (const id of descendants(rootId)) if (!catToSection.has(id)) catToSection.set(id, sec.key);
    }
  }

  // ---- jobs that have a BOM header ----
  const { data: headers, error: hErr } = await supabase
    .from("job_bom_headers").select("id, job_id");
  if (hErr) throw hErr;
  const headerByJob = new Map(headers.map((h) => [h.job_id, h.id]));

  // ---- jobs that already have a packing list ----
  const { data: existing } = await supabase.from("packing_lists").select("job_id");
  const haveList = new Set((existing ?? []).map((p) => p.job_id));

  const todo = headers.filter((h) => !haveList.has(h.job_id));
  console.log(`Jobs with a BOM: ${headers.length}`);
  console.log(`Already have a packing list: ${haveList.size}`);
  console.log(`To seed: ${todo.length}`);

  if (DRY) {
    // Estimate lines + section coverage on a sample.
    let totalLines = 0, otherLines = 0;
    for (const h of todo) {
      const { data: bl } = await supabase
        .from("job_bom_lines")
        .select("item_id, item:items!job_bom_lines_item_id_fkey(category_id)")
        .eq("job_bom_id", h.id).not("item_id", "is", null);
      for (const r of bl ?? []) {
        totalLines++;
        const it = Array.isArray(r.item) ? r.item[0] : r.item;
        const sk = (it && it.category_id && catToSection.get(it.category_id)) || OTHER;
        if (sk === OTHER) otherLines++;
      }
    }
    console.log(`\n[dry] would insert ~${totalLines} lines; ${otherLines} would land in "Other" (no register section).`);
    return;
  }

  let createdLists = 0, insertedLines = 0, otherLines = 0, errors = 0;
  await runPool(todo, async (h) => {
    try {
      const { data: created, error: cErr } = await supabase
        .from("packing_lists").insert({ job_id: h.job_id, seeded_from_bom: false })
        .select("id").single();
      if (cErr || !created) { errors++; return; }
      const listId = created.id;
      createdLists++;

      const { data: bl } = await supabase
        .from("job_bom_lines")
        .select("item_id, required_quantity, sort_order, item:items!job_bom_lines_item_id_fkey(category_id)")
        .eq("job_bom_id", h.id).not("item_id", "is", null).order("sort_order");

      const rows = (bl ?? []).map((r, idx) => {
        const it = Array.isArray(r.item) ? r.item[0] : r.item;
        const sk = (it && it.category_id && catToSection.get(it.category_id)) || OTHER;
        if (sk === OTHER) otherLines++;
        return {
          packing_list_id: listId,
          section_key: sk,
          item_id: r.item_id,
          qty: Number(r.required_quantity ?? 0),
          sort_order: Number(r.sort_order ?? idx),
        };
      });
      if (rows.length) {
        const { error: iErr } = await supabase.from("packing_list_lines").insert(rows);
        if (iErr) { errors++; console.error("insert lines failed for job", h.job_id, iErr.message); }
        else insertedLines += rows.length;
      }
      await supabase.from("packing_lists").update({ seeded_from_bom: true }).eq("id", listId);
    } catch (e) {
      errors++; console.error("seed failed for job", h.job_id, e.message);
    }
  }, CONCURRENCY);

  console.log(`\nDone. Created ${createdLists} packing lists, inserted ${insertedLines} lines (${otherLines} in "Other"). Errors: ${errors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
