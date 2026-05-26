import type { ParsedJobRow } from "./types";

export function parseSpecString(spec: string): {
  floors: number | null;
  doorType: string | null;
  driveType: string | null;
  capacity: string | null;
} {
  if (!spec) return { floors: null, doorType: null, driveType: null, capacity: null };

  const normalized = spec.trim().toUpperCase();
  // Format: G+{floors}/{DoorType}/{DriveType}/{Capacity}
  // Examples: G+4/CO/MRL/6PASS, G+7/MT/GR/8PASS, G+3/AT/HYD/13PASS
  const match = normalized.match(/^G\+(\d+)\/?([A-Z]*)\/?([A-Z]*)\/?(.*)$/);
  if (!match) return { floors: null, doorType: null, driveType: null, capacity: null };

  return {
    floors: parseInt(match[1], 10) || null,
    doorType: match[2] || null,
    driveType: match[3] || null,
    capacity: match[4] || null,
  };
}

export function detectBrand(jobNumber: string): string | null {
  if (!jobNumber) return null;
  const upper = jobNumber.trim().toUpperCase();
  if (upper.startsWith("LT")) return "LT";
  // Numeric job numbers and RE-prefixed are Ricardo
  if (/^\d/.test(upper) || upper.startsWith("RE")) return "Ricardo";
  // Location-coded (RNLBLR, ANDH, etc.) are Ricardo
  return "Ricardo";
}

function parseExcelDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "number") {
    // Excel serial date number → JS Date
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + value * 86400000);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split("T")[0];
  }
  const str = String(value).trim();
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

export function parseJobRow(row: unknown[]): ParsedJobRow | null {
  const jobNumber = String(row[1] ?? "").trim();
  if (!jobNumber) return null;
  // Skip header rows
  if (jobNumber.toLowerCase() === "job no" || jobNumber.toLowerCase() === "job number") return null;

  const specRaw = String(row[4] ?? "").trim();
  const parsed = parseSpecString(specRaw);

  return {
    job_number: jobNumber,
    customer_name: String(row[2] ?? "").trim(),
    progress: typeof row[3] === "number" ? row[3] : parseFloat(String(row[3] ?? "0")) || 0,
    spec_string: specRaw,
    door_finish: String(row[5] ?? "").trim(),
    location: String(row[6] ?? "").trim(),
    expected_delivery: parseExcelDate(row[7]),
    remark: String(row[8] ?? "").trim(),
    order_date: parseExcelDate(row[0]),
    floors: parsed.floors,
    door_type: parsed.doorType,
    drive_type: parsed.driveType,
    capacity: parsed.capacity,
    brand: detectBrand(jobNumber),
  };
}

export function parseHeaderRow(row: unknown[]): { index: number; label: string }[] {
  const columns: { index: number; label: string }[] = [];
  for (let i = 9; i < row.length; i++) {
    const label = String(row[i] ?? "").trim();
    if (label) {
      columns.push({ index: i, label });
    }
  }
  return columns;
}

export function parseBomQuantities(
  row: unknown[],
  columnMap: Map<number, string> // col_index → item_id
): { itemId: string; quantity: number; colIndex: number }[] {
  const results: { itemId: string; quantity: number; colIndex: number }[] = [];
  for (const [colIndex, itemId] of columnMap) {
    const raw = row[colIndex];
    const qty = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
    if (!isNaN(qty) && qty !== 0) {
      results.push({ itemId, quantity: qty, colIndex });
    }
  }
  return results;
}
