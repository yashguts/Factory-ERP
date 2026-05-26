const XLSX = require('xlsx');
const path = require('path');

const SUPABASE_URL = 'https://qwzisnmueuqnzzokkpmn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14';

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
  if (options.prefer === 'return=representation' || !options.method || options.method === 'GET') {
    return res.json();
  }
  return null;
}

// Same bomMap from full-bom-import.js
const bomMap = [
  { cat: "RAIL", variant: "16/75-R", col: "J" },
  { cat: "RAIL", variant: "16-R", col: "K" },
  { cat: "RAIL", variant: "9-R", col: "L" },
  { cat: "RAIL", variant: "6-R", col: "M" },
  { cat: "Stud Anchor", variant: "8x75", col: "N" },
  { cat: "Stud Anchor", variant: "10X90", col: "O" },
  { cat: "Stud Anchor", variant: "12X100", col: "P" },
  { cat: "Stud Anchor", variant: "12X120", col: "Q" },
  { cat: "BRICK", variant: "8X75", col: "R" },
  { cat: "BRICK", variant: "12X150", col: "S" },
  { cat: "MAIN BRACKET", variant: "Type 1 M", col: "U" },
  { cat: "MAIN BRACKET", variant: "Type 1 B", col: "V" },
  { cat: "MAIN BRACKET", variant: "Type 1 C", col: "W" },
  { cat: "MAIN BRACKET", variant: "850/S", col: "AC" },
  { cat: "MAIN BRACKET", variant: "850x65/S", col: "AD" },
  { cat: "MAIN BRACKET", variant: "850x65/260", col: "AE" },
  { cat: "MAIN BRACKET", variant: "850/260", col: "AF" },
  { cat: "MAIN BRACKET", variant: "850/B", col: "AG" },
  { cat: "MAIN BRACKET", variant: "710/S", col: "AH" },
  { cat: "MAIN BRACKET", variant: "710/260", col: "AI" },
  { cat: "MAIN BRACKET", variant: "710/B", col: "AJ" },
  { cat: "MAIN BRACKET", variant: "1050x50/S", col: "AK" },
  { cat: "MAIN BRACKET", variant: "1050x50/260", col: "AL" },
  { cat: "MAIN BRACKET", variant: "1050x50/B", col: "AM" },
  { cat: "MAIN BRACKET", variant: "1050x65/S", col: "AN" },
  { cat: "MAIN BRACKET", variant: "1050x65/260", col: "AO" },
  { cat: "MAIN BRACKET", variant: "710X50 R1", col: "AX" },
  { cat: "MAIN BRACKET", variant: "850X50 R1", col: "AY" },
  { cat: "MAIN BRACKET", variant: "850X65 R1", col: "AZ" },
  { cat: "MAIN BRACKET", variant: "1050x65 R1", col: "BA" },
  { cat: "MAIN BRACKET", variant: "Fabricated", col: "BC" },
  { cat: "MAIN BRACKET", variant: "Home", col: "BD" },
  { cat: "MAIN BRACKET", variant: "Home Spcl", col: "BE" },
  { cat: "COUNTER BRACKET", variant: "A", col: "BF" },
  { cat: "COUNTER BRACKET", variant: "B(65-100)", col: "BG" },
  { cat: "COUNTER BRACKET", variant: "C(100-145)", col: "BH" },
  { cat: "COUNTER BRACKET", variant: "D(145-190)", col: "BI" },
  { cat: "COUNTER BRACKET", variant: "E(190-235)", col: "BJ" },
  { cat: "COUNTER BRACKET", variant: "F(235-280)", col: "BK" },
  { cat: "COUNTER BRACKET", variant: "G(280-325)", col: "BL" },
  { cat: "COUNTER BRACKET", variant: "Counter Goods Bracket", col: "BM" },
  { cat: "RAIL CLIP", variant: "Small", col: "BN" },
  { cat: "RAIL CLIP", variant: "Big", col: "BO" },
  { cat: "RAIL CLIP", variant: "Goods", col: "BP" },
  { cat: "Buffer Channel Main", variant: "942-1042", col: "BQ" },
  { cat: "Buffer Channel Main", variant: "1062-1162", col: "BR" },
  { cat: "Buffer Channel Main", variant: "1182-1292", col: "BS" },
  { cat: "Buffer Channel Main", variant: "1442-1542", col: "BU" },
  { cat: "Buffer Channel Main", variant: "GOODS", col: "BV" },
  { cat: "Buffer Channel Main", variant: "Combination", col: "BW" },
  { cat: "Buffer Channel Counter", variant: "710-B", col: "BX" },
  { cat: "Buffer Channel Counter", variant: "850-B", col: "BY" },
  { cat: "Buffer Channel Counter", variant: "1050-B", col: "BZ" },
  { cat: "Buffer Channel Counter", variant: "1550-B", col: "CA" },
  { cat: "Buffer Channel Counter", variant: "1750-B", col: "CB" },
  { cat: "Wire Rope", variant: "BELT", col: "OF" },
  { cat: "Wire Rope", variant: "Main 6mm", col: "OG" },
  { cat: "Wire Rope", variant: "Main 8mm", col: "OH" },
  { cat: "Wire Rope", variant: "Main 10mm", col: "OI" },
  { cat: "Wire Rope", variant: "Main 13mm", col: "OJ" },
  { cat: "Wire Rope", variant: "GOV 8mm", col: "OL" },
  { cat: "I-Bolt with Spring", variant: "8mm", col: "OM" },
  { cat: "I-Bolt with Spring", variant: "12mm small", col: "ON" },
  { cat: "I-Bolt with Spring", variant: "12mm big", col: "OO" },
  { cat: "I-Bolt with Spring", variant: "16mm", col: "OP" },
  { cat: "Thimble", variant: "6mm", col: "OS" },
  { cat: "Thimble", variant: "8mm", col: "OT" },
  { cat: "Bull Dog Clip", variant: "6mm", col: "OX" },
  { cat: "Bull Dog Clip", variant: "8mm", col: "OY" },
  { cat: "Bull Dog Clip", variant: "10mm", col: "OZ" },
  { cat: "Bull Dog Clip", variant: "13mm", col: "PA" },
  { cat: "Misc Hardware", variant: "D-Shackle", col: "PC" },
  { cat: "Misc Hardware", variant: "Sta. Cam", col: "PD" },
  { cat: "Buffer Spring", variant: "STD", col: "PE" },
  { cat: "Buffer Spring", variant: "HOME", col: "PF" },
  { cat: "Buffer Spring", variant: "GOODS", col: "PG" },
  { cat: "Buffer Stand", variant: "Main Stand Qty", col: "PI" },
  { cat: "Buffer Stand", variant: "Counter Stand Qty", col: "PJ" },
  { cat: "Filler Weight", variant: "550/HOME", col: "PM" },
  { cat: "Filler Weight", variant: "650/HOME", col: "PN" },
  { cat: "Filler Weight", variant: "710/AHM", col: "PO" },
  { cat: "Filler Weight", variant: "750/HOME", col: "PP" },
  { cat: "Filler Weight", variant: "850X150/AHM", col: "PS" },
  { cat: "Filler Weight", variant: "850/HOME", col: "PU" },
  { cat: "Filler Weight", variant: "850X100/AHM", col: "PV" },
  { cat: "Filler Weight", variant: "1050X200/AHM", col: "PY" },
  { cat: "Filler Weight", variant: "1050/AHM", col: "PZ" },
  { cat: "Filler Weight", variant: "1050X350/AHM", col: "QB" },
  { cat: "Cabin Rubber Pad", variant: "Square", col: "QC" },
  { cat: "Cabin Rubber Pad", variant: "Round", col: "QD" },
  { cat: "Cabin Items", variant: "Cabin Glass", col: "QG" },
  { cat: "Cabin Items", variant: "Floor Tiles", col: "QH" },
  { cat: "Cabin Items", variant: "Chequered Plate (Aluminium)", col: "QI" },
  { cat: "Cabin Items", variant: "Chequered Plate (MS)", col: "QJ" },
  { cat: "Cabin Items", variant: "Safety / Car Gate Switch", col: "QK" },
  { cat: "Cabin Items", variant: "Home Safety Switch", col: "QL" },
  { cat: "Cabin Items", variant: "PVC Cable Hanger", col: "QM" },
  { cat: "Cabin Items", variant: "Ret. Cam", col: "QN" },
  { cat: "Cabin Items", variant: "Reed Channel", col: "QO" },
  { cat: "Cabin Items", variant: "Fan Grill Square", col: "QP" },
  { cat: "Cabin Items", variant: "Fan Grill Blower", col: "QQ" },
  { cat: "Cabin Items", variant: "Fireman Switch", col: "QR" },
  { cat: "Cabin Items", variant: "Oil Pot", col: "QS" },
  { cat: "Cabin Items", variant: "Mobil T-40", col: "QT" },
  { cat: "Cabin Items", variant: "Grease 200grm", col: "QU" },
  { cat: "Cabin Items", variant: "Safety Tips Plate", col: "QV" },
  { cat: "Cabin Items", variant: "Danger Plate", col: "QW" },
  { cat: "Safety", variant: "Counter Frame 550 Home", col: "NB" },
  { cat: "Safety", variant: "Counter Frame 650 Home", col: "NC" },
  { cat: "Safety", variant: "Counter Frame 750 Home", col: "ND" },
  { cat: "Safety", variant: "Counter Frame 850 Home", col: "NE" },
  { cat: "Safety", variant: "Counter Frame 850 M", col: "NJ" },
  { cat: "Safety", variant: "Counter Frame 1050 M", col: "NK" },
  { cat: "Safety", variant: "Counter Guard Net", col: "NQ" },
  { cat: "Safety", variant: "Machine Beam Home", col: "NS" },
  { cat: "Safety", variant: "Machine Beam 2:1", col: "NT" },
  { cat: "Safety", variant: "Pit Ladder", col: "NR" },
  { cat: "Governor", variant: "CONT. STAND", col: "NY" },
  { cat: "Governor", variant: "TROUGHING 50", col: "NZ" },
  { cat: "Governor", variant: "TROUGHING 100", col: "OA" },
  { cat: "Governor", variant: "LIMIT SWITCH", col: "OB" },
  { cat: "Governor", variant: "LIMIT SWITCH BRACKET", col: "OC" },
  { cat: "Governor", variant: "MAGNET WITH BRACKET", col: "OD" },
  { cat: "Governor", variant: "PIT SWITCH", col: "OE" },
  { cat: "Safety", variant: "Main Pulley Qty", col: "MW" },
  { cat: "Safety", variant: "Counter Pulley Qty", col: "MY" },
];

