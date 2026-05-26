const XLSX = require('xlsx');
const path = require('path');

const SUPABASE_URL = 'https://qwzisnmueuqnzzokkpmn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14';

// --- Column letter utilities ---
function colLetterToIndex(letter) {
  let idx = 0;
  for (let i = 0; i < letter.length; i++) {
    idx = idx * 26 + (letter.charCodeAt(i) - 64);
  }
  return idx - 1; // 0-based
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

// --- BOM Mapping from the mapping document ---
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
  // Wire Rope
  { cat: "Wire Rope", variant: "BELT", col: "OF" },
  { cat: "Wire Rope", variant: "Main 6mm", col: "OG" },
  { cat: "Wire Rope", variant: "Main 8mm", col: "OH" },
  { cat: "Wire Rope", variant: "Main 10mm", col: "OI" },
  { cat: "Wire Rope", variant: "Main 13mm", col: "OJ" },
  { cat: "Wire Rope", variant: "GOV 8mm", col: "OL" },
  // I-Bolt with Spring
  { cat: "I-Bolt with Spring", variant: "8mm", col: "OM" },
  { cat: "I-Bolt with Spring", variant: "12mm small", col: "ON" },
  { cat: "I-Bolt with Spring", variant: "12mm big", col: "OO" },
  { cat: "I-Bolt with Spring", variant: "16mm", col: "OP" },
  // Thimble
  { cat: "Thimble", variant: "6mm", col: "OS" },
  { cat: "Thimble", variant: "8mm", col: "OT" },
  // Bull Dog Clip
  { cat: "Bull Dog Clip", variant: "6mm", col: "OX" },
  { cat: "Bull Dog Clip", variant: "8mm", col: "OY" },
  { cat: "Bull Dog Clip", variant: "10mm", col: "OZ" },
  { cat: "Bull Dog Clip", variant: "13mm", col: "PA" },
  // Misc
  { cat: "Misc Hardware", variant: "D-Shackle", col: "PC" },
  { cat: "Misc Hardware", variant: "Sta. Cam", col: "PD" },
  // Buffer Spring
  { cat: "Buffer Spring", variant: "STD", col: "PE" },
  { cat: "Buffer Spring", variant: "HOME", col: "PF" },
  { cat: "Buffer Spring", variant: "GOODS", col: "PG" },
  // Buffer Stand
  { cat: "Buffer Stand", variant: "Main Stand Qty", col: "PI" },
  { cat: "Buffer Stand", variant: "Counter Stand Qty", col: "PJ" },
  // Filler Weight
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
  // Cabin Rubber Pad
  { cat: "Cabin Rubber Pad", variant: "Square", col: "QC" },
  { cat: "Cabin Rubber Pad", variant: "Round", col: "QD" },
  // Cabin Items
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
  // Safety (text-valued / metadata columns that store qty)
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
  // Governor accessories (qty columns)
  { cat: "Governor", variant: "CONT. STAND", col: "NY" },
  { cat: "Governor", variant: "TROUGHING 50", col: "NZ" },
  { cat: "Governor", variant: "TROUGHING 100", col: "OA" },
  { cat: "Governor", variant: "LIMIT SWITCH", col: "OB" },
  { cat: "Governor", variant: "LIMIT SWITCH BRACKET", col: "OC" },
  { cat: "Governor", variant: "MAGNET WITH BRACKET", col: "OD" },
  { cat: "Governor", variant: "PIT SWITCH", col: "OE" },
  // Safety pulley qty columns
  { cat: "Safety", variant: "Main Pulley Qty", col: "MW" },
  { cat: "Safety", variant: "Counter Pulley Qty", col: "MY" },
];

// Door column definitions from mapping doc
// CO (Centre Opening): EW..GO (45 cols)
// AT (Auto Telescopic): GP..IK (48 cols)
// AFF (Auto Four-Fold): IL..KK (52 cols)
// Collapsible: CD..DP (39 cols)
// Header System: KL..MS (60 cols)

// CO structure (45 cols starting at EW = index 152)
// EW = frame_material (text)
// EX, EY = frame_height 2000, 2100
// EZ-FE = linton per opening: 600,700,800,900,1000,1200
// FF-GO = panels: 6 openings x 6 cols (NV-2000,NV-2100,MV-2000,MV-2100,LV-2000,LV-2100)
const CO_START = colLetterToIndex('EW'); // 152
const CO_OPENINGS = [600, 700, 800, 900, 1000, 1200];
const CO_LINTON_START = colLetterToIndex('EZ'); // 155
const CO_PANEL_START = colLetterToIndex('FF'); // 161

