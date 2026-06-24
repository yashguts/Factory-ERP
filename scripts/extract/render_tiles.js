// CAPTURE harness: render a GAD pdf's pages at high DPI AND tile each page into an
// overlapping grid, so every labelled value is legible at full resolution in some tile
// (the gapless guarantee — a single full-page read loses the small dimensions).
// Usage: node scripts/extract/render_tiles.js <url> <jobnum> [cols=3] [rows=3]
// Writes C:/tmp/x_<job>_p<p>.png (full page) and C:/tmp/x_<job>_p<p>_<r><c>.png (tiles).
const fs = require("fs");
const napi = require("@napi-rs/canvas");
const { createCanvas } = napi;
if (napi.Path2D && !global.Path2D) global.Path2D = napi.Path2D;
if (napi.DOMMatrix && !global.DOMMatrix) global.DOMMatrix = napi.DOMMatrix;
class F { create(w, h) { const c = createCanvas(w, h); return { canvas: c, context: c.getContext("2d") }; } reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; } destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; } }
const OVERLAP = 0.16; // 16% tile overlap so a dimension on a seam is whole in a neighbour
(async () => {
  const url = process.argv[2], job = process.argv[3];
  const cols = +(process.argv[4] || 3), rows = +(process.argv[5] || 3);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, canvasFactory: new F() }).promise;
  const out = [];
  for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 6 });
    const canvas = createCanvas(vp.width, vp.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, vp.width, vp.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const full = `C:/tmp/x_${job}_p${p}.png`;
    fs.writeFileSync(full, canvas.toBuffer("image/png")); out.push(full);
    // tiles with overlap
    const tw = vp.width / cols, th = vp.height / rows, ox = tw * OVERLAP, oy = th * OVERLAP;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = Math.max(0, c * tw - ox), y = Math.max(0, r * th - oy);
      const w = Math.min(vp.width - x, tw + 2 * ox), h = Math.min(vp.height - y, th + 2 * oy);
      const t = createCanvas(w, h); const tctx = t.getContext("2d");
      tctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      const tf = `C:/tmp/x_${job}_p${p}_${r}${c}.png`;
      fs.writeFileSync(tf, t.toBuffer("image/png")); out.push(tf);
    }
  }
  console.log(out.join("\n"));
})().catch((e) => { console.error(e.message); process.exit(1); });