// Same match rules from full-bom-import.js
const matchRules = {
  "RAIL|16/75-R": [{ exact: "Guide Rail 16X75X90" }],
  "RAIL|16-R": [{ exact: "Guide Rail 16x60x90" }, { exact: "Guide Rail 16X62X89" }],
  "RAIL|9-R": [{ exact: "Guide Rail 9X65X70" }],
  "RAIL|6-R": [{ exact: "Guide Rail 6X50X50" }],
  "Stud Anchor|8x75": [{ exact: "Stud Anchor+Nut+S.W+F.W 8X75" }],
  "Stud Anchor|10X90": [{ exact: "Stud Anchor+Nut+S.W+F.W 10X90" }],
  "Stud Anchor|12X100": [{ exact: "Stud Anchor+Nut+S.W+F.W 12X100" }],
  "Stud Anchor|12X120": [{ exact: "Stud Anchor+Nut+S.W+F.W 12X150" }],
  "BRICK|8X75": [{ exact: "Brick Dasfastner+Nut+S.W+F.W 8x75" }],
  "BRICK|12X150": [{ exact: "Brick Dasfastner+Nut+S.W+F.W 12X150(MS)" }],
  "MAIN BRACKET|Type 1 M": [{ exact: "Rail Bracket Main A-300mm" }],
  "MAIN BRACKET|Type 1 B": [{ exact: "Rail Bracket Main B (50-100)mm" }],
  "MAIN BRACKET|Type 1 C": [{ exact: "Rail Bracket Main C (100-160)mm" }],
  "MAIN BRACKET|850/S": [{ exact: "Rail Bracket Main Combination DBG-850(S)" }],
  "MAIN BRACKET|850x65/S": [{ exact: "Rail Bracket Main Combination DBG-850X65(S)" }],
  "MAIN BRACKET|850x65/260": [{ exact: "Rail Bracket Main Combination DBG-850X65(260)" }],
  "MAIN BRACKET|850/260": [{ exact: "Rail Bracket Main Combination DBG-850(260)" }],
  "MAIN BRACKET|710/S": [{ exact: "Rail Bracket Main Combination DBG-710(S)" }],
  "MAIN BRACKET|710/260": [{ exact: "Rail Bracket Main Combination DBG-710(260)" }],
  "MAIN BRACKET|1050x50/S": [{ exact: "Rail Bracket Main Combination DBG-1050X50(S)" }],
  "MAIN BRACKET|1050x50/260": [{ exact: "Rail Bracket Main Combination DBG-1050X50(260)" }],
  "MAIN BRACKET|1050x50/B": [{ exact: "Rail Bracket Main Combination DBG-1050X50(B)" }],
  "MAIN BRACKET|1050x65/S": [{ exact: "Rail Bracket Main Combination DBG-1050X65(S)" }],
  "MAIN BRACKET|1050x65/260": [{ exact: "Rail Bracket Main Combination DBG-1050X65(260)" }],
  "MAIN BRACKET|Fabricated": [{ icontains: "Fabrication Bracket" }],
  "MAIN BRACKET|Home": [{ exact: "Rail Bracket  Combination Home Special( Adj Leg) 240 Pully" }],
  "MAIN BRACKET|Home Spcl": [{ exact: "Rail Bracket  Combination Home Special( Adj Leg) 240 Pully" }],
  "COUNTER BRACKET|A": [{ exact: "Rail Bracket Counter A Common" }],
  "COUNTER BRACKET|B(65-100)": [{ exact: "Rail Bracket Counter B (65-100)mm" }],
  "COUNTER BRACKET|C(100-145)": [{ exact: "Rail Bracket Counter C (100-145)mm" }],
  "COUNTER BRACKET|D(145-190)": [{ exact: "Rail Bracket Counter D (145-190)mm" }],
  "COUNTER BRACKET|E(190-235)": [{ exact: "Rail Bracket Counter E (190-235)mm" }],
  "COUNTER BRACKET|F(235-280)": [{ exact: "Rail Bracket Counter F (235-280)mm" }],
  "COUNTER BRACKET|G(280-325)": [{ exact: "Rail Bracket Counter G(280-325)mm" }],
  "COUNTER BRACKET|Counter Goods Bracket": [{ exact: "Counter Goods Bracket" }],
  "RAIL CLIP|Small": [{ exact: "Rail Clip Small" }],
  "RAIL CLIP|Big": [{ exact: "Rail Clip Big" }],
  "RAIL CLIP|Goods": [{ exact: "Rail Clip Goods" }],
  "Buffer Channel Main|942-1042": [{ exact: "Buffer Mounting Channel Main STD DBG-942-1042" }],
  "Buffer Channel Main|1062-1162": [{ exact: "Buffer Mounting Channel Main STD DBG-1062-1162" }],
  "Buffer Channel Main|1182-1292": [{ exact: "Buffer Mounting Channel Main STD DBG-1192-1292" }],
  "Buffer Channel Main|1442-1542": [{ exact: "Buffer Mounting Channel Main STD DBG-1442- 1542" }],
  "Buffer Channel Main|GOODS": [{ exact: "Buffer Mounting Channel Main Goods" }],
  "Buffer Channel Main|Combination": [{ exact: "Buffer Mounting Channel Main STD Adjustable" }],
  "Buffer Channel Counter|710-B": [{ exact: "Buffer Mounting Channel Counter STD DBG-710" }],
  "Buffer Channel Counter|850-B": [{ exact: "Buffer Mounting Channel Counter STD DBG-850" }],
  "Buffer Channel Counter|1050-B": [{ exact: "Buffer Mounting Channel Counter STD DBG-1050" }],
  "Buffer Channel Counter|1550-B": [{ exact: "Buffer Mounting Channel Counter STD DBG-1750" }],
  "Buffer Channel Counter|1750-B": [{ exact: "Buffer Mounting Channel Counter STD DBG-1750" }],
  "Wire Rope|BELT": [{ exact: "Rope Belt New" }],
  "Wire Rope|Main 6mm": [{ exact: "Wire Rope 6mm" }],
  "Wire Rope|Main 8mm": [{ exact: "Wire Rope 8mm" }],
  "Wire Rope|Main 10mm": [{ exact: "Wire Rope 10mm" }],
  "Wire Rope|Main 13mm": [{ exact: "Wire Rope 13mm" }],
  "Wire Rope|GOV 8mm": [{ exact: "Wire Rope 8mm" }],
  "I-Bolt with Spring|8mm": [{ exact: "I-Bolt Rod 8mm (Home)" }],
  "I-Bolt with Spring|12mm small": [{ exact: "I-Bolt Rod 12mm/Small" }],
  "I-Bolt with Spring|12mm big": [{ exact: "I-Bolt Rod 12mm/Big" }],
  "I-Bolt with Spring|16mm": [{ exact: "I-Bolt Rod 16mm" }],
  "Thimble|6mm": [{ exact: "Thimbel 6mm" }],
  "Thimble|8mm": [{ exact: "Thimbel 8mm" }],
  "Bull Dog Clip|6mm": [{ exact: "Bull Dog Clip 6mm" }],
  "Bull Dog Clip|8mm": [{ exact: "Bull Dog Clip 8mm" }],
  "Bull Dog Clip|10mm": [{ exact: "Bull Dog Clip 10mm" }],
  "Bull Dog Clip|13mm": [{ exact: "Bull Dog Clip 13mm" }],
  "Misc Hardware|D-Shackle": [{ icontains: "Shackle" }],
  "Misc Hardware|Sta. Cam": [{ exact: "Stationary Cam STD" }],
  "Buffer Spring|STD": [{ exact: "Buffer Spring STD" }],
  "Buffer Spring|HOME": [{ exact: "Buffer Spring Home" }],
  "Buffer Spring|GOODS": [{ exact: "Buffer Spring Goods" }],
  "Buffer Stand|Main Stand Qty": [{ exact: "Buffer Stand Main" }],
  "Buffer Stand|Counter Stand Qty": [{ exact: "Buffer Stand Counter" }],
  "Filler Weight|550/HOME": [{ exact: "Filler Weight DBG-550/100mm(C.I)15.6kg" }],
  "Filler Weight|650/HOME": [{ exact: "Filler Weight DBG-650/100(C.I) 19.380 kg" }],
  "Filler Weight|710/AHM": [{ exact: "Filler Weight A.H.M DBG-710/150mm(M.S)" }],
  "Filler Weight|750/HOME": [{ exact: "Filler Weight DBG-750/100mm(C.I) 23.645" }],
  "Filler Weight|850X150/AHM": [{ exact: "Filler Weight A.H.M DBG-850/150mm(M.S)" }],
  "Filler Weight|850/HOME": [{ exact: "Filler Weight DBG-850/100mm(C.I) 27.545 kg" }],
  "Filler Weight|850X100/AHM": [{ exact: "Filler Weight A.H.M DBG-850/100mm(M.S) Home" }],
  "Filler Weight|1050X200/AHM": [{ exact: "Filler Weight A.H.M DBG-1050/200mm(M.S)" }],
  "Filler Weight|1050/AHM": [{ exact: "Filler Weight A.H.M DBG-1050/150mm(M.S)" }],
  "Filler Weight|1050X350/AHM": [{ exact: "Filler Weight A.H.M DBG-1050/1550-460x350x125(M.S)" }],
  "Cabin Rubber Pad|Square": [{ exact: "Cabin Rubber Pad Square(Nitrile)" }],
  "Cabin Rubber Pad|Round": [{ exact: "Cabin Rubber Pad Round" }],
  "Cabin Items|Cabin Glass": [{ icontains: "Cabin Glass" }],
  "Cabin Items|Floor Tiles": [{ exact: "Floor Tiles Auto" }],
  "Cabin Items|Chequered Plate (Aluminium)": [{ icontains: "Chequered" }],
  "Cabin Items|Chequered Plate (MS)": [{ icontains: "Chequered" }],
  "Cabin Items|Safety / Car Gate Switch": [{ icontains: "Car Gate Switch" }],
  "Cabin Items|Home Safety Switch": [{ icontains: "Home Safety" }],
  "Cabin Items|PVC Cable Hanger": [{ exact: "PVC Cable Hanger" }],
  "Cabin Items|Ret. Cam": [{ exact: "Retiring Cam Set" }],
  "Cabin Items|Reed Channel": [{ icontains: "Read Channel" }],
  "Cabin Items|Fan Grill Square": [{ exact: "Square Fan Grill" }],
  "Cabin Items|Fan Grill Blower": [{ exact: "Blower Fan Grill" }],
  "Cabin Items|Fireman Switch": [{ icontains: "Fireman" }],
  "Cabin Items|Oil Pot": [{ exact: "Oil Pot Set" }],
  "Cabin Items|Mobil T-40": [{ exact: "Mobil T-40" }],
  "Cabin Items|Grease 200grm": [{ exact: "Grease 200grm" }],
  "Cabin Items|Safety Tips Plate": [{ exact: "Safety Tips Plate" }],
  "Cabin Items|Danger Plate": [{ exact: "Danger Plate" }],
  "Safety|Counter Frame 550 Home": [{ exact: "Counter Guard G.I Home DBG-550" }],
  "Safety|Counter Frame 650 Home": [{ exact: "Counter Guard G.I Home DBG-650" }],
  "Safety|Counter Frame 750 Home": [{ exact: "Counter Guard G.I Home DBG-750" }],
  "Safety|Counter Frame 850 Home": [{ exact: "Counter Guard G.I Home DBG-850" }],
  "Safety|Counter Frame 850 M": [{ exact: "Counter Guard Net DBG-850" }],
  "Safety|Counter Frame 1050 M": [{ exact: "Counter Guard Net DBG-1050x50" }],
  "Safety|Counter Guard Net": [{ exact: "Counter Guard Net DBG-850" }],
  "Safety|Machine Beam Home": [{ icontains: "Machine Beam" }],
  "Safety|Machine Beam 2:1": [{ icontains: "Machine Beam" }],
  "Safety|Pit Ladder": [{ exact: "Pit Ladder" }],
  "Safety|Main Pulley Qty": [{ icontains: "Pulley" }],
  "Safety|Counter Pulley Qty": [{ icontains: "Pulley" }],
  "Governor|CONT. STAND": [{ icontains: "Governor" }],
  "Governor|TROUGHING 50": [{ icontains: "Troughing" }],
  "Governor|TROUGHING 100": [{ icontains: "Troughing" }],
  "Governor|LIMIT SWITCH": [{ exact: "Limit Switch LSR" }],
  "Governor|LIMIT SWITCH BRACKET": [{ exact: "Limit Switch Bkt STD" }],
  "Governor|MAGNET WITH BRACKET": [{ exact: "Magnet Bracket STD" }],
  "Governor|PIT SWITCH": [{ exact: "Pit Switch Box" }],
};

