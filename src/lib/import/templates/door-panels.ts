import type { ParsedRow } from "../types";

const FINISH_CODES: Record<string, string> = {
  "silver mirror": "SM",
  "silver miror": "SM",
  champagne: "CH",
  golden: "GD",
  "rose gold": "RG",
  rosegold: "RG",
  moonrock: "MR",
  "honey com": "HC",
  honeycomb: "HC",
  wooden: "WD",
  wodden: "WD",
  "rose gold linen": "RGL",
  "rose gold lilen": "RGL", // legacy misspelling kept so older sheets still import

  "black hairline": "BHL",
};

function detectFinish(text: string): string {
  const lower = text.toLowerCase();
  const sorted = Object.entries(FINISH_CODES).sort((a, b) => b[0].length - a[0].length);
  for (const [key, code] of sorted) {
    if (lower.includes(key)) return code;
  }
  return "";
}

function parseSpec(spec: string): {
  doorType: string;
  material: string;
  panelType: string;
  width: string;
  height: string;
  thickness: string;
  finish: string;
  fireRated: boolean;
  railway: boolean;
  side: string;
} {
  const result = {
    doorType: "",
    material: "",
    panelType: "",
    width: "",
    height: "",
    thickness: "",
    finish: "",
    fireRated: false,
    railway: false,
    side: "",
  };

  const lower = spec.toLowerCase();
  result.fireRated = lower.includes("fire");
  result.railway = lower.includes("railway");

  const mainPart = spec.split("(")[0].trim();
  const slashTokens = mainPart.split("/").map((t) => t.trim());

  const allTokens: string[] = [];
  for (const st of slashTokens) {
    for (const word of st.split(/\s+/)) {
      if (word) allTokens.push(word);
    }
  }

  let foundWidth = false;
  for (const token of allTokens) {
    const t = token.toUpperCase().replace(/MM$/i, "");
    if (["MT", "CO", "AT", "AFF"].includes(t)) {
      result.doorType = t;
    } else if (["MS", "SS"].includes(t)) {
      result.material = t;
    } else if (["PV", "MV", "NV", "LV", "SV"].includes(t)) {
      result.panelType = t;
    } else if (["LHS", "RHS"].includes(t)) {
      result.side = t;
    } else if (/^\d{3,4}$/.test(t)) {
      if (!foundWidth) {
        result.width = t;
        foundWidth = true;
      } else {
        const h = parseInt(t);
        if (h === 2100) result.height = "B";
        else if (h !== 2000) result.height = `H${h}`;
      }
    }
  }

  const parens = spec.match(/\(([^)]+)\)/g) || [];
  for (const p of parens) {
    const inner = p.slice(1, -1).trim();
    const innerLower = inner.toLowerCase();

    if (innerLower === "big" || inner === "2100") {
      result.height = "B";
    } else if (innerLower === "std" || inner === "2000") {
      // standard, no suffix
    } else if (/^\d{4}(mm)?$/i.test(inner)) {
      const h = parseInt(inner);
      if (h === 2100) result.height = "B";
      else if (h !== 2000) result.height = `H${h}`;
    } else if (/^1\.[56](mm)?$/i.test(inner)) {
      if (inner.includes("1.5")) result.thickness = "15";
      else if (inner.includes("1.6")) result.thickness = "16";
    } else if (innerLower.includes("fire")) {
      result.fireRated = true;
    } else {
      const finish = detectFinish(inner);
      if (finish) result.finish = finish;
    }
  }

  return result;
}

function generateCode(
  parsed: ReturnType<typeof parseSpec>,
  part: "landing" | "car"
): string {
  const segments = ["SA", "DP", parsed.doorType || "XX"];

  if (parsed.finish) {
    segments.push(parsed.finish);
  } else {
    segments.push(parsed.material || "MS");
  }

  if (parsed.side) segments.push(parsed.side);
  if (parsed.width) segments.push(parsed.width);
  if (parsed.panelType) segments.push(parsed.panelType);

  const suffixes: string[] = [];
  if (parsed.height) suffixes.push(parsed.height);
  if (parsed.thickness) suffixes.push(`T${parsed.thickness}`);
  if (parsed.fireRated) suffixes.push("FR");
  if (part === "car") suffixes.push("C");
  if (parsed.railway) suffixes.push("RW");

  if (suffixes.length > 0) segments.push(suffixes.join(""));

  return segments.join("-");
}

function parseSectionPart(header: string): "landing" | "car" {
  return header.toLowerCase().includes("car") ? "car" : "landing";
}

export function parseDoorPanels(rows: string[][]): ParsedRow[] {
  const results: ParsedRow[] = [];
  let currentPart: "landing" | "car" = "landing";

  for (const row of rows) {
    const colA = String(row[0] ?? "").trim();
    const colB = String(row[1] ?? "").trim();
    const colC = String(row[2] ?? "").trim();
    const colD = String(row[3] ?? "").trim();
    const colG = String(row[6] ?? "").trim();

    if (colA && !colB) {
      currentPart = parseSectionPart(colA);
      continue;
    }

    if (!colB || !colC) continue;
    if (colB.toLowerCase() === "name") continue;

    const spec = colC;
    const stock = parseFloat(colG) || 0;
    const parsed = parseSpec(spec);

    if (!parsed.doorType && !parsed.panelType) continue;

    const colBLower = colB.toLowerCase();
    const part = colBLower.includes("car") ? "car" as const
      : colBLower.includes("landing") ? "landing" as const
      : currentPart;
    const code = generateCode(parsed, part);

    results.push({
      code,
      name: colB,
      description: spec,
      lookup_key: colD || `${colB} ${spec}`,
      item_type: "sub_assembly",
      category_name: "Doors",
      sub_category_name: "Door Panels",
      current_stock: stock,
      uom: "nos",
    });
  }

  return results;
}
