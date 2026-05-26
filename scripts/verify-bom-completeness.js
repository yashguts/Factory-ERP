const XLSX = require('xlsx');
const path = require('path');

const SUPABASE_URL = 'https://qwzisnmueuqnzzokkpmn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14';

async function supaFetch(endpoint) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    }
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  // Read Excel
  const xlPath = path.join('C:', 'Users', 'yash_', 'Downloads', 'Target List (5).xlsx');
  const wb = XLSX.readFile(xlPath, { type: 'file' });
  const ws = wb.Sheets['TARGET'] || wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Fetch jobs from DB
  const jobs = await supaFetch('jobs?select=id,job_number&limit=200');
  const jobByNumber = {};
  jobs.forEach(j => { jobByNumber[j.job_number] = j.id; });

  // Fetch all BOM lines from DB (paginate)
  let allLines = [];
  let offset = 0;
  while (true) {
    const batch = await supaFetch(`job_bom_lines?select=job_bom_id,source_col_index,required_quantity&limit=1000&offset=${offset}`);
    allLines = allLines.concat(batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }

  // Fetch BOM headers to map header_id -> job_id
  const headers = await supaFetch('job_bom_headers?select=id,job_id&limit=200');
  const jobIdByHeaderId = {};
  const headerIdByJobId = {};
  headers.forEach(h => { jobIdByHeaderId[h.id] = h.job_id; headerIdByJobId[h.job_id] = h.id; });

  // Build DB lookup: jobNumber -> { colIdx -> qty }
  const dbData = {}; // jobNumber -> { colIdx -> qty }
  const jobNumberById = {};
  jobs.forEach(j => { jobNumberById[j.id] = j.job_number; });

  for (const line of allLines) {
    const jobId = jobIdByHeaderId[line.job_bom_id];
    const jobNum = jobNumberById[jobId];
    if (!jobNum) continue;
    if (!dbData[jobNum]) dbData[jobNum] = {};
    dbData[jobNum][line.source_col_index] = (dbData[jobNum][line.source_col_index] || 0) + line.required_quantity;
  }

  // BOM columns in Excel: 9 to end of row
  const BOM_START_COL = 9;
  const dataStart = 7;

  let excelNonZeroCells = 0;
  let dbNonZeroCells = allLines.length;
  let missingFromDb = 0;
  let extraInDb = 0;
  let mismatchedQty = 0;
  let matchedCells = 0;
  const missingExamples = [];
  const mismatchExamples = [];

  // Track per-job stats
  const jobStats = [];

  for (let row = dataStart; row < data.length; row++) {
    const rowData = data[row];
    if (!rowData) continue;
    const jobRefRaw = rowData[1];
    if (!jobRefRaw) continue;
    const jobRef = String(jobRefRaw).trim();
    if (!jobRef) continue;

    const jobId = jobByNumber[jobRef];
    if (!jobId) continue;

    const dbJob = dbData[jobRef] || {};
    let jobExcelCells = 0;
    let jobDbCells = Object.keys(dbJob).length;
    let jobMissing = 0;
    let jobMatched = 0;

    // Count non-zero BOM cells in Excel for this job
    const maxCol = rowData.length;
    for (let col = BOM_START_COL; col < maxCol; col++) {
      const val = rowData[col];
      if (val === null || val === undefined || val === '' || val === 0) continue;
      const numVal = typeof val === 'number' ? val : parseFloat(val);
      if (isNaN(numVal) || numVal === 0) continue;

      excelNonZeroCells++;
      jobExcelCells++;

      if (dbJob[col] !== undefined) {
        if (Math.abs(dbJob[col] - numVal) < 0.001) {
          matchedCells++;
          jobMatched++;
        } else {
          mismatchedQty++;
          if (mismatchExamples.length < 10) {
            mismatchExamples.push({ job: jobRef, col, excel: numVal, db: dbJob[col] });
          }
        }
      } else {
        missingFromDb++;
        jobMissing++;
        if (missingExamples.length < 20) {
          missingExamples.push({ job: jobRef, col, excelVal: numVal });
        }
      }
    }

    jobStats.push({ job: jobRef, excelCells: jobExcelCells, dbCells: jobDbCells, missing: jobMissing, matched: jobMatched });
  }

  console.log('=== BOM Data Completeness Check ===\n');
  console.log(`Excel non-zero BOM cells (cols ${BOM_START_COL}+): ${excelNonZeroCells}`);
  console.log(`DB BOM lines:                              ${dbNonZeroCells}`);
  console.log(`Matched (same col + same qty):             ${matchedCells}`);
  console.log(`Missing from DB (in Excel, not in DB):     ${missingFromDb}`);
  console.log(`Mismatched qty:                            ${mismatchedQty}`);
  console.log(`\nCapture rate: ${((matchedCells / excelNonZeroCells) * 100).toFixed(1)}%`);

  if (missingExamples.length > 0) {
    console.log('\n--- Missing from DB (sample) ---');
    // Group by column to see which columns are losing data
    const missingByCol = {};
    // Re-scan all missing (not just examples)
    for (let row = dataStart; row < data.length; row++) {
      const rowData = data[row];
      if (!rowData) continue;
      const jobRefRaw = rowData[1];
      if (!jobRefRaw) continue;
      const jobRef = String(jobRefRaw).trim();
      const jobId = jobByNumber[jobRef];
      if (!jobId) continue;
      const dbJob = dbData[jobRef] || {};
      const maxCol = rowData.length;
      for (let col = BOM_START_COL; col < maxCol; col++) {
        const val = rowData[col];
        if (val === null || val === undefined || val === '' || val === 0) continue;
        const numVal = typeof val === 'number' ? val : parseFloat(val);
        if (isNaN(numVal) || numVal === 0) continue;
        if (dbJob[col] === undefined) {
          if (!missingByCol[col]) missingByCol[col] = 0;
          missingByCol[col]++;
        }
      }
    }

    // Read header rows to get column names
    const headerRows = data.slice(0, 7);
    function getColName(colIdx) {
      for (let r = 0; r < headerRows.length; r++) {
        const val = headerRows[r] && headerRows[r][colIdx];
        if (val && String(val).trim()) return String(val).trim();
      }
      return `col_${colIdx}`;
    }

    const sortedMissing = Object.entries(missingByCol)
      .map(([col, count]) => ({ col: parseInt(col), count, name: getColName(parseInt(col)) }))
      .sort((a, b) => b.count - a.count);

    console.log(`\nTop missing columns (${sortedMissing.length} distinct columns not captured):`);
    for (const m of sortedMissing.slice(0, 40)) {
      console.log(`  Col ${m.col} "${m.name}": ${m.count} jobs have data here`);
    }

    // Also show the text/non-numeric cells we're skipping
    console.log('\n--- Non-numeric cells in BOM range (skipped) ---');
    let textCells = 0;
    const textExamples = {};
    for (let row = dataStart; row < data.length; row++) {
      const rowData = data[row];
      if (!rowData) continue;
      const jobRefRaw = rowData[1];
      if (!jobRefRaw) continue;
      const maxCol = rowData.length;
      for (let col = BOM_START_COL; col < maxCol; col++) {
        const val = rowData[col];
        if (val === null || val === undefined || val === '' || val === 0) continue;
        if (typeof val === 'string' && isNaN(parseFloat(val))) {
          textCells++;
          if (!textExamples[col]) textExamples[col] = { name: getColName(col), examples: [] };
          if (textExamples[col].examples.length < 3) textExamples[col].examples.push(val);
        }
      }
    }
    console.log(`Total text cells in BOM range: ${textCells}`);
    const textCols = Object.entries(textExamples).slice(0, 20);
    for (const [col, info] of textCols) {
      console.log(`  Col ${col} "${info.name}": e.g. ${info.examples.join(', ')}`);
    }
  }

  // Show jobs with most missing data
  const jobsByMissing = jobStats.filter(j => j.missing > 0).sort((a, b) => b.missing - a.missing);
  if (jobsByMissing.length > 0) {
    console.log(`\n--- Jobs with most missing BOM data ---`);
    for (const j of jobsByMissing.slice(0, 15)) {
      console.log(`  ${j.job}: ${j.excelCells} Excel cells, ${j.dbCells} in DB, ${j.missing} missing (${((j.matched / j.excelCells) * 100).toFixed(0)}% captured)`);
    }
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