// AT structure (48 cols starting at GP = index 197)
// GP = frame_material (text)
// GQ = frame_rh, GR = frame_lh
// GS-GY = linton per opening: 600,700,750,800,900,1000,1200
// GZ-IK = panels: 7 openings x 6 cols (NV-RH,NV-LH,MV-RH,MV-LH,LV-RH,LV-LH)
const AT_START = colLetterToIndex('GP'); // 197
const AT_OPENINGS = [600, 700, 750, 800, 900, 1000, 1200];
const AT_LINTON_START = colLetterToIndex('GS'); // 200
const AT_PANEL_START = colLetterToIndex('GZ'); // 207

// AFF structure (52 cols starting at IL = index 245)
// IL = frame_material (text)
// IM, IN = frame_height 2000, 2100
// IO-IU = linton per opening: 1000,1200,1400,1600,1800,2000,2200
// IV-KK = panels: 7 openings x 6 cols (NV-2000,NV-2100,MV-2000,MV-2100,LV-2000,LV-2100)
const AFF_START = colLetterToIndex('IL'); // 245
const AFF_OPENINGS = [1000, 1200, 1400, 1600, 1800, 2000, 2200];
const AFF_LINTON_START = colLetterToIndex('IO'); // 248
const AFF_PANEL_START = colLetterToIndex('IV'); // 255

// Collapsible: CD..DP (39 cols starting at CD = index 81)
// 13 openings: 850,930,980,1100,1220,1460,1580,1700,1820,2180,2400,3020,3620
// 3 cols per opening: frame_lh, frame_rh, gate_count
const COLL_START = colLetterToIndex('CD'); // 81
const COLL_OPENINGS = [850, 930, 980, 1100, 1220, 1460, 1580, 1700, 1820, 2180, 2400, 3020, 3620];

// Header System: KL..MS (60 cols starting at KL = index 297)
// CO headers (16 cols): 8 landing + 8 car for sizes 600,700,800,900,1000,1200,+ 2 extra
// Side Opening headers (40 cols): landing + car for AT sizes 600,700,750,800,900,1000,1200 x LHS/RHS
// Four Fold headers (14 cols): 7 landing + 7 car for sizes 1000,1200,1400,1500,1600,1800,2000
const HDR_START = colLetterToIndex('KL'); // 297

// Header System CO (first 16 cols: KL..LA)
const HDR_CO_LANDING_OPENINGS = [600, 700, 800, 900, 1000, 1200, 900, 1000]; // last 2 are fire variants
const HDR_CO_CAR_OPENINGS = [600, 700, 800, 900, 1000, 1200, 900, 1000]; // fire variants

// Header System AT/Side Opening (next 28 cols: LB..ME)
// landing LHS: 600,700,750,800,900,1000,1200
// landing RHS: 600,700,800,900,1000,1200
// car LHS: 600,700,750,800,900,1000,1200
// car RHS: 600,700,800,900,1000,1200
const HDR_AT_START = colLetterToIndex('LB'); // 313
const HDR_AT_LANDING_LHS_OPENINGS = [600, 700, 750, 800, 900, 1000, 1200];
const HDR_AT_LANDING_RHS_OPENINGS = [600, 700, 800, 900, 1000, 1200];
const HDR_AT_CAR_LHS_OPENINGS = [600, 700, 750, 800, 900, 1000, 1200];
const HDR_AT_CAR_RHS_OPENINGS = [600, 700, 800, 900, 1000, 1200];

// Header System AFF (last 14 cols: MF..MS)
const HDR_AFF_START = colLetterToIndex('MF'); // 343
const HDR_AFF_OPENINGS = [1000, 1200, 1400, 1500, 1600, 1800, 2000];

