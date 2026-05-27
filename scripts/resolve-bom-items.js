/**
 * Resolve BOM Lines → Inventory Items
 *
 * Phase 1: Fix existing 629 BOM lines without item_id
 *   - HEADER_SYSTEM (176): exact match value_text → item lookup_key
 *   - CO_DOOR / AT_DOOR / AFF_DOOR (150): resolve {mat} placeholder → match
 *   - COLLAPSIBLE_DOOR (12): exact match value_text → item
 *   - MAIN BRACKET (17): map R1/B variants to actual inventory items
 *   - Cabin Items (146): report missing items
 *   - Safety (128): resolve pulley qty via adjacent spec column + counter frames
 *
 * Phase 2: Add spec-lookup columns (Safety DBG, Machine, Governor, Pulley Main/Counter)
 *   - Read cell VALUE = short code → Trade/Production map → full item name → item_id
 *   - Create new BOM lines for these columns
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
  console.log('  BOM LINE RESOLVER');
  console.log('═══════════════════════════════════════════════════\n');

  // ─── Load Data ──────────────────────────────────────
  console.log('Loading data...');

  // 1. Fetch all items
  let items = [];
  let offset = 0;
  while (true) {
    const batch = await supaFetch(`items?select=id,lookup_key,name,code&limit=1000&offset=${offset}`);
    items.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`  Items: ${items.length}`);

  // Build lookup maps
  const itemByExactKey = new Map();
  const itemByLowerKey = new Map();
  for (const item of items) {
    if (item.lookup_key) {
      itemByExactKey.set(item.lookup_key, item);
      itemByLowerKey.set(item.lookup_key.toLowerCase().trim(), item);
    }
  }

  // 2. Fetch BOM lines without item_id
  let noItemLines = [];
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?item_id=is.null&select=id,job_bom_id,category,variant,value_text,source_col_index,required_quantity&limit=1000&offset=${offset}`);
    noItemLines.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`  BOM lines without item_id: ${noItemLines.length}`);

  // 3. Fetch all BOM headers (to get job_id)
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

  // 4. Fetch all jobs (for door_finish, spec)
  let jobs = [];
  offset = 0;
  while (true) {
    const batch = await supaFetch(`jobs?select=id,job_number,door_finish,door_type,drive_type,spec_string&limit=1000&offset=${offset}`);
    jobs.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  const jobById = new Map();
  for (const j of jobs) jobById.set(j.id, j);
  console.log(`  Jobs: ${jobs.length}`);

  // 5. Read Excel for Trade + Production maps
  const xlPath = path.join('C:', 'Users', 'yash_', 'OneDrive', 'Desktop', 'Target (27052027).xlsx');
  const wb = XLSX.readFile(xlPath, { type: 'file' });

  // Trade: Col A = short code, Col D = full lookup_key
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
  console.log(`  Trade mappings: ${tradeMap.size}`);

  // Production: Col E = code, Col F = full lookup_key
  const prodWs = wb.Sheets['Production'] || wb.Sheets['PRODUCTION'];
  const prodData = XLSX.utils.sheet_to_json(prodWs, { header: 1, defval: null });
  const prodMap = new Map();
  for (let r = 1; r < prodData.length; r++) {
    const row = prodData[r];
    if (!row) continue;
    const code = row[4] ? String(row[4]).trim() : null;
    const fullName = row[5] ? String(row[5]).trim() : null;
    if (code && fullName) prodMap.set(code, fullName);
  }
  console.log(`  Production mappings: ${prodMap.size}`);

  // 6. Read TARGET sheet for spec-lookup column values
  const ws = wb.Sheets['TARGET'] || wb.Sheets[wb.SheetNames[0]];
  const targetData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log(`  TARGET rows: ${targetData.length}`);

  // Build job_number → rowIndex map for TARGET sheet
  const jobRowMap = new Map(); // job_number → row index (0-based)
  for (let r = 5; r < targetData.length; r++) {
    const row = targetData[r];
    if (!row || !row[1]) continue;
    const jobNum = String(row[1]).trim();
    jobRowMap.set(jobNum, r);
  }

  // ─── Helper: Find item by lookup_key ──────────────────
  function findItemByKey(lookupKey) {
    if (!lookupKey) return null;
    // Exact match
    let item = itemByExactKey.get(lookupKey);
    if (item) return item;
    // Case-insensitive
    item = itemByLowerKey.get(lookupKey.toLowerCase().trim());
    if (item) return item;
    // Try normalizing whitespace (double spaces → single)
    const normalized = lookupKey.replace(/\s+/g, ' ').trim();
    item = itemByExactKey.get(normalized);
    if (item) return item;
    // Try matching with normalized spaces on both sides
    for (const [key, it] of itemByExactKey) {
      if (key.replace(/\s+/g, ' ').trim() === normalized) return it;
    }
    return null;
  }

  function findItemContains(substr) {
    const lower = substr.toLowerCase();
    return items.find(i => i.lookup_key && i.lookup_key.toLowerCase().includes(lower)) || null;
  }

  // ─── Phase 1: Resolve existing lines ──────────────────

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  PHASE 1: Resolve existing BOM lines');
  console.log('═══════════════════════════════════════════════════\n');

  const updates = []; // { id, item_id }
  const unresolved = []; // { id, category, reason }

  // Group lines by category
  const byCategory = {};
  for (const line of noItemLines) {
    const cat = line.category || 'NULL';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(line);
  }

  for (const [cat, count] of Object.entries(byCategory).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count} lines`);
  }

  // ─── 1. HEADER_SYSTEM ────────────────────────────────
  console.log('\n--- Resolving HEADER_SYSTEM ---');
  const headerLines = byCategory['HEADER_SYSTEM'] || [];
  let headerResolved = 0;
  for (const line of headerLines) {
    if (!line.value_text) {
      unresolved.push({ id: line.id, category: 'HEADER_SYSTEM', reason: 'No value_text' });
      continue;
    }
    const item = findItemByKey(line.value_text);
    if (item) {
      updates.push({ id: line.id, item_id: item.id });
      headerResolved++;
    } else {
      // Try without "(Fire)" → "(Fire)" variations
      const altKey = line.value_text.replace(/\(Fire\)/, '(Fire)');
      const item2 = findItemByKey(altKey);
      if (item2) {
        updates.push({ id: line.id, item_id: item2.id });
        headerResolved++;
      } else {
        unresolved.push({ id: line.id, category: 'HEADER_SYSTEM', reason: `No item match for "${line.value_text}"` });
      }
    }
  }
  console.log(`  Resolved: ${headerResolved}/${headerLines.length}`);

  // ─── 2. Door panels (CO/AT/AFF) with {mat} ──────────
  console.log('\n--- Resolving Door Panels ({mat} placeholder) ---');
  const doorCats = ['CO_DOOR', 'AT_DOOR', 'AFF_DOOR'];
  let doorResolved = 0;
  let doorTotal = 0;

  for (const cat of doorCats) {
    const lines = byCategory[cat] || [];
    doorTotal += lines.length;

    for (const line of lines) {
      if (!line.value_text || !line.value_text.includes('{mat}')) {
        unresolved.push({ id: line.id, category: cat, reason: `No {mat} pattern in value_text: "${line.value_text}"` });
        continue;
      }

      // Get job's door_finish
      const jobId = headerToJob.get(line.job_bom_id);
      const job = jobId ? jobById.get(jobId) : null;
      const doorFinish = (job && job.door_finish) ? job.door_finish : 'MS'; // default MS

      // Resolve {mat} → MS or SS
      const resolvedKey = line.value_text.replace('{mat}', doorFinish);

      const item = findItemByKey(resolvedKey);
      if (item) {
        updates.push({ id: line.id, item_id: item.id });
        doorResolved++;
      } else {
        // Try alternate patterns - some items have extra spaces or different format
        // e.g., "Car Pannel CO/MS/NV/700(STD)" vs actual
        const alts = [
          resolvedKey,
          resolvedKey.replace(/\s+/g, ' '),
          resolvedKey.replace('(STD)', '(BIG)'),
        ];

        let found = false;
        for (const alt of alts) {
          const item2 = findItemByKey(alt);
          if (item2) {
            updates.push({ id: line.id, item_id: item2.id });
            doorResolved++;
            found = true;
            break;
          }
        }

        if (!found) {
          unresolved.push({ id: line.id, category: cat, reason: `No item for resolved key "${resolvedKey}" (job ${job ? job.job_number : '?'}, finish=${doorFinish})` });
        }
      }
    }
  }
  console.log(`  Door panels resolved: ${doorResolved}/${doorTotal}`);

  // ─── 3. COLLAPSIBLE_DOOR ─────────────────────────────
  console.log('\n--- Resolving COLLAPSIBLE_DOOR ---');
  const collLines = byCategory['COLLAPSIBLE_DOOR'] || [];
  let collResolved = 0;

  for (const line of collLines) {
    if (!line.value_text) {
      unresolved.push({ id: line.id, category: 'COLLAPSIBLE_DOOR', reason: 'No value_text' });
      continue;
    }

    const item = findItemByKey(line.value_text);
    if (item) {
      updates.push({ id: line.id, item_id: item.id });
      collResolved++;
    } else {
      // Try alternate: "Collapsible Door Post Industrial/LHS" exact match
      unresolved.push({ id: line.id, category: 'COLLAPSIBLE_DOOR', reason: `No item for "${line.value_text}"` });
    }
  }
  console.log(`  Resolved: ${collResolved}/${collLines.length}`);

  // ─── 4. MAIN BRACKET (R1 + B variants) ──────────────
  console.log('\n--- Resolving MAIN BRACKET ---');
  const bracketLines = byCategory['MAIN BRACKET'] || [];
  let bracketResolved = 0;

  // Manual mapping for bracket variants that lacked match rules
  const bracketManualMap = {
    // R1 variants
    '710X50 R1': 'Rail Bracket Main Combination DBG-710X50X180 R1',
    '850X50 R1': 'Rail Bracket Main Combination DBG-850X50X180 R1',
    '850X65 R1': 'Rail Bracket Main Combination DBG-850X50X260 R1', // closest match
    '1050x65 R1': 'Rail Bracket Main Combination DBG-1050X65X200 R1',
    // B (300mm) variants
    '850/B': 'Rail Bracket Main Combination DBG-850(300)',
    '710/B': 'Rail Bracket Main Combination DBG-710(300)',
    '1050x50/B': 'Rail Bracket Main Combination DBG-1050X50(300)',
    // S (STD) variants — map (S) → (STD)
    '850/S': 'Rail Bracket Main Combination DBG-850(STD)',
    '850x65/S': 'Rail Bracket Main Combination DBG-850x65(STD)',
    '710/S': 'Rail Bracket Main Combination DBG-710(STD)',
    '1050x50/S': 'Rail Bracket Main Combination DBG-1050X50(STD)',
    '1050x65/S': 'Rail Bracket Main Combination DBG-1050X65(STD)',
    // 260 variants
    '850x65/260': 'Rail Bracket Main Combination DBG-850x65(260)',
    '850/260': 'Rail Bracket Main Combination DBG-850(260)',
    '710/260': 'Rail Bracket Main Combination DBG-710(260)',
    '1050x50/260': 'Rail Bracket Main Combination DBG-1050X50(260)',
    '1050x65/260': 'Rail Bracket Main Combination DBG-1050X65(260)',
  };

  for (const line of bracketLines) {
    // The variant is in the column letter (e.g., "AX" → "710X50 R1")
    // We need to figure out the variant from the source_col_index
    const colLetter = indexToColLetter(line.source_col_index);

    // Map column letters to variant names
    const colToVariant = {
      49: '710X50 R1',   // AX
      50: '850X50 R1',   // AY
      51: '850X65 R1',   // AZ
      52: '1050x65 R1',  // BA
      32: '850/B',       // AG
      35: '710/B',       // AJ
      38: '1050x50/B',   // AM
      28: '850/S',       // AC
      29: '850x65/S',    // AD
      30: '850x65/260',  // AE
      31: '850/260',     // AF
      33: '710/S',       // AH
      34: '710/260',     // AI
      36: '1050x50/S',   // AK
      37: '1050x50/260', // AL
      39: '1050x65/S',   // AN
      40: '1050x65/260', // AO
    };

    const variant = colToVariant[line.source_col_index];
    if (!variant) {
      unresolved.push({ id: line.id, category: 'MAIN BRACKET', reason: `Unknown col ${line.source_col_index} (${colLetter})` });
      continue;
    }

    const lookupKey = bracketManualMap[variant];
    if (!lookupKey) {
      unresolved.push({ id: line.id, category: 'MAIN BRACKET', reason: `No manual map for variant "${variant}"` });
      continue;
    }

    const item = findItemByKey(lookupKey);
    if (item) {
      updates.push({ id: line.id, item_id: item.id });
      bracketResolved++;
    } else {
      unresolved.push({ id: line.id, category: 'MAIN BRACKET', reason: `No item for "${lookupKey}" (variant ${variant})` });
    }
  }
  console.log(`  Resolved: ${bracketResolved}/${bracketLines.length}`);

  // ─── 5. Safety (Counter frames + pulley qty) ─────────
  console.log('\n--- Resolving Safety ---');
  const safetyLines = byCategory['Safety'] || [];
  let safetyResolved = 0;

  // Manual Safety mappings by source_col_index
  const safetyColMap = {
    // Counter Guard frames (Home)
    [colLetterToIndex('NB')]: { lookupKey: 'Counter Guard G.I Home DBG-550' },
    [colLetterToIndex('NC')]: { lookupKey: 'Counter Guard G.I Home DBG-650' },
    [colLetterToIndex('ND')]: { lookupKey: 'Counter Guard G.I Home DBG-750' },
    [colLetterToIndex('NE')]: { lookupKey: 'Counter Guard G.I Home DBG-850' },
    // Counter Guard frames (Standard)
    [colLetterToIndex('NJ')]: { lookupKey: 'Counter Guard Net DBG-850' },
    [colLetterToIndex('NK')]: { lookupKey: 'Counter Guard Net DBG-1050x50' },
    // Counter Guard Net
    [colLetterToIndex('NQ')]: { lookupKey: 'Counter Guard Net DBG-850' },
    // Machine Beam
    [colLetterToIndex('NS')]: { lookupKey: 'Machine Beam Home' },
    [colLetterToIndex('NT')]: { lookupKey: null }, // Machine Beam 2:1 — needs spec
    // Pit Ladder
    [colLetterToIndex('NR')]: { lookupKey: 'Pit Ladder' },
  };

  // Pulley qty columns — need to use spec-lookup from adjacent column
  const PULLEY_MAIN_QTY_COL = colLetterToIndex('MW'); // 360
  const PULLEY_MAIN_SPEC_COL = colLetterToIndex('MV'); // 359
  const PULLEY_COUNTER_QTY_COL = colLetterToIndex('MY'); // 362
  const PULLEY_COUNTER_SPEC_COL = colLetterToIndex('MX'); // 361

  for (const line of safetyLines) {
    const colIdx = line.source_col_index;

    // Check manual map first
    if (safetyColMap[colIdx]) {
      const mapping = safetyColMap[colIdx];
      if (!mapping.lookupKey) {
        unresolved.push({ id: line.id, category: 'Safety', reason: `Col ${indexToColLetter(colIdx)} needs spec-based resolution` });
        continue;
      }
      const item = findItemByKey(mapping.lookupKey);
      if (item) {
        updates.push({ id: line.id, item_id: item.id });
        safetyResolved++;
      } else {
        // Try icontains for machine beam
        if (mapping.lookupKey.includes('Machine Beam')) {
          const mbItem = findItemContains('Machine Beam Home');
          if (mbItem) {
            updates.push({ id: line.id, item_id: mbItem.id });
            safetyResolved++;
            continue;
          }
        }
        unresolved.push({ id: line.id, category: 'Safety', reason: `No item for "${mapping.lookupKey}"` });
      }
      continue;
    }

    // Pulley quantity columns — resolve via adjacent spec column
    if (colIdx === PULLEY_MAIN_QTY_COL || colIdx === PULLEY_COUNTER_QTY_COL) {
      const specCol = colIdx === PULLEY_MAIN_QTY_COL ? PULLEY_MAIN_SPEC_COL : PULLEY_COUNTER_SPEC_COL;

      // Find the job for this BOM line
      const jobId = headerToJob.get(line.job_bom_id);
      const job = jobId ? jobById.get(jobId) : null;
      if (!job) {
        unresolved.push({ id: line.id, category: 'Safety', reason: 'No job found for pulley qty' });
        continue;
      }

      // Look up the TARGET sheet row for this job
      const targetRow = jobRowMap.get(job.job_number);
      if (targetRow === undefined) {
        unresolved.push({ id: line.id, category: 'Safety', reason: `Job ${job.job_number} not in TARGET sheet` });
        continue;
      }

      const specValue = targetData[targetRow] ? targetData[targetRow][specCol] : null;
      if (!specValue) {
        unresolved.push({ id: line.id, category: 'Safety', reason: `No pulley spec in col ${indexToColLetter(specCol)} for job ${job.job_number}` });
        continue;
      }

      const specCode = String(specValue).trim();
      const fullName = tradeMap.get(specCode);
      if (!fullName) {
        unresolved.push({ id: line.id, category: 'Safety', reason: `Pulley spec "${specCode}" not in Trade map (job ${job.job_number})` });
        continue;
      }

      const item = findItemByKey(fullName);
      if (item) {
        updates.push({ id: line.id, item_id: item.id });
        safetyResolved++;
      } else {
        unresolved.push({ id: line.id, category: 'Safety', reason: `No item for pulley "${fullName}" (spec="${specCode}", job ${job.job_number})` });
      }
      continue;
    }

    // Fallback
    unresolved.push({ id: line.id, category: 'Safety', reason: `Unknown safety col ${colIdx} (${indexToColLetter(colIdx)})` });
  }
  console.log(`  Resolved: ${safetyResolved}/${safetyLines.length}`);

  // ─── 6. Cabin Items ──────────────────────────────────
  console.log('\n--- Cabin Items ---');
  const cabinLines = byCategory['Cabin Items'] || [];
  // These items don't exist in inventory — report them
  const cabinMissing = new Map();
  for (const line of cabinLines) {
    const colLetter = indexToColLetter(line.source_col_index);
    const key = `${colLetter}(${line.source_col_index})`;
    if (!cabinMissing.has(key)) cabinMissing.set(key, 0);
    cabinMissing.set(key, cabinMissing.get(key) + 1);
    unresolved.push({ id: line.id, category: 'Cabin Items', reason: `Item not in inventory (col ${colLetter})` });
  }
  console.log(`  Cannot resolve — items not in inventory:`);
  for (const [col, count] of cabinMissing) {
    console.log(`    Col ${col}: ${count} lines`);
  }

  // ─── Apply Updates ────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  APPLYING UPDATES: ${updates.length} lines to resolve`);
  console.log('═══════════════════════════════════════════════════\n');

  let updated = 0;
  let updateErrors = 0;

  // Update in batches of 50 using individual PATCH calls
  for (let i = 0; i < updates.length; i++) {
    const upd = updates[i];
    try {
      await supaFetch(`job_bom_lines?id=eq.${upd.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ item_id: upd.item_id })
      });
      updated++;
    } catch (err) {
      console.error(`  Error updating line ${upd.id}: ${err.message}`);
      updateErrors++;
    }
    if ((i + 1) % 50 === 0) {
      process.stdout.write(`  Updated ${updated}/${updates.length}...\r`);
    }
  }
  console.log(`  Phase 1 updates: ${updated} succeeded, ${updateErrors} errors`);

  // ─── Phase 2: Add spec-lookup columns ─────────────────

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  PHASE 2: Add spec-lookup BOM lines');
  console.log('═══════════════════════════════════════════════════\n');

  // Spec-lookup columns: cell VALUE = short code → Trade/Production → item
  const specLookupCols = [
    {
      name: 'Safety DBG',
      colIdx: colLetterToIndex('MU'), // 358
      sourceMap: 'production',
      category: 'Safety',
    },
    {
      name: 'Pulley Main Spec',
      colIdx: colLetterToIndex('MV'), // 359
      sourceMap: 'trade',
      category: 'Pulley',
    },
    {
      name: 'Pulley Counter Spec',
      colIdx: colLetterToIndex('MX'), // 361
      sourceMap: 'trade',
      category: 'Pulley',
    },
    {
      name: 'Machine',
      colIdx: colLetterToIndex('NW'), // 386
      sourceMap: 'trade',
      category: 'Machine',
    },
    {
      name: 'Governor',
      colIdx: colLetterToIndex('NX'), // 387
      sourceMap: 'trade',
      category: 'Governor',
    },
  ];

  // Get BOM header map: job_id → bom_header_id
  const jobToBomHeader = new Map();
  for (const h of bomHeaders) {
    jobToBomHeader.set(h.job_id, h.id);
  }

  // Get existing BOM lines by source_col_index to avoid duplicates
  const existingByCol = new Map();
  let allLines = [];
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?select=id,job_bom_id,source_col_index&limit=1000&offset=${offset}`);
    allLines.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  for (const l of allLines) {
    const key = `${l.job_bom_id}|${l.source_col_index}`;
    existingByCol.set(key, true);
  }
  console.log(`  Loaded ${allLines.length} existing BOM lines for dedup check`);

  let specLinesCreated = 0;
  let specLinesSkipped = 0;
  let specLinesNoMatch = 0;

  for (const specCol of specLookupCols) {
    console.log(`\n  --- ${specCol.name} (col ${indexToColLetter(specCol.colIdx)}, idx ${specCol.colIdx}) ---`);
    const lookupMap = specCol.sourceMap === 'trade' ? tradeMap : prodMap;

    const newLines = [];
    let colResolved = 0;
    let colSkipped = 0;
    let colNoMatch = 0;
    const missingCodes = new Map();

    for (const job of jobs) {
      const bomHeaderId = jobToBomHeader.get(job.id);
      if (!bomHeaderId) continue;

      // Check if this job+col already has a BOM line
      const dedupKey = `${bomHeaderId}|${specCol.colIdx}`;
      if (existingByCol.has(dedupKey)) {
        colSkipped++;
        continue;
      }

      // Get the cell value from TARGET sheet
      const targetRow = jobRowMap.get(job.job_number);
      if (targetRow === undefined) continue;

      const cellValue = targetData[targetRow] ? targetData[targetRow][specCol.colIdx] : null;
      if (!cellValue || cellValue === '' || cellValue === 0) continue;

      const specCode = String(cellValue).trim();

      // Look up full item name
      const fullName = lookupMap.get(specCode);
      if (!fullName) {
        missingCodes.set(specCode, (missingCodes.get(specCode) || 0) + 1);
        // Still create the line with category/variant, no item_id
        newLines.push({
          job_bom_id: bomHeaderId,
          item_id: null,
          required_quantity: 1,
          issued_quantity: 0,
          wastage_percent: 0,
          sort_order: 9000 + specCol.colIdx,
          source_col_index: specCol.colIdx,
          category: specCol.category,
          variant: specCode,
          value_text: specCode,
        });
        colNoMatch++;
        continue;
      }

      // Find item by full name
      const item = findItemByKey(fullName);
      if (item) {
        newLines.push({
          job_bom_id: bomHeaderId,
          item_id: item.id,
          required_quantity: 1,
          issued_quantity: 0,
          wastage_percent: 0,
          sort_order: 9000 + specCol.colIdx,
          source_col_index: specCol.colIdx,
          category: specCol.category,
          variant: specCode,
          value_text: fullName,
        });
        colResolved++;
      } else {
        newLines.push({
          job_bom_id: bomHeaderId,
          item_id: null,
          required_quantity: 1,
          issued_quantity: 0,
          wastage_percent: 0,
          sort_order: 9000 + specCol.colIdx,
          source_col_index: specCol.colIdx,
          category: specCol.category,
          variant: specCode,
          value_text: fullName,
        });
        colNoMatch++;
      }
    }

    console.log(`    Resolved to item: ${colResolved}`);
    console.log(`    Skipped (already exists): ${colSkipped}`);
    console.log(`    No item match: ${colNoMatch}`);
    if (missingCodes.size > 0) {
      console.log(`    Missing lookup codes:`);
      for (const [code, cnt] of [...missingCodes.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`      "${code}" (${cnt} jobs)`);
      }
    }

    // Insert new lines in batches
    for (let b = 0; b < newLines.length; b += 200) {
      const batch = newLines.slice(b, b + 200);
      try {
        await supaFetch('job_bom_lines', {
          method: 'POST',
          body: JSON.stringify(batch)
        });
        specLinesCreated += batch.length;
      } catch (err) {
        console.error(`    Error inserting batch: ${err.message}`);
      }
    }

    specLinesSkipped += colSkipped;
    specLinesNoMatch += colNoMatch;
  }

  // ─── Also add column_map entries for spec-lookup columns ───
  console.log('\n--- Adding column_map entries for spec-lookup columns ---');
  for (const specCol of specLookupCols) {
    // Check if already exists
    const existing = await supaFetch(`target_column_map?column_index=eq.${specCol.colIdx}&select=id&limit=1`);
    if (existing.length > 0) {
      console.log(`  Col ${indexToColLetter(specCol.colIdx)} (${specCol.name}): already in column_map`);
      continue;
    }
    try {
      await supaFetch('target_column_map', {
        method: 'POST',
        body: JSON.stringify({
          column_index: specCol.colIdx,
          column_label: specCol.name,
          item_lookup_key: null,
          item_id: null,
          category: specCol.category,
          is_active: true,
          notes: `Spec-lookup column: cell value = code → ${specCol.sourceMap} map → item`
        })
      });
      console.log(`  Added col ${indexToColLetter(specCol.colIdx)} (${specCol.name}) to column_map`);
    } catch (err) {
      console.log(`  Error adding to column_map: ${err.message}`);
    }
  }

  // ─── Also update column_map entries for brackets ──────
  console.log('\n--- Updating column_map bracket entries ---');
  for (const [variant, lookupKey] of Object.entries(bracketManualMap)) {
    const item = findItemByKey(lookupKey);
    if (!item) continue;

    // Find the column_map entry with this variant in notes
    const entries = await supaFetch(`target_column_map?category=eq.MAIN BRACKET&notes=like.*${encodeURIComponent(variant)}*&select=id,column_index,item_id&limit=5`);
    for (const entry of entries) {
      if (entry.item_id) continue; // already matched
      try {
        await supaFetch(`target_column_map?id=eq.${entry.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ item_id: item.id, item_lookup_key: lookupKey })
        });
        console.log(`  Updated col ${indexToColLetter(entry.column_index)} → "${lookupKey.substring(0, 50)}"`);
      } catch (err) {
        console.log(`  Error: ${err.message}`);
      }
    }
  }

  // ─── Final Summary ────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  FINAL SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Phase 1: ${updated} existing lines resolved`);
  console.log(`  Phase 2: ${specLinesCreated} new spec-lookup lines created`);

  // Recount
  const finalNoItem = await supaFetch('job_bom_lines?item_id=is.null&select=id&limit=1', {
    headers: { 'Prefer': 'count=exact' }
  });
  // Can't easily get count, so let's count manually
  let finalCount = 0;
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?item_id=is.null&select=id&limit=1000&offset=${offset}`);
    finalCount += batch.length;
    if (batch.length < 1000) break;
    offset += 1000;
  }
  let totalCount = 0;
  offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?select=id&limit=1000&offset=${offset}`);
    totalCount += batch.length;
    if (batch.length < 1000) break;
    offset += 1000;
  }

  console.log(`\n  Total BOM lines now: ${totalCount}`);
  console.log(`  With item_id: ${totalCount - finalCount}`);
  console.log(`  Without item_id: ${finalCount}`);
  console.log(`  Resolution rate: ${((totalCount - finalCount) / totalCount * 100).toFixed(1)}%`);

  // Unresolved breakdown
  const unresolvedByCat = {};
  for (const u of unresolved) {
    if (!unresolvedByCat[u.category]) unresolvedByCat[u.category] = [];
    unresolvedByCat[u.category].push(u);
  }
  if (unresolved.length > 0) {
    console.log(`\n  Unresolved (${unresolved.length}):`);
    for (const [cat, items] of Object.entries(unresolvedByCat).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`    ${cat}: ${items.length}`);
      // Show unique reasons
      const reasons = new Map();
      for (const u of items) {
        const shortReason = u.reason.substring(0, 80);
        reasons.set(shortReason, (reasons.get(shortReason) || 0) + 1);
      }
      for (const [reason, cnt] of [...reasons.entries()].slice(0, 5)) {
        console.log(`      ${reason} (${cnt}x)`);
      }
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