function findItem(items, patterns) {
  for (const pat of patterns) {
    const found = items.find(i => {
      if (pat.exact) return i.lookup_key === pat.exact;
      if (pat.icontains) return i.lookup_key.toLowerCase().includes(pat.icontains.toLowerCase());
      if (pat.regex) return pat.regex.test(i.lookup_key);
      return false;
    });
    if (found) return found;
  }
  return null;
}

// Door column definitions (same as full-bom-import.js)
const CO_START = colLetterToIndex('EW');
const CO_OPENINGS = [600, 700, 800, 900, 1000, 1200];
const CO_LINTON_START = colLetterToIndex('EZ');
const CO_PANEL_START = colLetterToIndex('FF');

const AT_START = colLetterToIndex('GP');
const AT_OPENINGS = [600, 700, 750, 800, 900, 1000, 1200];
const AT_LINTON_START = colLetterToIndex('GS');
const AT_PANEL_START = colLetterToIndex('GZ');

const AFF_START = colLetterToIndex('IL');
const AFF_OPENINGS = [1000, 1200, 1400, 1600, 1800, 2000, 2200];
const AFF_LINTON_START = colLetterToIndex('IO');
const AFF_PANEL_START = colLetterToIndex('IV');

const COLL_START = colLetterToIndex('CD');
const COLL_OPENINGS = [850, 930, 980, 1100, 1220, 1460, 1580, 1700, 1820, 2180, 2400, 3020, 3620];

