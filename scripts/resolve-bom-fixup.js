/**
 * Fix-up script for remaining BOM resolution gaps
 *
 * 1. Fire headers: space mismatch "CO 900mm (Fire)" → "CO 900mm(Fire)"
 * 2. CO 600mm lintons: "Auto Door Linton Pannel CO" → "SO" prefix for 600mm
 * 3. Missing CO/AT/AFF panels: report items not in inventory (uncommon sizes/materials)
 * 4. Machine "4P" code: not in Trade map — check if item exists with "4 pass" pattern
 * 5. Pulley Counter Spec: fix duplicate constraint by using "Pulley_Counter" category
 * 6. CO 600mm headers: not in inventory — need to be created
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

function colLetterToIndex(letter) {
  let idx = 0;
  for (let i = 0; i < letter.length; i++) {
    idx = idx * 26 + (letter.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function indexToColLetter(idx) {
  let s = '';
  idx += 1;
  while (idx > 0) {
    idx--;
    s = String.fromCharCode(65 + (idx % 26)) + s;
    idx = Math.floor(idx / 26);
  }
  return s;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  BOM FIX-UP SCRIPT');
  console.log('═══════════════════════════════════════════════════\n');

  // Load items
  let items = [];
  let offset = 0;
  while (true) {
    const batch = await supaFetch(`items?select=id,lookup_key&limit=1000&offset=${offset}`);
    items.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  const itemByKey = new Map();
  for (const item of items) {
    if (item.lookup_key) itemByKey.set(item.lookup_key, item);
  }
  // Also build normalized map (collapsed whitespace)
  const itemByNormKey = new Map();
  for (const item of items) {
    if (item.lookup_key) {
      itemByNormKey.set(item.lookup_key.replace(/\s+/g, ' ').trim().toLowerCase(), item);
    }
  }
  console.log(`Items: ${items.length}`);

  function findItem(key) {
    let item = itemByKey.get(key);
    if (item) return item;
    const norm = key.replace(/\s+/g, ' ').trim().toLowerCase();
    item = itemByNormKey.get(norm);
    if (item) return item;
    return null;
  }

  // Load BOM lines without item_id
  let noItemLines = [];
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?item_id=is.null&select=id,job_bom_id,category,variant,value_text,source_col_index,required_quantity&limit=1000&offset=${offset}`);
    noItemLines.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`Lines without item_id: ${noItemLines.length}`);

  // Load jobs and bom headers
  let bomHeaders = [];
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_headers?select=id,job_id&limit=1000&offset=${offset}`);
    bomHeaders.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  const headerToJob = new Map();
  for (const h of bomHeaders) headerToJob.set(h.id, h.job_id);

  let jobs = [];
  offset = 0;
  while (true) {
    const batch = await supaFetch(`jobs?select=id,job_number,door_finish&limit=1000&offset=${offset}`);
    jobs.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  const jobById = new Map();
  for (const j of jobs) jobById.set(j.id, j);

  // Read Excel for lookup maps
  const xlPath = path.join('C:', 'Users', 'yash_', 'OneDrive', 'Desktop', 'Target (27052027).xlsx');
  const wb = XLSX.readFile(xlPath, { type: 'file' });
  const ws = wb.Sheets['TARGET'] || wb.Sheets[wb.SheetNames[0]];
  const targetData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const jobRowMap = new Map();
  for (let r = 5; r < targetData.length; r++) {
    const row = targetData[r];
    if (!row || !row[1]) continue;
    jobRowMap.set(String(row[1]).trim(), r);
  }

  const tradeWs = wb.Sheets['Trade'] || wb.Sheets['TRADE'];
  const tradeData = XLSX.utils.sheet_to_json(tradeWs, { header: 1, defval: null });
  const tradeMap = new Map();
  for (let r = 1; r < tradeData.length; r++) {
    const row = tradeData[r];
    if (!row) continue;
    const shortCode = row[0] ? String(row[0]).trim() : null;
    const fullName = row[3] ? String(row[3]).trim() : null;
    if (shortCode && fullName) tradeMap.set(shortCode, fullName);
  }

  let updated = 0;
  let created = 0;

  // ─── Fix 1: Fire header space mismatch ────────────────
  console.log('\n--- Fix 1: Fire header space mismatch ---');
  const fireHeaderFixes = {
    'Car Header System CO 900mm (Fire)': 'Car Header System CO 900mm(Fire)',
    'Car Header System CO 1000mm (Fire)': 'Car Header System CO 1000mm(Fire)',
    'Landing Header System CO 900mm (Fire)': 'Landing Header System CO 900mm(Fire)',
    'Landing Header System CO 1000mm (Fire)': 'Landing Header System CO 1000mm(Fire)',
    'Landing Header System CO 800mm(Fire)': 'Landing Header System CO 800mm(Fire)',
  };

  for (const line of noItemLines) {
    if (line.category !== 'HEADER_SYSTEM') continue;
    if (!line.value_text) continue;
    const fixedKey = fireHeaderFixes[line.value_text];
    if (fixedKey) {
      const item = findItem(fixedKey);
      if (item) {
        await supaFetch(`job_bom_lines?id=eq.${line.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ item_id: item.id })
        });
        console.log(`  Fixed: "${line.value_text}" → ${item.lookup_key}`);
        updated++;
      }
    }
  }

  // ─── Fix 2: CO 600mm lintons → SO prefix ──────────────
  console.log('\n--- Fix 2: CO 600mm lintons → SO prefix ---');
  for (const line of noItemLines) {
    if (!line.value_text) continue;
    if (line.value_text.includes('Linton Pannel CO') && line.value_text.includes('600mm')) {
      // "Auto Door Linton Pannel CO MS/600mm" → "Auto Door Linton Pannel SO MS/600mm"
      const fixedKey = line.value_text.replace('Linton Pannel CO', 'Linton Pannel SO');
      const item = findItem(fixedKey);
      if (item) {
        await supaFetch(`job_bom_lines?id=eq.${line.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ item_id: item.id })
        });
        console.log(`  Fixed: "${line.value_text}" → ${item.lookup_key}`);
        updated++;
      } else {
        console.log(`  Still no match: "${fixedKey}"`);
      }
    }
  }

  // ─── Fix 3: AT panels with MS → check if MS variant exists ────
  console.log('\n--- Fix 3: AT/CO/AFF missing MS material panels ---');
  // These panels exist in SS but not MS for certain sizes
  // "Car Pannel AT/MS/MV/1200" → doesn't exist (only SS/NV/1200)
  // For these, the closest match is the SS variant — but that's wrong.
  // These are items that genuinely don't exist yet. Report them.
  const missingPanels = new Map();
  for (const line of noItemLines) {
    if (!['AT_DOOR', 'CO_DOOR', 'AFF_DOOR'].includes(line.category)) continue;
    if (!line.value_text || line.value_text.includes('{mat}')) continue; // already resolved pattern
    missingPanels.set(line.value_text, (missingPanels.get(line.value_text) || 0) + 1);
  }
  console.log(`  Missing panel items (not in inventory):`);
  for (const [key, cnt] of missingPanels) {
    console.log(`    "${key}" (${cnt} lines)`);
  }

  // ─── Fix 4: Machine "4P" → find/create mapping ────────
  console.log('\n--- Fix 4: Machine "4P" lookup ---');
  // "4P" is not in Trade map. Check if there's a "4 pass" machine unit
  const machineUnit4P = items.find(i =>
    i.lookup_key && i.lookup_key.toLowerCase().includes('machine unit') &&
    (i.lookup_key.includes('4 pass') || i.lookup_key.includes('4 Pass'))
  );
  if (machineUnit4P) {
    console.log(`  Found 4P item: "${machineUnit4P.lookup_key}"`);
  } else {
    // Check for "Machine Unit 6 Pass/200mm" as the closest match (4-pass home elevators use smaller machines)
    // Actually, 4P likely means 4-passenger which is the home elevator standard
    // Home machines are different — check "Machine Unit ECO Space" or similar
    const homeTypes = items.filter(i =>
      i.lookup_key && i.lookup_key.toLowerCase().includes('machine unit') &&
      (i.lookup_key.includes('ECO') || i.lookup_key.includes('Home') || i.lookup_key.includes('home'))
    );
    console.log(`  No "4 pass" machine found. Home/ECO machines:`);
    for (const h of homeTypes) console.log(`    "${h.lookup_key}"`);
    console.log(`  "4P" (42 jobs) cannot be auto-resolved — needs manual mapping`);
  }

  // ─── Fix 5: Pulley Counter Spec — fix unique constraint ────
  console.log('\n--- Fix 5: Pulley Counter Spec (duplicate fix) ---');
  // The issue: Pulley Main and Pulley Counter both had category "Pulley" and same variant,
  // causing unique constraint violation. Fix: update existing Pulley Main to "Pulley_Main"
  // and insert Counter as "Pulley_Counter"

  // First update existing Pulley lines to use "Pulley_Main" category
  const pulleyMainCol = colLetterToIndex('MV'); // 359
  const pulleyCounterCol = colLetterToIndex('MX'); // 361

  const existingPulleyMain = await supaFetch(`job_bom_lines?source_col_index=eq.${pulleyMainCol}&category=eq.Pulley&select=id&limit=200`);
  if (existingPulleyMain.length > 0) {
    for (const line of existingPulleyMain) {
      await supaFetch(`job_bom_lines?id=eq.${line.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ category: 'Pulley_Main' })
      });
    }
    console.log(`  Updated ${existingPulleyMain.length} Pulley Main lines to category "Pulley_Main"`);
  }

  // Now insert Pulley Counter lines
  const jobToBomHeader = new Map();
  for (const h of bomHeaders) jobToBomHeader.set(h.job_id, h.id);

  // Check which jobs already have a Pulley Counter line
  const existingCounterLines = await supaFetch(`job_bom_lines?source_col_index=eq.${pulleyCounterCol}&select=job_bom_id&limit=500`);
  const existingCounterSet = new Set(existingCounterLines.map(l => l.job_bom_id));

  const counterLines = [];
  let counterResolved = 0;
  let counterNoSpec = 0;

  for (const job of jobs) {
    const bomHeaderId = jobToBomHeader.get(job.id);
    if (!bomHeaderId) continue;
    if (existingCounterSet.has(bomHeaderId)) continue;

    const targetRow = jobRowMap.get(job.job_number);
    if (targetRow === undefined) continue;

    const specValue = targetData[targetRow] ? targetData[targetRow][pulleyCounterCol] : null;
    if (!specValue || specValue === '' || specValue === 0) continue;

    const specCode = String(specValue).trim();
    const fullName = tradeMap.get(specCode);
    if (!fullName) {
      counterNoSpec++;
      continue;
    }

    const item = findItem(fullName);
    counterLines.push({
      job_bom_id: bomHeaderId,
      item_id: item ? item.id : null,
      required_quantity: 1,
      issued_quantity: 0,
      wastage_percent: 0,
      sort_order: 9361,
      source_col_index: pulleyCounterCol,
      category: 'Pulley_Counter',
      variant: specCode,
      value_text: fullName,
    });
    if (item) counterResolved++;
  }

  if (counterLines.length > 0) {
    for (let b = 0; b < counterLines.length; b += 200) {
      const batch = counterLines.slice(b, b + 200);
      try {
        await supaFetch('job_bom_lines', {
          method: 'POST',
          body: JSON.stringify(batch)
        });
        created += batch.length;
      } catch (err) {
        console.error(`  Insert error: ${err.message}`);
      }
    }
    console.log(`  Created ${counterLines.length} Pulley Counter lines (${counterResolved} with item_id)`);
  } else {
    console.log(`  No new Pulley Counter lines to create (${existingCounterSet.size} already exist)`);
  }

  // ─── Final Recount ────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  FIX-UP SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Lines updated with item_id: ${updated}`);
  console.log(`  New lines created: ${created}`);

  // Final counts
  let finalNoItem = 0;
  let finalTotal = 0;
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?item_id=is.null&select=id&limit=1000&offset=${offset}`);
    finalNoItem += batch.length;
    if (batch.length < 1000) break;
    offset += 1000;
  }
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?select=id&limit=1000&offset=${offset}`);
    finalTotal += batch.length;
    if (batch.length < 1000) break;
    offset += 1000;
  }

  console.log(`\n  Total BOM lines: ${finalTotal}`);
  console.log(`  With item_id: ${finalTotal - finalNoItem}`);
  console.log(`  Without item_id: ${finalNoItem}`);
  console.log(`  Resolution rate: ${((finalTotal - finalNoItem) / finalTotal * 100).toFixed(1)}%`);

  // Breakdown of remaining no-item lines
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
  console.log('\n  Remaining unresolved by category:');
  for (const [cat, lines] of Object.entries(byCat).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${cat}: ${lines.length}`);
    // Show unique value_text/variant
    const unique = new Map();
    for (const l of lines) {
      const key = l.value_text || l.variant || `col-${l.source_col_index}`;
      unique.set(key, (unique.get(key) || 0) + 1);
    }
    for (const [key, cnt] of [...unique.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`      "${key}" (${cnt}x)`);
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
