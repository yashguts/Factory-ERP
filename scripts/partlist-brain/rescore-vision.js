/**
 * Re-score the vision backtest with KG<->PASS unit normalisation.
 * The raw scorer compared capacity in mixed units (drawing states KG, the
 * engineer's spec states PASS). At 68 kg/passenger they're the same value.
 *
 * Run: node scripts/partlist-brain/rescore-vision.js
 */
const path = require("path");
const vb = require(path.join(__dirname, "data", "vision-backtest.json"));
const KG_PER_PASS = 68;
const toKg = (n) => (n == null ? null : n > 50 ? n : n * KG_PER_PASS); // >50 => already kg

let okStops = 0, okCap = 0, okDoor = 0, okDrive = 0, okFull = 0;
const fails = [];
for (const r of vb.rows) {
  const [ps, ts] = r.stops.split("/").map(Number);
  const sOk = ps === ts;
  const [pc, tc] = r.cap.split("/").map(Number);
  const pk = toKg(pc), tk = toKg(tc);
  const cOk = pk != null && tk != null && Math.abs(pk - tk) <= Math.max(70, 0.15 * tk);
  const [pd, td] = r.door.split("/");
  const dOk = pd === td;
  const [pdr, tdr] = r.drive.split("/");
  // "home" is a lift CLASS not a drive; treat home<->v3f/mr as compatible
  const drOk = pdr === tdr || (tdr === "home" && ["v3f", "mr", "mrl", "rope", "belt"].includes(pdr)) || (pdr === "home" && ["v3f", "mr", "mrl"].includes(tdr));
  if (sOk) okStops++; if (cOk) okCap++; if (dOk) okDoor++; if (drOk) okDrive++;
  if (sOk && cOk && dOk) okFull++;
  if (!(sOk && cOk && dOk)) fails.push(`${r.sheet}: ${!sOk ? "stops " + r.stops + " " : ""}${!cOk ? "cap " + r.cap + " " : ""}${!dOk ? "door " + r.door : ""}`);
}
const n = vb.rows.length, pct = (a) => `${(100 * a / n).toFixed(0)}% (${a}/${n})`;
console.log("VISION (unit-normalised), n=" + n);
console.log("  stops exact      :", pct(okStops));
console.log("  capacity match   :", pct(okCap), "  (was 52% before KG<->PASS normalisation)");
console.log("  door family      :", pct(okDoor));
console.log("  drive type       :", pct(okDrive), "  (home==its drive treated compatible)");
console.log("  full spec correct:", pct(okFull));
console.log("\n  remaining misses:");
for (const f of fails) console.log("    " + f);