const HDR_START = colLetterToIndex('KL');
const HDR_AT_START = colLetterToIndex('LB');
const HDR_AFF_START = colLetterToIndex('MF');

async function main() {
  console.log('=== Save Column Map to target_column_map ===\n');

  // Fetch all items
  let items = [];
  let offset = 0;
  while (true) {
    const batch = await supaFetch(`items?select=id,lookup_key&limit=1000&offset=${offset}`);
    items = items.concat(batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`Loaded ${items.length} items`);

  // Read Excel headers for column labels
  const xlPath = path.join('C:', 'Users', 'yash_', 'Downloads', 'Target List (5).xlsx');
  const wb = XLSX.readFile(xlPath, { type: 'file' });
  const ws = wb.Sheets['TARGET'] || wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const headerRows = data.slice(0, 4);

  function getColumnLabel(colIdx) {
    for (let r = 0; r < headerRows.length; r++) {
      const val = headerRows[r] && headerRows[r][colIdx];
      if (val && String(val).trim()) return String(val).trim();
    }
    return indexToColLetter(colIdx);
  }

  const rows = [];

  // 1. Direct BOM columns
  for (const entry of bomMap) {
    const key = `${entry.cat}|${entry.variant}`;
    const colIdx = colLetterToIndex(entry.col);
    const rules = matchRules[key];
    if (!rules) {
      rows.push({
        column_index: colIdx,
        column_label: getColumnLabel(colIdx),
        item_lookup_key: null,
        item_id: null,
        category: entry.cat,
        is_active: true,
        notes: `${entry.variant} — no match rule`
      });
      continue;
    }
    const item = findItem(items, rules);
    rows.push({
      column_index: colIdx,
      column_label: getColumnLabel(colIdx),
      item_lookup_key: item ? item.lookup_key : null,
      item_id: item ? item.id : null,
      category: entry.cat,
      is_active: true,
      notes: item ? `${entry.variant}` : `${entry.variant} — no item match`
    });
  }

  // 2. CO door columns
  // CO Lintons
  for (let i = 0; i < CO_OPENINGS.length; i++) {
    const colIdx = CO_LINTON_START + i;
    rows.push({
      column_index: colIdx,
      column_label: getColumnLabel(colIdx),
      item_lookup_key: `Auto Door Linton Pannel CO {mat}/${CO_OPENINGS[i]}mm`,
      item_id: null,
      category: 'CO_DOOR',
      is_active: true,
      notes: `CO linton ${CO_OPENINGS[i]}mm — material-dependent`
    });
  }

  // CO Panels
  const VISIONS = ['NV', 'MV', 'LV'];
  const CO_HEIGHTS = ['2000', '2100'];
  for (let oi = 0; oi < 6; oi++) {
    const opening = CO_OPENINGS[oi];
    for (let vi = 0; vi < 3; vi++) {
      for (let hi = 0; hi < 2; hi++) {
        const colIdx = CO_PANEL_START + oi * 6 + vi * 2 + hi;
        const sizeLabel = CO_HEIGHTS[hi] === '2000' ? 'STD' : 'BIG';
        rows.push({
          column_index: colIdx,
          column_label: getColumnLabel(colIdx),
          item_lookup_key: `Car Pannel CO/{mat}/${VISIONS[vi]}/${opening}(${sizeLabel})`,
          item_id: null,
          category: 'CO_DOOR',
          is_active: true,
          notes: `CO panel ${opening}/${VISIONS[vi]}/${sizeLabel} — material-dependent`
        });
      }
    }
  }

  // AT Lintons
  for (let i = 0; i < AT_OPENINGS.length; i++) {
    const colIdx = AT_LINTON_START + i;
    rows.push({
      column_index: colIdx,
      column_label: getColumnLabel(colIdx),
      item_lookup_key: `Auto Door Linton Pannel SO {mat}/${AT_OPENINGS[i]}mm`,
      item_id: null,
      category: 'AT_DOOR',
      is_active: true,
      notes: `AT linton ${AT_OPENINGS[i]}mm — material-dependent`
    });
  }

  // AT Panels
  const AT_ORIENTATIONS = ['RH', 'LH'];
  for (let oi = 0; oi < 7; oi++) {
    const opening = AT_OPENINGS[oi];
    for (let vi = 0; vi < 3; vi++) {
      for (let ori = 0; ori < 2; ori++) {
        const colIdx = AT_PANEL_START + oi * 6 + vi * 2 + ori;
        rows.push({
          column_index: colIdx,
          column_label: getColumnLabel(colIdx),
          item_lookup_key: `Car Pannel AT/{mat}/${VISIONS[vi]}/${opening}`,
          item_id: null,
          category: 'AT_DOOR',
          is_active: true,
          notes: `AT panel ${opening}/${VISIONS[vi]}/${AT_ORIENTATIONS[ori]} — material-dependent`
        });
      }
    }
  }

  // AFF Lintons
  for (let i = 0; i < AFF_OPENINGS.length; i++) {
    const colIdx = AFF_LINTON_START + i;
    rows.push({
      column_index: colIdx,
      column_label: getColumnLabel(colIdx),
      item_lookup_key: `Auto Door Linton Pannel AFF {mat}/${AFF_OPENINGS[i]}mm`,
      item_id: null,
      category: 'AFF_DOOR',
      is_active: true,
      notes: `AFF linton ${AFF_OPENINGS[i]}mm — material-dependent`
    });
  }

  // AFF Panels
  for (let oi = 0; oi < 7; oi++) {
    const opening = AFF_OPENINGS[oi];
    for (let vi = 0; vi < 3; vi++) {
      for (let hi = 0; hi < 2; hi++) {
        const colIdx = AFF_PANEL_START + oi * 6 + vi * 2 + hi;
        rows.push({
          column_index: colIdx,
          column_label: getColumnLabel(colIdx),
          item_lookup_key: `Car Pannel AFF {mat}/${opening}mm/${VISIONS[vi]}`,
          item_id: null,
          category: 'AFF_DOOR',
          is_active: true,
          notes: `AFF panel ${opening}/${VISIONS[vi]}/${CO_HEIGHTS[hi]} — material-dependent`
        });
      }
    }
  }

  // Collapsible doors
  for (let oi = 0; oi < COLL_OPENINGS.length; oi++) {
    const opening = COLL_OPENINGS[oi];
    const baseIdx = COLL_START + oi * 3;
    rows.push({
      column_index: baseIdx,
      column_label: getColumnLabel(baseIdx),
      item_lookup_key: 'Collapsible Door Post Industrial/LHS',
      item_id: null,
      category: 'COLLAPSIBLE_DOOR',
      is_active: true,
      notes: `Collapsible frame LH ${opening}mm`
    });
    rows.push({
      column_index: baseIdx + 1,
      column_label: getColumnLabel(baseIdx + 1),
      item_lookup_key: 'Collapsible Door Post Industrial/RHS',
      item_id: null,
      category: 'COLLAPSIBLE_DOOR',
      is_active: true,
      notes: `Collapsible frame RH ${opening}mm`
    });
    rows.push({
      column_index: baseIdx + 2,
      column_label: getColumnLabel(baseIdx + 2),
      item_lookup_key: `Collapsible Top Bottom set OPP-${opening}`,
      item_id: null,
      category: 'COLLAPSIBLE_DOOR',
      is_active: true,
      notes: `Collapsible gate ${opening}mm`
    });
  }

  // Header System CO Landing
  const hdrCoOpenings = [600, 700, 800, 900, 1000, 1200];
  for (let i = 0; i < hdrCoOpenings.length; i++) {
    const colIdx = HDR_START + i;
    rows.push({
      column_index: colIdx,
      column_label: getColumnLabel(colIdx),
      item_lookup_key: `Landing Header System CO ${hdrCoOpenings[i]}mm`,
      item_id: null,
      category: 'HEADER_SYSTEM',
      is_active: true,
      notes: `CO landing header ${hdrCoOpenings[i]}mm`
    });
  }
  // CO fire landing headers (slots 6,7)
  rows.push({ column_index: HDR_START + 6, column_label: getColumnLabel(HDR_START + 6), item_lookup_key: 'Landing Header System CO 900mm (Fire)', item_id: null, category: 'HEADER_SYSTEM', is_active: true, notes: 'CO fire landing header 900mm' });
  rows.push({ column_index: HDR_START + 7, column_label: getColumnLabel(HDR_START + 7), item_lookup_key: 'Landing Header System CO 1000mm (Fire)', item_id: null, category: 'HEADER_SYSTEM', is_active: true, notes: 'CO fire landing header 1000mm' });

  // CO Car headers
  for (let i = 0; i < hdrCoOpenings.length; i++) {
    const colIdx = HDR_START + 8 + i;
    rows.push({
      column_index: colIdx,
      column_label: getColumnLabel(colIdx),
      item_lookup_key: `Car Header System CO ${hdrCoOpenings[i]}mm`,
      item_id: null,
      category: 'HEADER_SYSTEM',
      is_active: true,
      notes: `CO car header ${hdrCoOpenings[i]}mm`
    });
  }
  rows.push({ column_index: HDR_START + 14, column_label: getColumnLabel(HDR_START + 14), item_lookup_key: 'Car Header System CO 900mm (Fire)', item_id: null, category: 'HEADER_SYSTEM', is_active: true, notes: 'CO fire car header 900mm' });
  rows.push({ column_index: HDR_START + 15, column_label: getColumnLabel(HDR_START + 15), item_lookup_key: 'Car Header System CO 1000mm (Fire)', item_id: null, category: 'HEADER_SYSTEM', is_active: true, notes: 'CO fire car header 1000mm' });

  // AT Headers
  const atLhsOpenings = [600, 700, 750, 800, 900, 1000, 1200];
  const atRhsOpenings = [600, 700, 800, 900, 1000, 1200];
  for (let i = 0; i < atLhsOpenings.length; i++) {
    rows.push({ column_index: HDR_AT_START + i, column_label: getColumnLabel(HDR_AT_START + i), item_lookup_key: `Landing Header System  AT LHS/${atLhsOpenings[i]}mm`, item_id: null, category: 'HEADER_SYSTEM', is_active: true, notes: `AT landing LHS ${atLhsOpenings[i]}mm` });
  }
  for (let i = 0; i < atRhsOpenings.length; i++) {
    rows.push({ column_index: HDR_AT_START + 7 + i, column_label: getColumnLabel(HDR_AT_START + 7 + i), item_lookup_key: `Landing Header System  AT RHS/${atRhsOpenings[i]}mm`, item_id: null, category: 'HEADER_SYSTEM', is_active: true, notes: `AT landing RHS ${atRhsOpenings[i]}mm` });
  }
  for (let i = 0; i < atLhsOpenings.length; i++) {
    rows.push({ column_index: HDR_AT_START + 13 + i, column_label: getColumnLabel(HDR_AT_START + 13 + i), item_lookup_key: `Car Header System  AT LHS/${atLhsOpenings[i]}mm`, item_id: null, category: 'HEADER_SYSTEM', is_active: true, notes: `AT car LHS ${atLhsOpenings[i]}mm` });
  }
  for (let i = 0; i < atRhsOpenings.length; i++) {
    rows.push({ column_index: HDR_AT_START + 20 + i, column_label: getColumnLabel(HDR_AT_START + 20 + i), item_lookup_key: `Car Header System AT RHS/${atRhsOpenings[i]}mm`, item_id: null, category: 'HEADER_SYSTEM', is_active: true, notes: `AT car RHS ${atRhsOpenings[i]}mm` });
  }

  // AFF Headers
  const affOpenings = [1000, 1200, 1400, 1500, 1600, 1800, 2000];
  for (let i = 0; i < affOpenings.length; i++) {
    rows.push({ column_index: HDR_AFF_START + i, column_label: getColumnLabel(HDR_AFF_START + i), item_lookup_key: `Landing Header System  AFF ${affOpenings[i]}mm`, item_id: null, category: 'HEADER_SYSTEM', is_active: true, notes: `AFF landing header ${affOpenings[i]}mm` });
  }
  for (let i = 0; i < affOpenings.length; i++) {
    rows.push({ column_index: HDR_AFF_START + 7 + i, column_label: getColumnLabel(HDR_AFF_START + 7 + i), item_lookup_key: `Car Header System  AFF ${affOpenings[i]}mm`, item_id: null, category: 'HEADER_SYSTEM', is_active: true, notes: `AFF car header ${affOpenings[i]}mm` });
  }

  // De-duplicate by column_index (keep first occurrence)
  const seen = new Set();
  const uniqueRows = [];
  for (const row of rows) {
    if (!seen.has(row.column_index)) {
      seen.add(row.column_index);
      uniqueRows.push(row);
    }
  }

  console.log(`\nTotal column map entries: ${uniqueRows.length}`);
  const withItem = uniqueRows.filter(r => r.item_id).length;
  const doorDynamic = uniqueRows.filter(r => r.item_lookup_key && r.item_lookup_key.includes('{mat}')).length;
  const doorStatic = uniqueRows.filter(r => !r.item_id && r.item_lookup_key && !r.item_lookup_key.includes('{mat}')).length;
  console.log(`  Direct item match: ${withItem}`);
  console.log(`  Door (material-dependent): ${doorDynamic}`);
  console.log(`  Door/Header (static pattern): ${doorStatic}`);

  // Insert in batches
  console.log('\nInserting into target_column_map...');
  const batchSize = 50;
  for (let i = 0; i < uniqueRows.length; i += batchSize) {
    const batch = uniqueRows.slice(i, i + batchSize);
    await supaFetch('target_column_map', {
      method: 'POST',
      body: JSON.stringify(batch)
    });
    console.log(`  Inserted ${Math.min(i + batchSize, uniqueRows.length)}/${uniqueRows.length}`);
  }

  console.log('\nDone! Column map saved to target_column_map table.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
