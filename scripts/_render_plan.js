// Download a GAD pdf and render both pages at high resolution for bracket-gap reading.
// Usage: node scripts/_render_plan.js <url> <jobnum>
// Writes /tmp/plan_<jobnum>_p1.png and _p2.png (scale 6). Use scripts/_crop.js to zoom.
const fs = require("fs");
const napi = require("@napi-rs/canvas");
const { createCanvas } = napi;
if (napi.Path2D && !global.Path2D) global.Path2D = napi.Path2D;
if (napi.DOMMatrix && !global.DOMMatrix) global.DOMMatrix = napi.DOMMatrix;
class F { create(w, h) { const c = createCanvas(w, h); return { canvas: c, context: c.getContext("2d") }; } reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; } destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; } }
(async () => {
  const url = process.argv[2], job = process.argv[3];
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const tmp = `/tmp/_dl_${job}.pdf`; fs.writeFileSync(tmp, buf);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, canvasFactory: new F() }).promise;
  const scale = 6;
  for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(vp.width, vp.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, vp.width, vp.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const out = `/tmp/plan_${job}_p${p}.png`;
    fs.writeFileSync(out, canvas.toBuffer("image/png"));
    console.log(out, Math.round(vp.width) + "x" + Math.round(vp.height));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
