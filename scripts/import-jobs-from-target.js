/**
 * Import Jobs from Target Excel Sheet — PERMANENT PIPELINE
 *
 * Single-pass import that handles ALL mapping types:
 *   1. Direct item_id from column_map (210 columns)
 *   2. {mat} placeholder resolution using job's door_finish (139 door panel columns)
 *   3. Spec-lookup columns: cell VALUE → Trade/Production map → item (5 columns)
 *   4. Pulley quantity cross-reference: qty from col MW/MY, spec from col MV/MX
 *
 * Usage: node scripts/import-jobs-from-target.js [path-to-excel]
 *   Default: C:/Users/yash_/OneDrive/Desktop/Target (27052027).xlsx
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

// ─── Spec String Parser ────────────────────────────────────
const DOOR_CODE_MAP = {
  'CO': 'CO', 'AT': 'AT', 'AFF': 'AFF', 'COL': 'COL', 'MT': 'MT',
  'BYPART': 'BYPART', 'SWS': 'SWS', 'SWING': 'SWS', 'SW': 'SWS', 'DUMB': 'DUMB',
};

const DRIVE_CODE_MAP = {
  'MR': 'MR', 'MRL': 'MRL', 'HOME': 'HOME', 'HM': 'HOME',
  'V3F': 'V3F', 'MV3F': 'MV3F', 'BELT': 'BELT', 'HYD': 'HYD',
  'ROPE': 'ROPE', 'CANTI': 'CANTI', 'R': 'ROPE',
};

function parseSpecString(spec) {
  const result = { floors: null, door_type: null, drive_type: null, capacity: null, door_finish: null };
  if (!spec || typeof spec !== 'string') return result;

  const s = spec.trim().toUpperCase().replace(/\s+/g, '');

  // Door finish from (SS) / (MS) suffix
  const finishMatch = s.match(/\((SS|MS)\)/);
  if (finishMatch) result.door_finish = finishMatch[1];

  const cleaned = s.replace(/\([^)]*\)/g, '').replace(/\s+/g, '');
  const parts = cleaned.split('/');

  // Floors: G+N or B+G+N
  for (const part of parts) {
    const match = part.match(/(?:(\d*)B\+)?G\+(\d+)/i);
    if (match) {
      const basements = match[1] ? parseInt(match[1]) || 1 : 0;
      const upper = parseInt(match[2]) || 0;
      result.floors = basements + 1 + upper;
      break;
    }
  }

  // Door type
  for (const p of parts) {
    if (DOOR_CODE_MAP[p]) { result.door_type = DOOR_CODE_MAP[p]; break; }
  }

  // Drive type (with prefix match for HYD-6440 etc.)
  for (const p of parts) {
    if (DRIVE_CODE_MAP[p]) { result.drive_type = DRIVE_CODE_MAP[p]; break; }
    const prefix = p.replace(/[-\d]+$/, '');
    if (prefix && DRIVE_CODE_MAP[prefix]) { result.drive_type = DRIVE_CODE_MAP[prefix]; break; }
  }

  // Capacity
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].includes('PASS') || parts[i].includes('KG')) { result.capacity = parts[i]; break; }
  }

  // Door finish from first part
  if (!result.door_finish && (parts[0] === 'SS' || parts[0] === 'MS')) {
    result.door_finish = parts[0];
  }

  return result;
}

// ─── Custom Overrides for codes NOT in Trade/Production maps ────
// When the Trade/Production map doesn't have a code, fall back to these
const CUSTOM_TRADE_OVERRIDES = {
  // Machine codes missing from Trade sheet
  '4P': 'Machine Unit 4 pass/200mm/4g/6mm/Home',
  // Governor codes missing from Trade sheet
  '1/RH': 'Speed Governor 1mts',
  '.5/LH/RH': 'Speed Governor 0.5mts',
};

// ─── Spec-Lookup Column Definitions ────────────────────────
// These columns have a short code in the cell → look up in Trade or Production map → get item name
const SPEC_LOOKUP_COLS = {
  [colLetterToIndex('MU')]: { name: 'Safety DBG', sourceMap: 'production', category: 'Safety' },
  [colLetterToIndex('MV')]: { name: 'Pulley Main', sourceMap: 'trade', category: 'Pulley_Main' },
  [colLetterToIndex('MX')]: { name: 'Pulley Counter', sourceMap: 'trade', category: 'Pulley_Counter' },
  [colLetterToIndex('NW')]: { name: 'Machine', sourceMap: 'trade', category: 'Machine' },
  [colLetterToIndex('NX')]: { name: 'Governor', sourceMap: 'trade', category: 'Governor' },
};

// Pulley quantity columns: the QTY is in MW/MY, the SPEC (which pulley) is in MV/MX
const PULLEY_QTY_SPEC_MAP = {
  [colLetterToIndex('MW')]: colLetterToIndex('MV'), // Main Pulley Qty → Main Pulley Spec
  [colLetterToIndex('MY')]: colLetterToIndex('MX'), // Counter Pulley Qty → Counter Pulley Spec
};

// ─── Main ──────────────────────────────────────────────────
async function main() {
  const issues = [];
  const warnings = [];

  console.log('═══════════════════════════════════════════════════');
  console.log('  JOB IMPORT FROM TARGET EXCEL');
  console.log('═══════════════════════════════════════════════════\n');

  // ─── STEP 1: Delete existing job data ─────────────────
  console.log('STEP 1: Deleting existing job data...');

  let deleted = 0;
  while (true) {
    const lines = await supaFetch('job_bom_lines?select=id&limit=500');
    if (!lines || lines.length === 0) break;
    await supaFetch(`job_bom_lines?id=in.(${lines.map(l => l.id).join(',')})`, { method: 'DELETE' });
    deleted += lines.length;
    process.stdout.write(`  Deleted ${deleted} BOM lines...\r`);
  }
  console.log(`  Deleted ${deleted} BOM lines total`);

  deleted = 0;
  while (true) {
    const hdrs = await supaFetch('job_bom_headers?select=id&limit=500');
    if (!hdrs || hdrs.length === 0) break;
    await supaFetch(`job_bom_headers?id=in.(${hdrs.map(h => h.id).join(',')})`, { method: 'DELETE' });
    deleted += hdrs.length;
  }
  console.log(`  Deleted ${deleted} BOM headers`);

  deleted = 0;
  while (true) {
    const jobs = await supaFetch('jobs?select=id&limit=500');
    if (!jobs || jobs.length === 0) break;
    await supaFetch(`jobs?id=in.(${jobs.map(j => j.id).join(',')})`, { method: 'DELETE' });
    deleted += jobs.length;
  }
  console.log(`  Deleted ${deleted} jobs\n`);

  // ─── STEP 2: Read Excel ───────────────────────────────
  console.log('STEP 2: Reading Excel...');
  const xlPath = process.argv[2] || path.join('C:', 'Users', 'yash_', 'OneDrive', 'Desktop', 'Target (27052027).xlsx');
  const wb = XLSX.readFile(xlPath, { type: 'file' });

  // TARGET sheet
  const ws = wb.Sheets['TARGET'] || wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log(`  TARGET: ${data.length} rows`);

  // Trade map: Col A = short code, Col D = full name
  const tradeMap = new Map();
  const tradeWs = wb.Sheets['Trade'] || wb.Sheets['TRADE'] || wb.Sheets['trade'];
  if (tradeWs) {
    const td = XLSX.utils.sheet_to_json(tradeWs, { header: 1, defval: null });
    for (let r = 1; r < td.length; r++) {
      const row = td[r];
      if (row && row[0] && row[3]) tradeMap.set(String(row[0]).trim(), String(row[3]).trim());
    }
    console.log(`  Trade map: ${tradeMap.size} entries`);
  } else {
    console.log('  ⚠ Trade sheet not found');
  }

  // Production map: Col E = code, Col F = full name
  const prodMap = new Map();
  const prodWs = wb.Sheets['Production'] || wb.Sheets['PRODUCTION'] || wb.Sheets['production'];
  if (prodWs) {
    const pd = XLSX.utils.sheet_to_json(prodWs, { header: 1, defval: null });
    for (let r = 1; r < pd.length; r++) {
      const row = pd[r];
      if (row && row[4] && row[5]) prodMap.set(String(row[4]).trim(), String(row[5]).trim());
    }
    console.log(`  Production map: ${prodMap.size} entries`);
  } else {
    console.log('  ⚠ Production sheet not found');
  }

  // ─── STEP 3: Load column map and items ────────────────
  console.log('\nSTEP 3: Loading column map and items...');

  let colMap = [];
  let offset = 0;
  while (true) {
    const batch = await supaFetch(`target_column_map?select=*&limit=1000&offset=${offset}`);
    colMap.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`  Column map: ${colMap.length} entries`);

  const colMapByIndex = new Map();
  for (const entry of colMap) colMapByIndex.set(entry.column_index, entry);

  // Load all items and build lookup indexes
  let items = [];
  offset = 0;
  while (true) {
    const batch = await supaFetch(`items?select=id,lookup_key&limit=1000&offset=${offset}`);
    items.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`  Items: ${items.length}`);

  const itemByExactKey = new Map();
  const itemByNormKey = new Map();
  for (const item of items) {
    if (!item.lookup_key) continue;
    itemByExactKey.set(item.lookup_key, item);
    itemByNormKey.set(item.lookup_key.replace(/\s+/g, ' ').trim().toLowerCase(), item);
  }

  function findItemByKey(key) {
    if (!key) return null;
    let item = itemByExactKey.get(key);
    if (item) return item;
    item = itemByNormKey.get(key.replace(/\s+/g, ' ').trim().toLowerCase());
    return item || null;
  }

  // Stats
  const directCols = colMap.filter(c => c.item_id).length;
  const matCols = colMap.filter(c => !c.item_id && c.item_lookup_key && c.item_lookup_key.includes('{mat}')).length;
  const specCols = Object.keys(SPEC_LOOKUP_COLS).length;
  console.log(`  Direct-match columns: ${directCols}`);
  console.log(`  {mat} placeholder columns: ${matCols}`);
  console.log(`  Spec-lookup columns: ${specCols}`);

  // ─── STEP 4: Parse job rows ───────────────────────────
  console.log('\nSTEP 4: Parsing job rows...');
  const jobRows = [];

  for (let rowIdx = 5; rowIdx < data.length; rowIdx++) {
    const row = data[rowIdx];
    if (!row) continue;

    const jobNum = row[1];
    if (!jobNum || jobNum === null) continue;
    const jobNumber = String(jobNum).trim();
    if (!jobNumber || jobNumber === '0') continue;

    const customerName = row[2] ? String(row[2]).trim() : null;
    const specString = row[4] ? String(row[4]).trim() : null;
    const area = row[5] ? String(row[5]).trim() : null;
    const direction = row[6] ? String(row[6]).trim() : null;

    let location = null;
    if (direction && direction !== '0' && area && area !== '0') location = `${direction}, ${area}`;
    else if (direction && direction !== '0') location = direction;
    else if (area && area !== '0') location = area;

    let expectedDelivery = null, remark = null;
    const colH = row[7], colI = row[8];
    if (colH) {
      const hStr = String(colH).trim();
      if (typeof colH === 'number' && colH > 40000 && colH < 50000) {
        const d = XLSX.SSF.parse_date_code(colH);
        expectedDelivery = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
      } else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(hStr)) {
        const parts = hStr.split(/[\/\-]/);
        expectedDelivery = `${parts[2].length === 2 ? '20'+parts[2] : parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
      } else {
        remark = hStr;
      }
    }
    if (colI) {
      const iStr = String(colI).trim();
      remark = remark ? remark + '; ' + iStr : iStr;
    }

    const parsed = parseSpecString(specString);

    const jobData = {
      rowIdx,
      job_number: jobNumber,
      customer_name: customerName,
      spec_string: specString,
      door_finish: parsed.door_finish || null,
      location,
      expected_delivery: expectedDelivery,
      remark,
      floors: parsed.floors,
      door_type: parsed.door_type,
      drive_type: parsed.drive_type,
      capacity: parsed.capacity,
      bomValues: [],
    };

    // ─── Build BOM values ─────────────────────────────

    // A) Mapped columns (direct + {mat} + static lookup)
    for (const [colIdx, mapEntry] of colMapByIndex) {
      // Skip spec-lookup columns — handled separately below
      if (SPEC_LOOKUP_COLS[colIdx]) continue;

      const val = row[colIdx];
      if (val === null || val === undefined || val === '' || val === 0) continue;
      const numVal = typeof val === 'number' ? val : parseFloat(String(val).trim());
      if (isNaN(numVal) || numVal === 0) continue;

      let itemId = mapEntry.item_id || null;

      // If no item_id but has {mat} pattern, resolve now
      if (!itemId && mapEntry.item_lookup_key && mapEntry.item_lookup_key.includes('{mat}')) {
        const mat = jobData.door_finish || 'MS'; // default MS
        const resolvedKey = mapEntry.item_lookup_key.replace('{mat}', mat);
        const item = findItemByKey(resolvedKey);
        if (item) itemId = item.id;
      }

      // If still no item_id but has a static lookup_key, try to find now
      if (!itemId && mapEntry.item_lookup_key && !mapEntry.item_lookup_key.includes('{mat}')) {
        const item = findItemByKey(mapEntry.item_lookup_key);
        if (item) itemId = item.id;
      }

      // Pulley qty cross-reference: col MW/MY → use spec from MV/MX
      if (!itemId && PULLEY_QTY_SPEC_MAP[colIdx]) {
        const specCol = PULLEY_QTY_SPEC_MAP[colIdx];
        const specVal = row[specCol];
        if (specVal) {
          const specCode = String(specVal).trim();
          const fullName = tradeMap.get(specCode);
          if (fullName) {
            const item = findItemByKey(fullName);
            if (item) itemId = item.id;
          }
        }
      }

      jobData.bomValues.push({
        colIndex: colIdx,
        quantity: numVal,
        itemId,
        category: mapEntry.category,
        lookupKey: mapEntry.item_lookup_key,
      });
    }

    // B) Spec-lookup columns (Governor, Machine, Pulley, Safety DBG)
    for (const [colIdxStr, specDef] of Object.entries(SPEC_LOOKUP_COLS)) {
      const colIdx = parseInt(colIdxStr);
      const val = row[colIdx];
      if (val === null || val === undefined || val === '' || val === 0) continue;

      const specCode = String(val).trim();
      const lookupMap = specDef.sourceMap === 'trade' ? tradeMap : prodMap;
      const fullName = lookupMap.get(specCode) || CUSTOM_TRADE_OVERRIDES[specCode] || null;

      let itemId = null;
      if (fullName) {
        const item = findItemByKey(fullName);
        if (item) itemId = item.id;
      }

      jobData.bomValues.push({
        colIndex: colIdx,
        quantity: 1, // spec-lookup columns always qty=1
        itemId,
        category: specDef.category,
        lookupKey: fullName || specCode,
        variant: specCode,
      });
    }

    if (!specString) warnings.push(`Row ${rowIdx+1} (${jobNumber}): No spec string`);
    if (!customerName) warnings.push(`Row ${rowIdx+1} (${jobNumber}): No customer name`);

    jobRows.push(jobData);
  }

  console.log(`  Parsed ${jobRows.length} jobs`);

  // ─── STEP 5: Insert jobs ──────────────────────────────
  console.log('\nSTEP 5: Creating jobs...');
  const jobIdMap = new Map();
  let created = 0, jobErrors = 0;

  for (let i = 0; i < jobRows.length; i += 50) {
    const batch = jobRows.slice(i, i + 50);
    const insertRows = batch.map(j => ({
      job_number: j.job_number, customer_name: j.customer_name,
      spec_string: j.spec_string, door_finish: j.door_finish,
      location: j.location, progress: 0, order_date: null,
      expected_delivery: j.expected_delivery, brand: null,
      floors: j.floors, door_type: j.door_type,
      drive_type: j.drive_type, capacity: j.capacity, remark: j.remark,
    }));

    try {
      const result = await supaFetch('jobs', { method: 'POST', body: JSON.stringify(insertRows), prefer: 'return=representation' });
      for (let k = 0; k < result.length; k++) jobIdMap.set(batch[k].job_number, result[k].id);
      created += result.length;
    } catch (err) {
      // Fallback: insert one by one
      for (const j of batch) {
        try {
          const result = await supaFetch('jobs', {
            method: 'POST',
            body: JSON.stringify({
              job_number: j.job_number, customer_name: j.customer_name,
              spec_string: j.spec_string, door_finish: j.door_finish,
              location: j.location, progress: 0, order_date: null,
              expected_delivery: j.expected_delivery, brand: null,
              floors: j.floors, door_type: j.door_type,
              drive_type: j.drive_type, capacity: j.capacity, remark: j.remark,
            }),
            prefer: 'return=representation'
          });
          jobIdMap.set(j.job_number, result[0].id);
          created++;
        } catch (e2) {
          issues.push(`Failed to create job ${j.job_number}: ${e2.message}`);
          jobErrors++;
        }
      }
    }
    process.stdout.write(`  Created ${created}/${jobRows.length} jobs...\r`);
  }
  console.log(`  Created ${created} jobs, ${jobErrors} errors`);

  // ─── STEP 6: Create BOM headers and lines ─────────────
  console.log('\nSTEP 6: Creating BOM headers and lines...');
  let headersCreated = 0, linesCreated = 0, linesWithItem = 0, linesWithoutItem = 0;

  for (const job of jobRows) {
    const jobId = jobIdMap.get(job.job_number);
    if (!jobId || job.bomValues.length === 0) continue;

    let headerId;
    try {
      const hdr = await supaFetch('job_bom_headers', {
        method: 'POST', body: JSON.stringify({ job_id: jobId, quantity: 1 }),
        prefer: 'return=representation'
      });
      headerId = hdr[0].id;
      headersCreated++;
    } catch (err) {
      issues.push(`Job ${job.job_number}: BOM header failed: ${err.message}`);
      continue;
    }

    const lines = job.bomValues.map((bv, idx) => ({
      job_bom_id: headerId,
      item_id: bv.itemId || null,
      required_quantity: bv.quantity,
      issued_quantity: 0,
      wastage_percent: 0,
      sort_order: idx,
      source_col_index: bv.colIndex,
      category: bv.category || null,
      variant: bv.variant || (bv.itemId ? null : indexToColLetter(bv.colIndex)),
      value_text: bv.itemId ? null : (bv.lookupKey || null),
    }));

    for (const l of lines) {
      if (l.item_id) linesWithItem++;
      else linesWithoutItem++;
    }

    for (let b = 0; b < lines.length; b += 200) {
      const batch = lines.slice(b, b + 200);
      try {
        await supaFetch('job_bom_lines', { method: 'POST', body: JSON.stringify(batch) });
        linesCreated += batch.length;
      } catch (err) {
        issues.push(`Job ${job.job_number}: BOM lines batch failed: ${err.message}`);
      }
    }
  }

  console.log(`  BOM headers: ${headersCreated}`);
  console.log(`  BOM lines: ${linesCreated}`);
  console.log(`  With item_id: ${linesWithItem}`);
  console.log(`  Without item_id: ${linesWithoutItem}`);

  // ─── STEP 7: Summary ──────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  IMPORT SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Jobs: ${created}`);
  console.log(`  BOM lines: ${linesCreated} (${linesWithItem} with item, ${linesWithoutItem} without)`);
  console.log(`  Resolution rate: ${(linesWithItem / linesCreated * 100).toFixed(1)}%`);

  // Spec parsing stats
  const stats = {
    doorType: jobRows.filter(j => j.door_type).length,
    driveType: jobRows.filter(j => j.drive_type).length,
    floors: jobRows.filter(j => j.floors).length,
  };
  console.log(`\n  Spec parsing: door=${stats.doorType}/${jobRows.length}, drive=${stats.driveType}/${jobRows.length}, floors=${stats.floors}/${jobRows.length}`);

  // Door/Drive distribution
  const doorDist = {}, driveDist = {};
  for (const j of jobRows) {
    doorDist[j.door_type || '?'] = (doorDist[j.door_type || '?'] || 0) + 1;
    driveDist[j.drive_type || '?'] = (driveDist[j.drive_type || '?'] || 0) + 1;
  }
  console.log(`  Doors: ${Object.entries(doorDist).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(', ')}`);
  console.log(`  Drives: ${Object.entries(driveDist).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(', ')}`);

  // Unresolved breakdown
  if (linesWithoutItem > 0) {
    // Quick categorization
    const cats = {};
    for (const j of jobRows) {
      for (const bv of j.bomValues) {
        if (!bv.itemId) {
          const cat = bv.category || '?';
          cats[cat] = (cats[cat] || 0) + 1;
        }
      }
    }
    console.log(`\n  Unresolved by category:`);
    for (const [cat, cnt] of Object.entries(cats).sort((a,b)=>b[1]-a[1])) {
      console.log(`    ${cat}: ${cnt}`);
    }
  }

  if (issues.length > 0) {
    console.log(`\n  ❌ ERRORS (${issues.length}):`);
    for (const e of issues.slice(0, 20)) console.log(`    ${e}`);
    if (issues.length > 20) console.log(`    ... and ${issues.length - 20} more`);
  }

  if (warnings.length > 0) {
    console.log(`\n  ⚠ WARNINGS (${warnings.length}):`);
    for (const w of warnings.slice(0, 20)) console.log(`    ${w}`);
    if (warnings.length > 20) console.log(`    ... and ${warnings.length - 20} more`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  DONE');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
