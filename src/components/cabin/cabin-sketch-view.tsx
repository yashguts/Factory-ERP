"use client";

import { useMemo } from "react";
import type { CabinJobLine } from "@/lib/actions/cabin-jobs";

/* ------------------------------------------------------------------ *
 * CabinSketchView — renders a cabin job's lines as a hand-sketch-style
 * plan view (the same top-view drawing the factory sketches by hand:
 * three panelled walls, the door opening with its returns, and a spec
 * block in the middle). Pure render from the saved lines — the engineer
 * reviews the sketch at a glance instead of reading rows.
 *
 * Wall assignment is a best-effort heuristic (the DB doesn't store which
 * wall a panel sits on): P4 corner panels -> rear corners, P6 centre
 * panel -> rear middle, COP panel -> right wall front, the rest greedily
 * balanced across left/right by width. Anything un-placeable (glass,
 * supports, covers) lists in the "Also on this job" box — nothing is
 * hidden.
 * ------------------------------------------------------------------ */

const FINISH_ABBREV: Record<string, string> = {
  "Rose Gold Linen": "RGL",
  "Rose Gold Mirror": "RGM",
  "Rose Gold Etching": "RGE",
  "Rose Gold": "RG",
  "Black Mirror": "BM",
  "Black Hairline": "BH",
  "Golden Mirror": "GM",
  "Golden Hairline": "GH",
  "Golden Jewellery": "GJ",
  Golden: "GLD",
  Mirror: "MIR",
  "Grade 430 Mirror": "430M",
  "White Mirror Silver": "WMS",
  "Silver Horizontal": "SH",
  "Silver Vertical": "SV",
  "Silver Linen": "SL",
  "Moon Rock": "MR",
  "Honey Comb": "HC",
  "Blue Flower": "BF",
  "Designer IPF01": "IPF01",
  Chequered: "CHQ",
  Champagne: "CHM",
  Bronze: "BRZ",
  Wooden: "WD",
  "SS 304": "SS304",
  "SS 430": "SS",
  "SS 441": "SS441",
  MS: "MS",
};