// --- Item matching functions ---
function findItem(items, patterns) {
  for (const pat of patterns) {
    const found = items.find(i => {
      if (pat.exact) return i.lookup_key === pat.exact;
      if (pat.startsWith && pat.contains)
        return i.lookup_key.startsWith(pat.startsWith) && i.lookup_key.includes(pat.contains);
      if (pat.startsWith) return i.lookup_key.startsWith(pat.startsWith);
      if (pat.contains) return i.lookup_key.includes(pat.contains);
      if (pat.icontains) return i.lookup_key.toLowerCase().includes(pat.icontains.toLowerCase());
      if (pat.regex) return pat.regex.test(i.lookup_key);
      return false;
    });
    if (found) return found;
  }
  return null;
}

function buildColumnItemMap(items) {
  const colMap = {}; // colIndex -> item_id
  const unmatchedCols = [];

  // --- Simple BOM columns ---
  const matchRules = {
    "RAIL|16/75-R": [{ exact: "Guide Rail 16X75X90" }],
    "RAIL|16-R": [{ exact: "Guide Rail 16x60x90" }, { exact: "Guide Rail 16X62X89" }],
    "RAIL|9-R": [{ exact: "Guide Rail 9X65X70" }],
    "RAIL|6-R": [{ exact: "Guide Rail 6X50X50" }],
    "Stud Anchor|8x75": [{ exact: "Stud Anchor+Nut+S.W+F.W 8X75" }],
    "Stud Anchor|10X90": [{ exact: "Stud Anchor+Nut+S.W+F.W 10X90" }],
    "Stud Anchor|12X100": [{ exact: "Stud Anchor+Nut+S.W+F.W 12X100" }],
    "Stud Anchor|12X120": [{ exact: "Stud Anchor+Nut+S.W+F.W 12X150" }], // closest match
    "BRICK|8X75": [{ exact: "Brick Dasfastner+Nut+S.W+F.W 8x75" }],
    "BRICK|12X150": [{ exact: "Brick Dasfastner+Nut+S.W+F.W 12X150(MS)" }],
    "MAIN BRACKET|Type 1 M": [{ exact: "Rail Bracket Main A-300mm" }],
    "MAIN BRACKET|Type 1 B": [{ exact: "Rail Bracket Main B (50-100)mm" }],
    "MAIN BRACKET|Type 1 C": [{ exact: "Rail Bracket Main C (100-160)mm" }],
    "MAIN BRACKET|850/S": [{ exact: "Rail Bracket Main Combination DBG-850(S)" }, { icontains: "Combination" }, { regex: /Rail Bracket Main.*850.*S/ }],
    "MAIN BRACKET|850x65/S": [{ exact: "Rail Bracket Main Combination DBG-850X65(S)" }, { regex: /Rail Bracket Main.*850.*65.*S/ }],
    "MAIN BRACKET|850x65/260": [{ exact: "Rail Bracket Main Combination DBG-850X65(260)" }, { regex: /Rail Bracket Main.*850.*65.*260/ }],
    "MAIN BRACKET|850/260": [{ exact: "Rail Bracket Main Combination DBG-850(260)" }, { regex: /Rail Bracket Main.*850.*260/ }],
    "MAIN BRACKET|850/B": [{ exact: "Rail Bracket Main Combination DBG-850(B)" }, { regex: /Rail Bracket Main.*850.*B/ }],
    "MAIN BRACKET|710/S": [{ exact: "Rail Bracket Main Combination DBG-710(S)" }, { regex: /Rail Bracket Main.*710.*S/ }],
    "MAIN BRACKET|710/260": [{ exact: "Rail Bracket Main Combination DBG-710(260)" }, { regex: /Rail Bracket Main.*710.*260/ }],
    "MAIN BRACKET|710/B": [{ exact: "Rail Bracket Main Combination DBG-710(B)" }, { regex: /Rail Bracket Main.*710.*B/ }],
    "MAIN BRACKET|1050x50/S": [{ exact: "Rail Bracket Main Combination DBG-1050X50(S)" }, { regex: /Rail Bracket Main.*1050.*50.*S/ }],
    "MAIN BRACKET|1050x50/260": [{ exact: "Rail Bracket Main Combination DBG-1050X50(260)" }, { regex: /Rail Bracket Main.*1050.*50.*260/ }],
    "MAIN BRACKET|1050x50/B": [{ exact: "Rail Bracket Main Combination DBG-1050X50(B)" }, { regex: /Rail Bracket Main.*1050.*50.*B/ }],
    "MAIN BRACKET|1050x65/S": [{ exact: "Rail Bracket Main Combination DBG-1050X65(S)" }, { regex: /Rail Bracket Main.*1050.*65.*S/ }],
    "MAIN BRACKET|1050x65/260": [{ exact: "Rail Bracket Main Combination DBG-1050X65(260)" }, { regex: /Rail Bracket Main.*1050.*65.*260/ }],
    "MAIN BRACKET|710X50 R1": [{ regex: /Rail Bracket Main.*710.*50.*R1/ }],
    "MAIN BRACKET|850X50 R1": [{ regex: /Rail Bracket Main.*850.*50.*R1/ }],
    "MAIN BRACKET|850X65 R1": [{ regex: /Rail Bracket Main.*850.*65.*R1/ }],
    "MAIN BRACKET|1050x65 R1": [{ regex: /Rail Bracket Main.*1050.*65.*R1/ }],
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
    "Buffer Channel Counter|1550-B": [{ exact: "Buffer Mounting Channel Counter STD DBG-1750" }], // closest
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
    "Misc Hardware|D-Shackle": [{ icontains: "D\" Shackle" }, { icontains: "Shackle" }],
    "Misc Hardware|Sta. Cam": [{ exact: "Stationary Cam STD" }, { icontains: "Stationary Cam" }],
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
    "Cabin Items|Home Safety Switch": [{ icontains: "Home Safety" }, { icontains: "Safety Switch" }],
    "Cabin Items|PVC Cable Hanger": [{ exact: "PVC Cable Hanger" }],
    "Cabin Items|Ret. Cam": [{ exact: "Retiring Cam Set" }],
    "Cabin Items|Reed Channel": [{ icontains: "Read Channel" }],
    "Cabin Items|Fan Grill Square": [{ exact: "Square Fan Grill" }],
    "Cabin Items|Fan Grill Blower": [{ exact: "Blower Fan Grill" }],
    "Cabin Items|Fireman Switch": [{ icontains: "Fireman" }, { exact: "Final Limit Switch N/C" }],
    "Cabin Items|Oil Pot": [{ exact: "Oil Pot Set" }],
    "Cabin Items|Mobil T-40": [{ exact: "Mobil T-40" }],
    "Cabin Items|Grease 200grm": [{ exact: "Grease 200grm" }],
    "Cabin Items|Safety Tips Plate": [{ exact: "Safety Tips Plate" }],
    "Cabin Items|Danger Plate": [{ exact: "Danger Plate" }],
    // Safety qty columns
    "Safety|Counter Frame 550 Home": [{ exact: "Counter Guard G.I Home DBG-550" }],
    "Safety|Counter Frame 650 Home": [{ exact: "Counter Guard G.I Home DBG-650" }],
    "Safety|Counter Frame 750 Home": [{ exact: "Counter Guard G.I Home DBG-750" }],
    "Safety|Counter Frame 850 Home": [{ exact: "Counter Guard G.I Home DBG-850" }],
    "Safety|Counter Frame 850 M": [{ exact: "Counter Guard Net DBG-850" }],
    "Safety|Counter Frame 1050 M": [{ exact: "Counter Guard Net DBG-1050x50" }],
    "Safety|Counter Guard Net": [{ exact: "Counter Guard Net DBG-850" }],
    "Safety|Machine Beam Home": [{ icontains: "Machine Beam" }, { icontains: "Isolation Channel" }],
    "Safety|Machine Beam 2:1": [{ icontains: "Machine Beam" }],
    "Safety|Pit Ladder": [{ exact: "Pit Ladder" }],
    "Safety|Main Pulley Qty": [{ icontains: "Pulley" }],
    "Safety|Counter Pulley Qty": [{ icontains: "Pulley" }],
    // Governor accessories
    "Governor|CONT. STAND": [{ icontains: "Governor" }],
    "Governor|TROUGHING 50": [{ icontains: "Troughing" }],
    "Governor|TROUGHING 100": [{ icontains: "Troughing" }],
    "Governor|LIMIT SWITCH": [{ exact: "Limit Switch LSR" }, { icontains: "Limit Switch" }],
    "Governor|LIMIT SWITCH BRACKET": [{ exact: "Limit Switch Bkt STD" }],
    "Governor|MAGNET WITH BRACKET": [{ exact: "Magnet Bracket STD" }],
    "Governor|PIT SWITCH": [{ exact: "Pit Switch Box" }],
  };

  // Match bomMap entries to items
  for (const entry of bomMap) {
    const key = `${entry.cat}|${entry.variant}`;
    const colIdx = colLetterToIndex(entry.col);
    const rules = matchRules[key];
    if (!rules) {
      unmatchedCols.push({ col: entry.col, colIdx, cat: entry.cat, variant: entry.variant, reason: 'no rule' });
      continue;
    }
    const item = findItem(items, rules);
    if (item) {
      colMap[colIdx] = { item_id: item.id, lookup_key: item.lookup_key, cat: entry.cat, variant: entry.variant };
    } else {
      unmatchedCols.push({ col: entry.col, colIdx, cat: entry.cat, variant: entry.variant, reason: 'no item match' });
    }
  }

  // --- Door panel columns ---
  // These need material from a separate column per job, so we build them differently
  // We'll store door column metadata and resolve per-job later

  // CO Lintons
  for (let i = 0; i < CO_OPENINGS.length; i++) {
    const colIdx = CO_LINTON_START + i;
    const opening = CO_OPENINGS[i];
    // Linton items: "Auto Door Linton Pannel CO MS/700mm" or "Auto Door Linton Pannel CO SS/700mm"
    // Material depends on frame_material column (EW) - resolve per job
    colMap[colIdx] = { doorType: 'CO', purpose: 'linton', opening, itemPattern: `Auto Door Linton Pannel CO {mat}/${opening}mm` };
  }

  // CO Panels (36 cols)
  const VISIONS = ['NV', 'MV', 'LV'];
  const CO_HEIGHTS = ['2000', '2100']; // STD, BIG in lookup_key terms
  for (let oi = 0; oi < 6; oi++) { // 6 openings (600 not listed in linton but may be in panels)
    const opening = CO_OPENINGS[oi];
    for (let vi = 0; vi < 3; vi++) {
      for (let hi = 0; hi < 2; hi++) {
        const colIdx = CO_PANEL_START + oi * 6 + vi * 2 + hi;
        const vision = VISIONS[vi];
        const height = CO_HEIGHTS[hi];
        // "Car Pannel CO/SS/NV/700(STD)" or "Car Pannel CO/SS/NV/700(BIG)"
        const sizeLabel = height === '2000' ? 'STD' : 'BIG';
        colMap[colIdx] = { doorType: 'CO', purpose: 'panel', opening, vision, height, sizeLabel,
          itemPattern: `Car Pannel CO/{mat}/${vision}/${opening}(${sizeLabel})` };
      }
    }
  }

  // AT Lintons
  for (let i = 0; i < AT_OPENINGS.length; i++) {
    const colIdx = AT_LINTON_START + i;
    const opening = AT_OPENINGS[i];
    // "Auto Door Linton Pannel SO MS/700mm" (SO = Side Opening = AT)
    colMap[colIdx] = { doorType: 'AT', purpose: 'linton', opening, itemPattern: `Auto Door Linton Pannel SO {mat}/${opening}mm` };
  }

  // AT Panels (42 cols: 7 openings x 6 cols per opening)
  const AT_ORIENTATIONS = ['RH', 'LH'];
  for (let oi = 0; oi < 7; oi++) {
    const opening = AT_OPENINGS[oi];
    for (let vi = 0; vi < 3; vi++) {
      for (let ori = 0; ori < 2; ori++) {
        const colIdx = AT_PANEL_START + oi * 6 + vi * 2 + ori;
        const vision = VISIONS[vi];
        const orientation = AT_ORIENTATIONS[ori];
        // "Car Pannel AT/SS/NV/700" - AT panels don't encode orientation in lookup_key
        colMap[colIdx] = { doorType: 'AT', purpose: 'panel', opening, vision, orientation,
          itemPattern: `Car Pannel AT/{mat}/${vision}/${opening}` };
      }
    }
  }

  // AFF Lintons
  for (let i = 0; i < AFF_OPENINGS.length; i++) {
    const colIdx = AFF_LINTON_START + i;
    const opening = AFF_OPENINGS[i];
    colMap[colIdx] = { doorType: 'AFF', purpose: 'linton', opening, itemPattern: `Auto Door Linton Pannel AFF {mat}/${opening}mm` };
  }

  // AFF Panels (42 cols: 7 openings x 6)
  for (let oi = 0; oi < 7; oi++) {
    const opening = AFF_OPENINGS[oi];
    for (let vi = 0; vi < 3; vi++) {
      for (let hi = 0; hi < 2; hi++) {
        const colIdx = AFF_PANEL_START + oi * 6 + vi * 2 + hi;
        const vision = VISIONS[vi];
        const height = CO_HEIGHTS[hi];
        colMap[colIdx] = { doorType: 'AFF', purpose: 'panel', opening, vision, height,
          itemPattern: `Car Pannel AFF {mat}/${opening}mm/${vision}` };
      }
    }
  }

  // Collapsible doors (39 cols: 13 openings x 3)
  for (let oi = 0; oi < COLL_OPENINGS.length; oi++) {
    const opening = COLL_OPENINGS[oi];
    const baseIdx = COLL_START + oi * 3;
    // frame_lh
    colMap[baseIdx] = { doorType: 'COLLAPSIBLE', purpose: 'frame_lh', opening,
      itemPattern: `Collapsible Door Post Industrial/LHS` };
    // frame_rh
    colMap[baseIdx + 1] = { doorType: 'COLLAPSIBLE', purpose: 'frame_rh', opening,
      itemPattern: `Collapsible Door Post Industrial/RHS` };
    // gate_count
    colMap[baseIdx + 2] = { doorType: 'COLLAPSIBLE', purpose: 'gate_count', opening,
      itemPattern: `Collapsible Top Bottom set OPP-${opening}` };
  }

  // Header System - CO Landing (8 cols starting at HDR_START)
  const hdrCoLandingOpenings = [600, 700, 800, 900, 1000, 1200];
  for (let i = 0; i < hdrCoLandingOpenings.length; i++) {
    const colIdx = HDR_START + i;
    const opening = hdrCoLandingOpenings[i];
    colMap[colIdx] = { doorType: 'HDR_CO', purpose: 'landing', opening,
      itemPattern: `Landing Header System CO ${opening}mm` };
  }
  // CO Car headers (next 8 cols)
  for (let i = 0; i < hdrCoLandingOpenings.length; i++) {
    const colIdx = HDR_START + 8 + i;
    const opening = hdrCoLandingOpenings[i];
    colMap[colIdx] = { doorType: 'HDR_CO', purpose: 'car', opening,
      itemPattern: `Car Header System CO ${opening}mm` };
  }

  // Header System AT/Side - Landing LHS (7 cols)
  for (let i = 0; i < HDR_AT_LANDING_LHS_OPENINGS.length; i++) {
    const colIdx = HDR_AT_START + i;
    const opening = HDR_AT_LANDING_LHS_OPENINGS[i];
    colMap[colIdx] = { doorType: 'HDR_AT', purpose: 'landing_lhs', opening,
      itemPattern: `Landing Header System  AT LHS/${opening}mm` };
  }
  // Landing RHS (6 cols)
  for (let i = 0; i < HDR_AT_LANDING_RHS_OPENINGS.length; i++) {
    const colIdx = HDR_AT_START + 7 + i;
    const opening = HDR_AT_LANDING_RHS_OPENINGS[i];
    colMap[colIdx] = { doorType: 'HDR_AT', purpose: 'landing_rhs', opening,
      itemPattern: `Landing Header System  AT RHS/${opening}mm` };
  }
  // Car LHS (7 cols)
  for (let i = 0; i < HDR_AT_CAR_LHS_OPENINGS.length; i++) {
    const colIdx = HDR_AT_START + 13 + i;
    const opening = HDR_AT_CAR_LHS_OPENINGS[i];
    colMap[colIdx] = { doorType: 'HDR_AT', purpose: 'car_lhs', opening,
      itemPattern: `Car Header System  AT LHS/${opening}mm` };
  }
  // Car RHS (6 cols)
  for (let i = 0; i < HDR_AT_CAR_RHS_OPENINGS.length; i++) {
    const colIdx = HDR_AT_START + 20 + i;
    const opening = HDR_AT_CAR_RHS_OPENINGS[i];
    colMap[colIdx] = { doorType: 'HDR_AT', purpose: 'car_rhs', opening,
      itemPattern: `Car Header System AT RHS/${opening}mm` };
  }

  // Header System AFF - Landing (7 cols)
  for (let i = 0; i < HDR_AFF_OPENINGS.length; i++) {
    const colIdx = HDR_AFF_START + i;
    const opening = HDR_AFF_OPENINGS[i];
    colMap[colIdx] = { doorType: 'HDR_AFF', purpose: 'landing', opening,
      itemPattern: `Landing Header System  AFF ${opening}mm` };
  }
  // AFF Car (7 cols)
  for (let i = 0; i < HDR_AFF_OPENINGS.length; i++) {
    const colIdx = HDR_AFF_START + 7 + i;
    const opening = HDR_AFF_OPENINGS[i];
    colMap[colIdx] = { doorType: 'HDR_AFF', purpose: 'car', opening,
      itemPattern: `Car Header System  AFF ${opening}mm` };
  }

  return { colMap, unmatchedCols };
}

