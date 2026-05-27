const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qwzisnmueuqnzzokkpmn.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const EXCEL_PATH = "C:/Users/yash_/OneDrive/Desktop/Door Panels.xlsx";
const WAREHOUSE_NAME = "Main Store";
const DRY_RUN = false;

async function main() {
  // 1. Read Excel
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);

  // Filter valid rows (must have a non-empty lookup value in col D)
  const valid = rows.filter(
    (r) => r[3] && String(r[3]).trim() && String(r[3]).trim() !== " "
  );
  console.log(`Found ${valid.length} valid items in Excel\n`);

  // 2. Get warehouse
  const { data: warehouses } = await supabase
    .from("warehouses")
    .select("id, name")
    .eq("is_active", true);
  const warehouse = warehouses.find((w) => w.name === WAREHOUSE_NAME) || warehouses[0];
  console.log(`Using warehouse: ${warehouse.name} (${warehouse.id})\n`);

  // 3. Get UOM for "pcs" (unit = 1 in Excel means pieces)
  const { data: uoms } = await supabase.from("units_of_measurement").select("id, abbreviation");
  const pcsUom = uoms.find((u) => u.abbreviation === "pcs" || u.abbreviation === "nos") || uoms[0];
  console.log(`Using UOM: ${pcsUom.abbreviation} (${pcsUom.id})\n`);

  // 4. Build category/sub-category structure from Excel
  const catSubPairs = new Map(); // "Category > Sub-category" -> items[]
  for (const row of valid) {
    const cat = (row[0] || "").trim();
    const sub = (row[1] || "").trim();
    if (!cat || !sub) continue;
    const key = `${cat} > ${sub}`;
    if (!catSubPairs.has(key)) catSubPairs.set(key, []);
    catSubPairs.get(key).push(row);
  }

  console.log("Category structure from Excel:");
  for (const [key, items] of catSubPairs) {
    console.log(`  ${key}: ${items.length} items`);
  }
  console.log();

  // 5. Create/find categories in DB
  // Get existing categories
  const { data: existingCats } = await supabase
    .from("item_categories")
    .select("id, name, parent_id");

  // Top-level categories needed
  const topLevelNames = [...new Set(valid.map((r) => (r[0] || "").trim()).filter(Boolean))];
  const subCatNames = [...catSubPairs.keys()];

  const catIdMap = {}; // "Category > Sub-category" -> category_id

  for (const topName of topLevelNames) {
    // Find or create top-level category
    let topCat = existingCats.find((c) => c.name === topName && !c.parent_id);
    if (!topCat) {
      console.log(`Creating top-level category: ${topName}`);
      if (!DRY_RUN) {
        const { data, error } = await supabase
          .from("item_categories")
          .insert({ name: topName })
          .select("id, name, parent_id")
          .single();
        if (error) throw error;
        topCat = data;
        existingCats.push(topCat);
      }
    } else {
      console.log(`Found top-level category: ${topName} (${topCat.id})`);
    }

    // Find/create sub-categories under this top-level
    const subsForTop = [...catSubPairs.keys()]
      .filter((k) => k.startsWith(topName + " > "))
      .map((k) => k.split(" > ")[1]);

    for (const subName of subsForTop) {
      const fullKey = `${topName} > ${subName}`;
      let subCat = existingCats.find(
        (c) => c.name === subName && c.parent_id === topCat.id
      );
      if (!subCat) {
        console.log(`  Creating sub-category: ${subName} (under ${topName})`);
        if (!DRY_RUN) {
          const { data, error } = await supabase
            .from("item_categories")
            .insert({ name: subName, parent_id: topCat.id })
            .select("id, name, parent_id")
            .single();
          if (error) throw error;
          subCat = data;
          existingCats.push(subCat);
        }
      } else {
        console.log(`  Found sub-category: ${subName} (${subCat.id})`);
      }
      catIdMap[fullKey] = subCat?.id;
    }
  }
  console.log();

  // 6. Get all existing items by lookup_key for matching
  const { data: allItems } = await supabase.from("items").select("id, code, name, lookup_key, category_id, item_type");
  const lookupMap = {};
  for (const item of allItems) {
    if (item.lookup_key) lookupMap[item.lookup_key] = item;
  }

  // 7. Process each Excel row
  let created = 0, updated = 0, skipped = 0;
  let codeCounter = {};

  // Generate codes like DP-MT-001, DP-CO-001, etc.
  function genCode(cat, sub) {
    const catPrefix = {
      "Landing Door Pannel": "LP",
      "Car Door Pannel": "CP",
      "Collapsible Door": "CD",
      "Imperforated Door": "ID",
      "By Parting Door": "BP",
    };
    const subPrefix = {
      "Manual Telescopic": "MT",
      "Centre Opening": "CO",
      "Auto Telescopic": "AT",
      "Auto Four Fold": "AF",
      "Collapsible Door": "CD",
      "Imperforated Door": "ID",
      "By Parting Door": "BP",
    };
    const prefix = `DP-${catPrefix[cat] || "XX"}-${subPrefix[sub] || "XX"}`;
    if (!codeCounter[prefix]) codeCounter[prefix] = 0;
    codeCounter[prefix]++;
    return `${prefix}-${String(codeCounter[prefix]).padStart(3, "0")}`;
  }

  const toCreate = [];
  const toUpdate = [];
  const inventoryUpdates = [];

  for (const row of valid) {
    const cat = (row[0] || "").trim();
    const sub = (row[1] || "").trim();
    const spec = (row[2] || "").trim();
    const lookupKey = String(row[3]).trim();
    const inventory = Number(row[5]) || 0;

    if (!cat || !sub || !lookupKey) {
      skipped++;
      continue;
    }

    const fullKey = `${cat} > ${sub}`;
    const categoryId = catIdMap[fullKey];

    const existing = lookupMap[lookupKey];
    if (existing) {
      // Update: set category, item_type
      toUpdate.push({
        id: existing.id,
        category_id: categoryId,
        item_type: "door_panel",
      });
      if (inventory > 0) {
        inventoryUpdates.push({
          item_id: existing.id,
          quantity: inventory,
        });
      }
      updated++;
    } else {
      // Create new item
      const code = genCode(cat, sub);
      toCreate.push({
        code,
        name: spec || lookupKey,
        lookup_key: lookupKey,
        item_type: "door_panel",
        category_id: categoryId,
        uom_id: pcsUom.id,
        minimum_stock: 0,
        reorder_point: 0,
        lead_time_days: 0,
        cost_price: 0,
      });
      if (inventory > 0) {
        inventoryUpdates.push({
          lookup_key: lookupKey,
          quantity: inventory,
        });
      }
      created++;
    }
  }

  console.log(`\nSummary:`);
  console.log(`  To create: ${created}`);
  console.log(`  To update: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Inventory entries with stock > 0: ${inventoryUpdates.length}\n`);

  if (DRY_RUN) {
    console.log("DRY RUN — no changes made");
    console.log("\nSample creates:", JSON.stringify(toCreate.slice(0, 3), null, 2));
    console.log("\nSample updates:", JSON.stringify(toUpdate.slice(0, 3), null, 2));
    return;
  }

  // 8. Execute updates (existing items)
  if (toUpdate.length > 0) {
    console.log("Updating existing items...");
    for (const upd of toUpdate) {
      const { error } = await supabase
        .from("items")
        .update({ category_id: upd.category_id, item_type: upd.item_type })
        .eq("id", upd.id);
      if (error) console.error("Update error:", upd.id, error.message);
    }
    console.log(`  Updated ${toUpdate.length} items`);
  }

  // 9. Execute inserts (new items) in batches
  if (toCreate.length > 0) {
    console.log("Creating new items...");
    const BATCH = 100;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      const batch = toCreate.slice(i, i + BATCH);
      const { data: inserted, error } = await supabase
        .from("items")
        .insert(batch)
        .select("id, lookup_key");
      if (error) {
        console.error("Insert error at batch", i, error.message);
        continue;
      }
      // Map back lookup_key -> id for inventory
      for (const item of inserted) {
        const invEntry = inventoryUpdates.find(
          (inv) => inv.lookup_key === item.lookup_key
        );
        if (invEntry) {
          invEntry.item_id = item.id;
          delete invEntry.lookup_key;
        }
      }
    }
    console.log(`  Created ${toCreate.length} items`);
  }

  // 10. Set inventory
  const invWithId = inventoryUpdates.filter((inv) => inv.item_id && inv.quantity > 0);
  if (invWithId.length > 0) {
    console.log(`\nSetting inventory for ${invWithId.length} items...`);
    for (const inv of invWithId) {
      // Check if inventory record exists
      const { data: existing } = await supabase
        .from("inventory")
        .select("id, quantity")
        .eq("item_id", inv.item_id)
        .eq("warehouse_id", warehouse.id)
        .single();

      if (existing) {
        const { error } = await supabase
          .from("inventory")
          .update({ quantity: inv.quantity })
          .eq("id", existing.id);
        if (error) console.error("Inventory update error:", error.message);
      } else {
        const { error } = await supabase.from("inventory").insert({
          item_id: inv.item_id,
          warehouse_id: warehouse.id,
          quantity: inv.quantity,
        });
        if (error) console.error("Inventory insert error:", error.message);
      }
    }
    console.log(`  Done`);
  }

  // Final count
  const { count } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("item_type", "door_panel");
  console.log(`\nTotal door_panel items in DB: ${count}`);
}

main().catch(console.error);
