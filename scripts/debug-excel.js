const XLSX = require('xlsx');
const path = require('path');

const xlPath = path.join('C:', 'Users', 'yash_', 'Downloads', 'Target List (5).xlsx');
const wb = XLSX.readFile(xlPath);
const ws = wb.Sheets['TARGET'] || wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

console.log('Sheet names:', wb.SheetNames);
console.log('Total rows:', data.length);
console.log('\nFirst 10 data rows (cols 0-3):');
for (let i = 7; i < 17; i++) {
  if (data[i]) {
    console.log(`Row ${i}: [${data[i][0]}, ${data[i][1]}, ${data[i][2]}, ${data[i][3]}]`);
  }
}