// Resolve a door column entry to an item_id based on job's frame material
function resolveDoorItem(entry, material, items) {
  const mat = (material || 'MS').toUpperCase().trim();
  const matKey = mat === 'D' ? 'SS' : mat; // Designer uses SS items

  if (entry.item_id) return entry.item_id; // Already resolved (simple column)

  if (!entry.itemPattern) return null;

  const pattern = entry.itemPattern.replace('{mat}', matKey);

  // For collapsible doors, items don't have material in name
  if (entry.doorType === 'COLLAPSIBLE') {
    const item = items.find(i => i.lookup_key === entry.itemPattern ||
      i.lookup_key.toLowerCase().includes(entry.itemPattern.toLowerCase()));
    return item ? item.id : null;
  }

  // For headers, exact match
  if (entry.doorType && entry.doorType.startsWith('HDR_')) {
    const item = items.find(i => i.lookup_key === pattern || i.lookup_key === entry.itemPattern);
    return item ? item.id : null;
  }

  // For panels and lintons, try exact then fuzzy
  let item = items.find(i => i.lookup_key === pattern);
  if (!item) {
    // Try without exact match
    const parts = pattern.split('/');
    item = items.find(i => {
      const lk = i.lookup_key;
      return parts.every(p => lk.includes(p));
    });
  }
  return item ? item.id : null;
}

