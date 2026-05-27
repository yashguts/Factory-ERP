/**
 * Fix-up 2: Resolve remaining BOM items
 * - Machine 4P → "Machine Unit 4 pass/200mm/4g/6mm/Home"
 * - Hydraulic Packs
 * - Safety Frame CANTI LEAVER items
 * - Governor 1/RH and .5/LH/RH
 */

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
  // Load items
  let items = [];
  let offset = 0;
  while (true) {
    const batch = await supaFetch(`items?select=id,lookup_key&limit=1000&offset=${offset}`);
    items.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`Items: ${items.length}`);

  const itemByKey = new Map();
  for (const item of items) {
    if (item.lookup_key) itemByKey.set(item.lookup_key, item);
  }

  function findItem(key) {
    let item = itemByKey.get(key);
    if (item) return item;
    for (const [k, v] of itemByKey) {
      if (k.replace(/\s+/g, ' ').trim().toLowerCase() === key.replace(/\s+/g, ' ').trim().toLowerCase()) return v;
    }
    return null;
  }

  let updated = 0;

  // ─── 1. Machine 4P ────────────────────────────────────
  console.log('\n--- Machine 4P ---');
  const machine4P = findItem('Machine Unit 4 pass/200mm/4g/6mm/Home');
  if (machine4P) {
    const lines = await supaFetch('job_bom_lines?item_id=is.null&category=eq.Machine&variant=eq.4P&select=id&limit=200');
    console.log(`  Found ${lines.length} lines with variant=4P`);
    for (const l of lines) {
      await supaFetch(`job_bom_lines?id=eq.${l.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ item_id: machine4P.id })
      });
      updated++;
    }
    console.log(`  Updated ${lines.length} → "${machine4P.lookup_key}"`);
  } else {
    console.log('  Item not found!');
  }

  // ─── 2. Hydraulic Packs ───────────────────────────────
  console.log('\n--- Hydraulic Packs ---');
  // Search for hydraulic items
  const hydItems = items.filter(i => i.lookup_key &&
    (i.lookup_key.toLowerCase().includes('hydro') || i.lookup_key.toLowerCase().includes('hydraul')));
  console.log(`  Hydraulic items in inventory:`);
  for (const h of hydItems) console.log(`    "${h.lookup_key}"`);

  // Try to match "HYDROLIC PACK" and "HYDROLIC PACK 500KG"
  const hydPack = findItem('HYDROLIC PACK');
  const hydPack500 = findItem('HYDROLIC PACK 500KG');

  if (!hydPack) {
    // These don't exist yet — check by value_text
    const hydLines = await supaFetch(`job_bom_lines?item_id=is.null&category=eq.Machine&value_text=eq.HYDROLIC%20PACK&select=id&limit=200`);
    console.log(`  "HYDROLIC PACK" not in items. ${hydLines.length} BOM lines need it.`);
  }
  if (!hydPack500) {
    const hydLines500 = await supaFetch(`job_bom_lines?item_id=is.null&category=eq.Machine&value_text=eq.HYDROLIC%20PACK%20500KG&select=id&limit=200`);
    console.log(`  "HYDROLIC PACK 500KG" not in items. ${hydLines500.length} BOM lines need it.`);
  }

  // ─── 3. Safety Frame CANTI LEAVER ─────────────────────
  console.log('\n--- Safety Frame CANTI LEAVER ---');
  const cantiKeys = [
    'Safety Frame CANTI LEAVER DBG-700 HYDROLIC',
    'Safety Frame CANTI LEAVER DBG-600 HYDROLIC',
    'Safety Frame Cantiliver DBG-820',
    'Safety Frame Cantiliver DBG-720',
  ];
  for (const key of cantiKeys) {
    const item = findItem(key);
    if (item) {
      // URL-encode the value_text for querying
      const encoded = encodeURIComponent(key);
      const lines = await supaFetch(`job_bom_lines?item_id=is.null&category=eq.Safety&value_text=eq.${encoded}&select=id&limit=50`);
      for (const l of lines) {
        await supaFetch(`job_bom_lines?id=eq.${l.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ item_id: item.id })
        });
        updated++;
      }
      console.log(`  "${key}": ${lines.length} fixed`);
    } else {
      console.log(`  "${key}": NOT IN INVENTORY`);
    }
  }

  // Also check other Safety value_text items
  const safetyNoItem = await supaFetch(`job_bom_lines?item_id=is.null&category=eq.Safety&select=id,value_text,variant,source_col_index&limit=200`);
  console.log(`\n  Remaining Safety without item_id: ${safetyNoItem.length}`);
  const safetyByText = new Map();
  for (const l of safetyNoItem) {
    const key = l.value_text || l.variant || `col-${l.source_col_index}`;
    if (!safetyByText.has(key)) safetyByText.set(key, []);
    safetyByText.get(key).push(l);
  }
  for (const [text, lines] of safetyByText) {
    const item = findItem(text);
    if (item) {
      for (const l of lines) {
        await supaFetch(`job_bom_lines?id=eq.${l.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ item_id: item.id })
        });
        updated++;
      }
      console.log(`  "${text}": ${lines.length} fixed → "${item.lookup_key}"`);
    } else {
      console.log(`  "${text}": ${lines.length} lines — NOT in inventory`);
    }
  }

  // ─── 4. Governor ──────────────────────────────────────
  console.log('\n--- Governor ---');
  const govItems = items.filter(i => i.lookup_key && i.lookup_key.toLowerCase().includes('governor'));
  console.log(`  Governor items in inventory:`);
  for (const g of govItems) console.log(`    "${g.lookup_key}"`);

  // 1/RH → Speed Governor 1mts (or 1mts R1 if no non-R1 exists)
  const gov1 = findItem('Speed Governor 1mts');
  const gov1r1 = findItem('Speed Governor 1mts R1');
  const govToUse = gov1 || gov1r1;
  if (govToUse) {
    const lines = await supaFetch(`job_bom_lines?item_id=is.null&category=eq.Governor&variant=eq.1/RH&select=id&limit=50`);
    for (const l of lines) {
      await supaFetch(`job_bom_lines?id=eq.${l.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ item_id: govToUse.id })
      });
      updated++;
    }
    console.log(`  "1/RH": ${lines.length} fixed → "${govToUse.lookup_key}"`);
  }

  // .5/LH/RH → Speed Governor 0.5mts
  const gov05 = findItem('Speed Governor 0.5mts');
  if (gov05) {
    const lines = await supaFetch(`job_bom_lines?item_id=is.null&category=eq.Governor&variant=eq..5/LH/RH&select=id&limit=50`);
    for (const l of lines) {
      await supaFetch(`job_bom_lines?id=eq.${l.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ item_id: gov05.id })
      });
      updated++;
    }
    console.log(`  ".5/LH/RH": ${lines.length} fixed → "${gov05.lookup_key}"`);
  }

  // ─── Final Count ──────────────────────────────────────
  console.log(`\n=== DONE: ${updated} lines updated ===`);

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
  console.log(`Total BOM lines: ${finalTotal}`);
  console.log(`With item_id: ${finalTotal - finalNoItem}`);
  console.log(`Without item_id: ${finalNoItem}`);
  console.log(`Resolution rate: ${((finalTotal - finalNoItem) / finalTotal * 100).toFixed(1)}%`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
