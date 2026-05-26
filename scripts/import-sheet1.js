/**
 * Import items from Inventory.xlsx Sheet1 + Safety Frame tab
 * - All items → mechanical_finished_stock type
 * - Creates missing categories/sub-categories
 * - Matches by lookup_key, updates existing items (preserves FK refs)
 * - Inserts new items
 * - Imports stock values into inventory table
 */

const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

// Read env from .env.local
const envFile = fs.readFileSync(".env.local", "utf8");
const SUPABASE_URL = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const SUPABASE_KEY = envFile.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/)[1].trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const WAREHOUSE_ID = "0ebcfb80-19e2-43e7-b15c-e6020bd5506d"; // Main Store
const UOM_PCS_ID = "9ed3b796-f2a3-4336-8479-6db47c7a95ef"; // pcs

const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

async function run() {
  const wb = XLSX.readFile(
    String.raw`C:\Users\yash_\OneDrive\Desktop\Inventory.xlsx`
  );

  // ── Parse both sheets ──────────────────────────────────────────
  function parseSheet(sheetName) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const items = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const cat = (row[0] || "").toString().trim();
      const sub = (row[1] || "").toString().trim();
      const spec = (row[2] || "").toString().trim();
      const fullName = (row[3] || "").toString().trim();
      const stock = Number(row[5]) || 0;
      if (!cat || !sub || !fullName) continue;
      // Normalize trailing dash in sub-category name
      const cleanSub = sub.replace(/-$/, "").trim();
      items.push({ cat, sub: cleanSub, spec, fullName, stock });
    }
    return items;
  }

  const sheet1Items = parseSheet("Sheet1");
  const sfItems = parseSheet("Safety Frame");
  const allItems = [...sheet1Items, ...sfItems];
  console.log(
    `Parsed: Sheet1=${sheet1Items.length}, Safety Frame=${sfItems.length}, Total=${allItems.length}`
  );

  // ── Get existing categories ────────────────────────────────────
  const { data: existingCats, error: catErr } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  if (catErr) { console.error("Error fetching categories:", catErr); return; }
  const catMap = new Map(); // name -> {id, parent_id}
  for (const c of (existingCats || [])) catMap.set(c.name, c);

  // ── Collect unique parent + sub categories from data ──────────
  const neededParents = new Set();
  const neededSubs = new Map(); // "parent > sub" -> { parent, sub }
  for (const item of allItems) {
    neededParents.add(item.cat);
    neededSubs.set(`${item.cat} > ${item.sub}`, {
      parent: item.cat,
      sub: item.sub,
    });
  }

  // ── Create missing parent categories ──────────────────────────
  for (const pName of neededParents) {
    const existing = [...catMap.values()].find(
      (c) => c.name === pName && c.parent_id === null
    );
    if (!existing) {
      const { data, error } = await supabase
        .from("item_categories")
        .insert({ name: pName, parent_id: null })
        .select("id, name, parent_id")
        .single();
      if (error) {
        console.error(`Error creating parent category ${pName}:`, error);
        continue;
      }
      catMap.set(data.name + "_parent", data);
      console.log(`Created parent category: ${pName} → ${data.id}`);
    }
  }

  // Refresh categories from DB
  const { data: refreshedCats } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  catMap.clear();
  for (const c of refreshedCats) catMap.set(`${c.name}__${c.parent_id}`, c);

  // Helper to find parent category by name (parent_id = null)
  const findParent = (name) => {
    for (const [, c] of catMap) {
      if (c.name === name && c.parent_id === null) return c;
    }
    return null;
  };

  // ── Create missing sub-categories ─────────────────────────────
  for (const [, { parent, sub }] of neededSubs) {
    const parentCat = findParent(parent);
    if (!parentCat) {
      console.error(`Parent category not found: ${parent}`);
      continue;
    }
    // Check if sub-category already exists under this parent
    let exists = false;
    for (const [, c] of catMap) {
      if (c.name === sub && c.parent_id === parentCat.id) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      const { data, error } = await supabase
        .from("item_categories")
        .insert({ name: sub, parent_id: parentCat.id })
        .select("id, name, parent_id")
        .single();
      if (error) {
        console.error(`Error creating sub-category ${sub} under ${parent}:`, error);
        continue;
      }
      catMap.set(`${data.name}__${data.parent_id}`, data);
      console.log(`Created sub-category: ${parent} > ${sub} → ${data.id}`);
    }
  }

  // Refresh again
  const { data: finalCats } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");
  catMap.clear();
  for (const c of finalCats) catMap.set(`${c.name}__${c.parent_id}`, c);

  // Helper to find sub-category ID
  const findSubCatId = (parentName, subName) => {
    const parentCat = findParent(parentName);
    if (!parentCat) return null;
    for (const [, c] of catMap) {
      if (c.name === subName && c.parent_id === parentCat.id) return c.id;
    }
    return null;
  };

  // ── Get all existing items from DB ────────────────────────────
  let allDbItems = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("items")
      .select("id, name, lookup_key, item_type, category_id")
      .range(offset, offset + 999);
    if (error) {
      console.error("Error fetching items:", error);
      break;
    }
    allDbItems = allDbItems.concat(data || []);
    if (!data || data.length < 1000) break;
    offset += 1000;
  }
  console.log(`\nExisting DB items: ${allDbItems.length}`);

  // Build lookup map: normalized lookup_key -> item
  const dbLookup = new Map();
  for (const item of allDbItems) {
    if (item.lookup_key) {
      dbLookup.set(norm(item.lookup_key), item);
    }
  }

  // ── Process items ─────────────────────────────────────────────
  let updated = 0,
    created = 0,
    skipped = 0,
    errors = 0;
  let stockUpdated = 0;
  const processedIds = []; // Track items for stock import

  // Generate item codes: MFS-001, MFS-002, ...
  let codeCounter = 1;
  // Find max existing MFS code
  for (const item of allDbItems) {
    if (item.name && /^MFS-\d+$/.test(item.name)) {
      const num = parseInt(item.name.replace("MFS-", ""));
      if (num >= codeCounter) codeCounter = num + 1;
    }
  }

  for (const item of allItems) {
    const subCatId = findSubCatId(item.cat, item.sub);
    if (!subCatId) {
      console.error(`Sub-category not found: ${item.cat} > ${item.sub}`);
      skipped++;
      continue;
    }

    const lookupKey = item.fullName;
    const existingItem = dbLookup.get(norm(lookupKey));

    if (existingItem) {
      // UPDATE existing item
      const { error } = await supabase
        .from("items")
        .update({
          item_type: "mechanical_finished_stock",
          category_id: subCatId,
        })
        .eq("id", existingItem.id);

      if (error) {
        console.error(`Update error for ${lookupKey}:`, error.message);
        errors++;
      } else {
        updated++;
        processedIds.push({ id: existingItem.id, stock: item.stock });
      }
    } else {
      // INSERT new item
      const code = `MFS-${String(codeCounter++).padStart(4, "0")}`;
      const { data: newItem, error } = await supabase
        .from("items")
        .insert({
          code,
          name: item.sub, // Sub-category as display name
          lookup_key: lookupKey,
          item_type: "mechanical_finished_stock",
          category_id: subCatId,
          uom_id: UOM_PCS_ID,
          minimum_stock: 0,
          reorder_point: 0,
          lead_time_days: 0,
          cost_price: 0,
          is_active: true,
        })
        .select("id")
        .single();

      if (error) {
        console.error(`Insert error for ${lookupKey}:`, error.message);
        errors++;
      } else {
        created++;
        processedIds.push({ id: newItem.id, stock: item.stock });
      }
    }
  }

  console.log(`\nItems: updated=${updated}, created=${created}, skipped=${skipped}, errors=${errors}`);

  // ── Import stock values ───────────────────────────────────────
  const itemsWithStock = processedIds.filter((p) => p.stock > 0);
  console.log(`\nImporting stock for ${itemsWithStock.length} items...`);

  for (const { id, stock } of itemsWithStock) {
    // Check if inventory row exists
    const { data: existing } = await supabase
      .from("inventory")
      .select("id, quantity")
      .eq("item_id", id)
      .eq("warehouse_id", WAREHOUSE_ID)
      .single();

    if (existing) {
      // Update existing stock
      const { error } = await supabase
        .from("inventory")
        .update({ quantity: stock })
        .eq("id", existing.id);
      if (error) console.error(`Stock update error for item ${id}:`, error.message);
      else stockUpdated++;
    } else {
      // Insert new inventory row
      const { error } = await supabase
        .from("inventory")
        .insert({ item_id: id, warehouse_id: WAREHOUSE_ID, quantity: stock });
      if (error) console.error(`Stock insert error for item ${id}:`, error.message);
      else stockUpdated++;
    }
  }

  console.log(`Stock records created/updated: ${stockUpdated}`);

  // ── Final summary ─────────────────────────────────────────────
  const { data: finalCount } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true });
  console.log(`\nTotal items in DB: ${finalCount}`);
}

run().catch(console.error);