// --- Supabase API helpers ---
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

async function main() {
  console.log('=== Full BOM Import ===');
  console.log('Fetching items from database...');

  // Fetch all items (paginate to get all 1477)
  let items = [];
  let offset = 0;
  while (true) {
    const batch = await supaFetch(`items?select=id,lookup_key,category_id&limit=1000&offset=${offset}`);
    items = items.concat(batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`Loaded ${items.length} items`);

  // Build column mapping
  const { colMap, unmatchedCols } = buildColumnItemMap(items);

  const directMapped = Object.entries(colMap).filter(([_, v]) => v.item_id).length;
  const doorMapped = Object.entries(colMap).filter(([_, v]) => v.doorType).length;
  console.log(`Column mapping: ${directMapped} direct + ${doorMapped} door-resolved = ${directMapped + doorMapped} total`);
  console.log(`Unmatched bomMap entries: ${unmatchedCols.length}`);
  if (unmatchedCols.length > 0) {
    console.log('Unmatched:', unmatchedCols.slice(0, 10).map(u => `${u.col}(${u.cat}/${u.variant}): ${u.reason}`).join(', '));
  }

  // Read Excel file
  console.log('\nReading Excel file...');
  const xlPath = path.join('C:', 'Users', 'yash_', 'Downloads', 'Target List (5).xlsx');
  const wb = XLSX.readFile(xlPath, { type: 'file' });
  const ws = wb.Sheets['TARGET'] || wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log(`Excel rows: ${data.length}`);

  // Find data start (skip headers)
  let dataStart = 7; // row 7 per mapping doc
  // Verify by checking col B (index 1) for job_ref pattern
  for (let r = 4; r < 15; r++) {
    const val = data[r] && data[r][1];
    if (val && typeof val === 'string' && (val.startsWith('RE') || val.startsWith('LT'))) {
      dataStart = r;
      break;
    }
  }
  console.log(`Data starts at row ${dataStart}`);

  // Fetch existing jobs
  console.log('\nFetching existing jobs...');
  const jobs = await supaFetch('jobs?select=id,job_number&limit=200');
  console.log(`Found ${jobs.length} jobs in DB`);
  const jobByNumber = {};
  jobs.forEach(j => { jobByNumber[j.job_number] = j.id; });

  // Fetch existing BOM headers
  const headers = await supaFetch('job_bom_headers?select=id,job_id&limit=200');
  const headerByJobId = {};
  headers.forEach(h => { headerByJobId[h.job_id] = h.id; });

  // Delete existing BOM lines (will re-import everything)
  console.log('\nDeleting existing BOM lines...');
  await supaFetch('job_bom_lines?id=not.is.null', { method: 'DELETE' });
  console.log('Deleted all existing BOM lines');

  // Process each job row
  let totalLines = 0;
  let jobsProcessed = 0;
  let jobsSkipped = 0;
  const batchSize = 200;
  let batch = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    await supaFetch('job_bom_lines', {
      method: 'POST',
      body: JSON.stringify(batch)
    });
    totalLines += batch.length;
    batch = [];
  }

  for (let row = dataStart; row < data.length; row++) {
    const rowData = data[row];
    if (!rowData) continue;

    const jobRefRaw = rowData[1];
    if (!jobRefRaw) continue;
    const jobRef = String(jobRefRaw).trim();
    if (!jobRef) continue;

    const jobId = jobByNumber[jobRef];
    if (!jobId) {
      jobsSkipped++;
      continue;
    }

    let bomHeaderId = headerByJobId[jobId];
    if (!bomHeaderId) {
      // Create BOM header for this job
      const [newHeader] = await supaFetch('job_bom_headers', {
        method: 'POST',
        body: JSON.stringify({ job_id: jobId }),
        prefer: 'return=representation'
      });
      bomHeaderId = newHeader.id;
      headerByJobId[jobId] = bomHeaderId;
    }

    // Get frame materials for door resolution
    const coMaterial = rowData[CO_START] || 'MS'; // EW
    const atMaterial = rowData[AT_START] || 'MS'; // GP
    const affMaterial = rowData[AFF_START] || 'MS'; // IL

    // Process all BOM columns
    for (const [colIdxStr, mapping] of Object.entries(colMap)) {
      const colIdx = parseInt(colIdxStr);
      const cellVal = rowData[colIdx];

      if (cellVal === null || cellVal === undefined || cellVal === '' || cellVal === 0) continue;

      // Determine if this is a numeric qty column
      const numVal = typeof cellVal === 'number' ? cellVal : parseFloat(cellVal);
      if (isNaN(numVal) || numVal === 0) continue;

      let itemId = null;

      if (mapping.item_id) {
        // Direct mapped column
        itemId = mapping.item_id;
      } else if (mapping.doorType) {
        // Door column - resolve based on material
        let material = 'MS';
        if (mapping.doorType === 'CO' || mapping.doorType === 'HDR_CO') material = coMaterial;
        else if (mapping.doorType === 'AT' || mapping.doorType === 'HDR_AT') material = atMaterial;
        else if (mapping.doorType === 'AFF' || mapping.doorType === 'HDR_AFF') material = affMaterial;

        itemId = resolveDoorItem(mapping, material, items);
      }

      if (!itemId) continue;

      // Build a unique variant string for the constraint
      let cat = mapping.cat || null;
      let variant = mapping.variant || null;

      if (mapping.doorType) {
        cat = mapping.doorType;
        // Make variant unique by including all dimensions
        const parts = [mapping.purpose];
        if (mapping.opening) parts.push(String(mapping.opening));
        if (mapping.vision) parts.push(mapping.vision);
        if (mapping.orientation) parts.push(mapping.orientation);
        if (mapping.height) parts.push(mapping.height);
        if (mapping.sizeLabel) parts.push(mapping.sizeLabel);
        variant = parts.join('/');
      }

      batch.push({
        job_bom_id: bomHeaderId,
        item_id: itemId,
        required_quantity: numVal,
        source_col_index: colIdx,
        category: cat,
        variant: variant,
      });

      if (batch.length >= batchSize) {
        await flushBatch();
        process.stdout.write(`\r  Imported ${totalLines} lines (${jobsProcessed + 1} jobs)...`);
      }
    }

    jobsProcessed++;
  }

  // Flush remaining
  await flushBatch();

  console.log(`\n\n=== Import Complete ===`);
  console.log(`Jobs processed: ${jobsProcessed}`);
  console.log(`Jobs skipped (not in DB): ${jobsSkipped}`);
  console.log(`Total BOM lines created: ${totalLines}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