/** "P2C-350 STD Rose Gold Linen" -> { code:"P2C 350", finish:"RGL" } */
function panelLabel(name: string | null): { code: string; finish: string | null } {
  if (!name) return { code: "?", finish: null };
  let rest = name;
  let finish: string | null = null;
  for (const [full, abbr] of Object.entries(FINISH_ABBREV).sort((a, b) => b[0].length - a[0].length)) {
    if (rest.toLowerCase().endsWith(full.toLowerCase())) {
      finish = abbr;
      rest = rest.slice(0, rest.length - full.length).trim();
      break;
    }
  }
  const code = rest
    .replace(/\b(STD|BIG|GOODS)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return { code, finish };
}

function panelWidth(name: string | null): number | null {
  if (!name) return null;
  const m = name.match(/[Pp]\d[A-Za-z]*[- ]?(\d{2,4})/);
  return m ? parseInt(m[1], 10) : null;
}

interface Placed {
  label: string;
  w: number;
}

export function CabinSketchView({
  jobNumber,
  customerName,
  lines,
}: {
  jobNumber: string;
  customerName?: string | null;
  lines: CabinJobLine[];
}) {
  const model = useMemo(() => {
    const byType = (t: string) => lines.filter((l) => l.cabin_type === t && l.item_name);
    const platform = byType("Platform")[0]?.item_name ?? null;
    const geom = platform?.match(/^([A-Za-z]+)[ _]*(\d{3,4})\s*[xX]\s*(\d{3,4})/);
    const doorType = geom?.[1]?.toUpperCase() ?? null;
    const W = geom ? parseInt(geom[2], 10) : null;
    const D = geom ? parseInt(geom[3], 10) : null;

    // Height class + spec strings.
    const allNames = lines.map((l) => l.item_name ?? "").join(" | ");
    const height = /\bBIG\b/i.test(allNames) ? "BIG" : /\bSTD\b/i.test(allNames) ? "STD" : "—";
    const canopies = byType("Canopy").map((l) => `${panelLabel(l.item_name).code}${l.qty > 1 ? ` ×${l.qty}` : ""}`);
    const linton = byType("Car Linton")[0]?.item_name ?? null;
    const lintonOpen = linton?.match(/(\d{3,4})mm/)?.[1] ?? null;

    // Front returns.
    const fwl = byType("Front Wall LHS")[0]?.item_name ?? null;
    const fwr = byType("Front Wall RHS")[0]?.item_name ?? null;
    const side = /LHO/i.test(allNames) ? "LHO" : /RHO/i.test(allNames) ? "RHO" : null;

    // Side panels expanded by qty, then placed.
    const panels: { name: string; w: number | null }[] = [];
    for (const l of byType("Side Panel")) {
      for (let i = 0; i < Math.max(1, Math.round(l.qty)); i++)
        panels.push({ name: l.item_name!, w: panelWidth(l.item_name) });
    }
    const rear: Placed[] = [];
    const left: Placed[] = [];
    const right: Placed[] = [];
    const rest: string[] = [];
    const take = (pred: (n: string) => boolean, to: Placed[], max = Infinity) => {
      for (let i = panels.length - 1; i >= 0 && to.length < max; i--) {
        if (pred(panels[i].name)) {
          const p = panels.splice(i, 1)[0];
          const lb = panelLabel(p.name);
          to.push({ label: lb.finish ? `${lb.code} (${lb.finish})` : lb.code, w: p.w ?? 0 });
        }
      }
    };
    take((n) => /\bP4/i.test(n), rear, 2); // corners
    take((n) => /\bP6/i.test(n), rear); // rear centre — put between the corners
    if (rear.length >= 2) {
      const centre = rear.splice(2);
      rear.splice(1, 0, ...centre);
    }
    take((n) => /COP/i.test(n), right); // COP panel rides the right wall, near the door
    // Balance the remaining panels across left/right by accumulated width.
    const widthOf = (a: Placed[]) => a.reduce((s, x) => s + (x.w || 0), 0);
    for (const p of [...panels].sort((a, b) => (b.w ?? 0) - (a.w ?? 0))) {
      const lb = panelLabel(p.name);
      const entry = { label: lb.finish ? `${lb.code} (${lb.finish})` : lb.code, w: p.w ?? 0 };
      (widthOf(left) <= widthOf(right) ? left : right).push(entry);
    }
    right.reverse(); // COP (taken first) ends nearest the front

    // Everything else (glass, supports, covers, cabin support, false ceiling …).
    const covered = new Set(["Platform", "Side Panel", "Canopy", "Car Linton", "Front Wall LHS", "Front Wall RHS"]);
    for (const l of lines) {
      if (!covered.has(l.cabin_type) && l.item_name)
        rest.push(`${l.cabin_type}: ${l.item_name}${l.qty > 1 ? ` ×${l.qty}` : ""}`);
    }

    return {
      platform, doorType, W, D, height, canopies, linton, lintonOpen,
      fwl: fwl ? panelLabel(fwl) : null,
      fwr: fwr ? panelLabel(fwr) : null,
      side, rear, left, right, rest,
    };
  }, [lines]);

  // Geometry for the SVG box (scaled cabin plan).
  const boxW = 300;
  const boxH = model.W && model.D ? Math.min(340, Math.max(200, (boxW * model.D) / model.W)) : 260;
  const x0 = 220, y0 = 60; // cabin rect origin
  const handFont = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

  const wallText = (items: Placed[]) => items.map((p) => p.label);

  return (
    <div className="card-surface p-3 overflow-x-auto">
      <svg viewBox="0 0 760 560" className="w-full min-w-[640px]" style={{ fontFamily: handFont }}>
        {/* rear wall (top) */}
        <line x1={x0} y1={y0} x2={x0 + boxW} y2={y0} stroke="var(--foreground)" strokeWidth="2.5" />
        {/* left + right walls */}
        <line x1={x0} y1={y0} x2={x0} y2={y0 + boxH} stroke="var(--foreground)" strokeWidth="2.5" />
        <line x1={x0 + boxW} y1={y0} x2={x0 + boxW} y2={y0 + boxH} stroke="var(--foreground)" strokeWidth="2.5" />
        {/* front: returns + opening gap */}
        <line x1={x0} y1={y0 + boxH} x2={x0 + boxW * 0.22} y2={y0 + boxH} stroke="var(--foreground)" strokeWidth="2.5" />
        <line x1={x0 + boxW * 0.78} y1={y0 + boxH} x2={x0 + boxW} y2={y0 + boxH} stroke="var(--foreground)" strokeWidth="2.5" />
        {/* panel tick marks (decorative, hand-sketch style) */}
        {model.rear.map((_, i) => (
          <line key={`rt${i}`} x1={x0 + ((i + 1) * boxW) / Math.max(1, model.rear.length)} y1={y0 - 4} x2={x0 + ((i + 1) * boxW) / Math.max(1, model.rear.length)} y2={y0 + 4} stroke="var(--foreground)" strokeWidth="1.5" />
        ))}
        {model.left.map((_, i) => (
          <line key={`lt${i}`} x1={x0 - 4} y1={y0 + ((i + 1) * boxH) / Math.max(1, model.left.length)} x2={x0 + 4} y2={y0 + ((i + 1) * boxH) / Math.max(1, model.left.length)} stroke="var(--foreground)" strokeWidth="1.5" />
        ))}
        {model.right.map((_, i) => (
          <line key={`rt2${i}`} x1={x0 + boxW - 4} y1={y0 + ((i + 1) * boxH) / Math.max(1, model.right.length)} x2={x0 + boxW + 4} y2={y0 + ((i + 1) * boxH) / Math.max(1, model.right.length)} stroke="var(--foreground)" strokeWidth="1.5" />
        ))}

        {/* rear labels above the top wall */}
        {wallText(model.rear).map((t, i, arr) => (
          <text key={`r${i}`} x={x0 + ((i + 0.5) * boxW) / Math.max(1, arr.length)} y={y0 - 12 - (i % 2) * 16} textAnchor="middle" fontSize="13" fill="var(--foreground)">{t}</text>
        ))}
        {/* left labels */}
        {wallText(model.left).map((t, i, arr) => (
          <text key={`l${i}`} x={x0 - 12} y={y0 + ((i + 0.5) * boxH) / Math.max(1, arr.length) + 4} textAnchor="end" fontSize="13" fill="var(--foreground)">{t}</text>
        ))}
        {/* right labels */}
        {wallText(model.right).map((t, i, arr) => (
          <text key={`ri${i}`} x={x0 + boxW + 12} y={y0 + ((i + 0.5) * boxH) / Math.max(1, arr.length) + 4} fontSize="13" fill="var(--foreground)">{t}</text>
        ))}

        {/* front returns + opening */}
        {model.fwl && (
          <text x={x0 - 4} y={y0 + boxH + 26} fontSize="12.5" fill="var(--foreground)">
            {model.fwl.code}{model.fwl.finish ? ` (${model.fwl.finish})` : ""}
          </text>
        )}
        {model.fwr && (
          <text x={x0 + boxW + 4} y={y0 + boxH + 26} textAnchor="end" fontSize="12.5" fill="var(--foreground)">
            {model.fwr.code}{model.fwr.finish ? ` (${model.fwr.finish})` : ""}
          </text>
        )}
        <text x={x0 + boxW / 2} y={y0 + boxH + 26} textAnchor="middle" fontSize="13" fill="var(--foreground)">
          {model.lintonOpen ? `Opening ${model.lintonOpen}` : "Opening"}
          {model.side ? ` · ${model.side}` : ""}
        </text>

        {/* spec block inside the cabin */}
        <g fontSize="13.5" fill="var(--foreground)">
          <text x={x0 + 16} y={y0 + 34} fontWeight="bold" fontSize="15">JOB — {jobNumber}</text>
          {customerName && (
            <text x={x0 + 16} y={y0 + 54} fontSize="11.5" fill="var(--muted-foreground)">{customerName}</text>
          )}
          <text x={x0 + 16} y={y0 + 82}>Platform → {model.platform ?? "—"}</text>
          <text x={x0 + 16} y={y0 + 104}>Canopy → {model.canopies.length ? model.canopies.join(", ") : "—"}</text>
          <text x={x0 + 16} y={y0 + 126}>Linton → {model.linton ? panelLabel(model.linton).code : "—"}</text>
          <text x={x0 + 16} y={y0 + 148}>Height → {model.height}</text>
          {model.doorType && <text x={x0 + 16} y={y0 + 170}>Door type → {model.doorType}</text>}
        </g>

        {/* Also-on-this-job box */}
        {model.rest.length > 0 && (
          <g fontSize="11.5" fill="var(--foreground)">
            <text x={30} y={y0 + boxH + 64} fontWeight="bold">Also on this job:</text>
            {model.rest.slice(0, 8).map((t, i) => (
              <text key={i} x={30} y={y0 + boxH + 82 + i * 16}>• {t}</text>
            ))}
            {model.rest.length > 8 && (
              <text x={30} y={y0 + boxH + 82 + 8 * 16} fill="var(--muted-foreground)">…and {model.rest.length - 8} more</text>
            )}
          </g>
        )}
      </svg>
      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
        Auto-drawn from the saved items — wall placement is best-effort; quantities and finishes are exact.
        (RGL = Rose Gold Linen, BM = Black Mirror, SS = SS 430, MIR = Mirror …)
      </p>
    </div>
  );
}
