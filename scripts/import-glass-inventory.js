/**
 * Import Glass Inventory from Excel
 * 1. Create "Glass" category + subcategories
 * 2. Create 55 glass items (type = raw_material)
 * 3. Set inventory quantities in Raw Material Store
 * 4. Re-check unresolved BOM lines
 */

const XLSX = require('xlsx');
const path = require('path');

const SUPABASE_URL = 'https://qwzisnmueuqnzzokkpmn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14';

async function supaFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=minimal',
      ...options.headers
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  if (options.prefer === 'return=representation' || (!options.method || options.method === 'GET')) {
    return res.json();
  }
  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  GLASS INVENTORY IMPORT');
  console.log('═══════════════════════════════════════════════════\n');

  // ─── Read Excel ───────────────────────────────────────
  const xlPath = path.join('C:', 'Users', 'yash_', 'OneDrive', 'Desktop', 'Glass Inventory.xlsx');
  const wb = XLSX.readFile(xlPath, { type: 'file' });
  const ws = wb.Sheets['Sheet1'];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const rows = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row || !row[2]) continue;
    rows.push({
      category: String(row[0] || '').trim(),
      subcategory: String(row[1] || '').trim(),
      lookup_key: String(row[2]).trim(),
      unit: String(row[3] || '1').trim(),
      inventory: row[4],
    });
  }
  console.log(`Excel rows: ${rows.length}`);

  // ─── Create Categories ────────────────────────────────
  console.log('\nCreating categories...');

  // Parent: "Glass"
  let glassCat = await supaFetch('item_categories?name=eq.Glass&select=id&limit=1');
  let glassCatId;
  if (glassCat.length > 0) {
    glassCatId = glassCat[0].id;
    console.log(`  "Glass" category exists: ${glassCatId}`);
  } else {
    const created = await supaFetch('item_categories', {
      method: 'POST',
      body: JSON.stringify({ name: 'Glass', parent_id: null }),
      prefer: 'return=representation'
    });
    glassCatId = created[0].id;
    console.log(`  Created "Glass" category: ${glassCatId}`);
  }

  // Subcategories
  const subcats = [...new Set(rows.map(r => r.subcategory))];
  console.log(`  Subcategories: ${subcats.join(', ')}`);

  const subcatIds = {};
  for (const subcat of subcats) {
    const existing = await supaFetch(`item_categories?name=eq.${encodeURIComponent(subcat)}&parent_id=eq.${glassCatId}&select=id&limit=1`);
    if (existing.length > 0) {
      subcatIds[subcat] = existing[0].id;
      console.log(`  "${subcat}" exists: ${existing[0].id}`);
    } else {
      const created = await supaFetch('item_categories', {
        method: 'POST',
        body: JSON.stringify({ name: subcat, parent_id: glassCatId }),
        prefer: 'return=representation'
      });
      subcatIds[subcat] = created[0].id;
      console.log(`  Created "${subcat}": ${created[0].id}`);
    }
  }

  // ─── Unit mapping ─────────────────────────────────────
  // Excel unit = "1" which means per piece
  const PIECES_UOM_ID = '9ed3b796-f2a3-4336-8479-6db47c7a95ef';
  const RAW_MATERIAL_STORE_ID = 'f7978405-e499-4511-8875-2408b4116a29';

  // ─── Create Items ─────────────────────────────────────
  console.log('\nCreating items...');

  // Check for duplicates first
  const existingItems = await supaFetch('items?lookup_key=ilike.*glass*&select=id,lookup_key&limit=200');
  const existingSet = new Set(existingItems.map(i => i.lookup_key.toLowerCase().trim()));

  let created = 0;
  let skipped = 0;
  const itemIds = []; // { lookup_key, id, inventory }

  for (const row of rows) {
    if (existingSet.has(row.lookup_key.toLowerCase().trim())) {
      console.log(`  Skipped (exists): "${row.lookup_key}"`);
      skipped++;
      continue;
    }

    // Generate code from lookup_key
    const code = 'GLASS-' + String(created + 1).padStart(3, '0');

    try {
      const result = await supaFetch('items', {
        method: 'POST',
        body: JSON.stringify({
          code: code,
          name: row.lookup_key,
          lookup_key: row.lookup_key,
          item_type: 'raw_material',
          category_id: subcatIds[row.subcategory] || glassCatId,
          uom_id: PIECES_UOM_ID,
          minimum_stock: 0,
          reorder_point: 0,
          lead_time_days: 7,
          cost_price: 0,
          is_active: true,
        }),
        prefer: 'return=representation'
      });

      const itemId = result[0].id;
      let invQty = 0;
      if (row.inventory !== null && row.inventory !== undefined && row.inventory !== '-' && row.inventory !== '') {
        const parsed = parseInt(String(row.inventory).trim());
        if (!isNaN(parsed) && parsed > 0) invQty = parsed;
      }

      itemIds.push({ lookup_key: row.lookup_key, id: itemId, inventory: invQty });
      created++;
    } catch (err) {
      console.error(`  Error creating "${row.lookup_key}": ${err.message}`);
    }
  }

  console.log(`  Created: ${created}, Skipped: ${skipped}`);

  // ─── Set Inventory Quantities ─────────────────────────
  console.log('\nSetting inventory quantities...');

  let invCreated = 0;
  for (const item of itemIds) {
    if (item.inventory <= 0) continue;

    try {
      // Check if inventory record exists
      const existing = await supaFetch(`inventory?item_id=eq.${item.id}&warehouse_id=eq.${RAW_MATERIAL_STORE_ID}&select=id&limit=1`);
      if (existing.length > 0) {
        await supaFetch(`inventory?id=eq.${existing[0].id}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity: item.inventory })
        });
      } else {
        await supaFetch('inventory', {
          method: 'POST',
          body: JSON.stringify({
            item_id: item.id,
            warehouse_id: RAW_MATERIAL_STORE_ID,
            quantity: item.inventory
          })
        });
      }
      invCreated++;
    } catch (err) {
      console.error(`  Inventory error for "${item.lookup_key}": ${err.message}`);
    }
  }
  console.log(`  Inventory records set: ${invCreated}`);

  // ─── Print all created items ──────────────────────────
  console.log('\nAll glass items created:');
  for (const item of itemIds) {
    console.log(`  "${item.lookup_key}" → inv=${item.inventory}`);
  }

  // ─── Now check: can we resolve any of the 207 unresolved BOM lines? ───
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  CHECKING BOM LINE RESOLUTION');
  console.log('═══════════════════════════════════════════════════\n');

  // Reload all items
  let allItems = [];
  let offset = 0;
  while (true) {
    const batch = await supaFetch(`items?select=id,lookup_key&limit=1000&offset=${offset}`);
    allItems.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  const itemByKey = new Map();
  for (const item of allItems) {
    if (item.lookup_key) itemByKey.set(item.lookup_key, item);
  }

  // Get unresolved BOM lines
  let noItemLines = [];
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?item_id=is.null&select=id,category,variant,value_text,source_col_index&limit=1000&offset=${offset}`);
    noItemLines.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`Unresolved BOM lines: ${noItemLines.length}`);

  // The "Cabin Glass" BOM lines (col QG=448) have variant="QG" and no value_text
  // These are quantity columns — the cell value is how many cabin glasses needed
  // The column's match rule was `icontains: "Cabin Glass"` which now matches multiple items
  // We need a different approach: Cabin Glass is a specific item type
  //
  // For the TARGET sheet, col QG is a single quantity column. In the factory,
  // "Cabin Glass" is one specific item per job. Let's check if there's a
  // dominant/default cabin glass item, or if we need a spec-lookup approach.
  //
  // Looking at the glass inventory: "10 mm (2390x860) Cabin Glass" is the only
  // one with subcategory "Cabin Glass" that has a specific lookup. But there are
  // many cabin glass sizes.
  //
  // For now: the Cabin Glass column in TARGET just tells "how many" — the specific
  // size is determined per job, not auto-resolvable. These 22 lines will stay unresolved.
  //
  // However, if ANY value_text matches a glass item, we can resolve those.

  let resolved = 0;
  for (const line of noItemLines) {
    // Check value_text against all items
    if (line.value_text) {
      const item = itemByKey.get(line.value_text);
      if (item) {
        await supaFetch(`job_bom_lines?id=eq.${line.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ item_id: item.id })
        });
        resolved++;
        console.log(`  Resolved: "${line.value_text}" → ${item.lookup_key}`);
        continue;
      }
      // Try case-insensitive
      for (const [key, item2] of itemByKey) {
        if (key.toLowerCase().trim() === line.value_text.toLowerCase().trim()) {
          await supaFetch(`job_bom_lines?id=eq.${line.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ item_id: item2.id })
          });
          resolved++;
          console.log(`  Resolved (icase): "${line.value_text}" → ${item2.lookup_key}`);
          break;
        }
      }
    }
  }

  console.log(`\nBOM lines resolved by glass items: ${resolved}`);

  // Final count
  let finalNoItem = 0;
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?item_id=is.null&select=id&limit=1000&offset=${offset}`);
    finalNoItem += batch.length;
    if (batch.length < 1000) break;
    offset += 1000;
  }
  let finalTotal = 0;
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?select=id&limit=1000&offset=${offset}`);
    finalTotal += batch.length;
    if (batch.length < 1000) break;
    offset += 1000;
  }

  console.log(`\nTotal BOM lines: ${finalTotal}`);
  console.log(`With item_id: ${finalTotal - finalNoItem}`);
  console.log(`Without item_id: ${finalNoItem}`);
  console.log(`Resolution rate: ${((finalTotal - finalNoItem) / finalTotal * 100).toFixed(1)}%`);

  // Breakdown remaining
  let remaining = [];
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?item_id=is.null&select=id,category,variant,value_text,source_col_index&limit=1000&offset=${offset}`);
    remaining.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  const byCat = {};
  for (const l of remaining) {
    const cat = l.category || 'NULL';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(l);
  }
  console.log('\nRemaining unresolved:');
  for (const [cat, lines] of Object.entries(byCat).sort((a,b) => b[1].length - a[1].length)) {
    const unique = new Map();
    for (const l of lines) {
      const key = l.value_text || l.variant || `col-${l.source_col_index}`;
      unique.set(key, (unique.get(key) || 0) + 1);
    }
    console.log(`  ${cat}: ${lines.length}`);
    for (const [key, cnt] of [...unique.entries()].sort((a,b) => b[1] - a[1])) {
      console.log(`    "${key}" (${cnt}x)`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  DONE');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
