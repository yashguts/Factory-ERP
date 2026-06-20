const fs = require("fs");
const path = require("path");
const D = path.join(__dirname, "data");
const pairs = require(path.join(D, "pairs.json"));

// feature sample: spread ~70 across the paired set
const feat = [];
const stride = Math.max(1, Math.floor(pairs.length / 70));
for (let i = 0; i < pairs.length && feat.length < 70; i += stride) feat.push({ sheet: pairs[i].sheet, drawingPath: pairs[i].drawingPath });
fs.writeFileSync(path.join(D, "_feat_sample.json"), JSON.stringify(feat));
console.log("feature sample:", feat.length);

// bridge: unmatched drawings filtered to families present in unmatched sheets
const draws = require(path.join(D, "_unmatched_draws.json"));
const fams = ["ANDH", "BBSR", "GUW", "BHT", "CH-", "JHK", "MUM", "DLH", "BRL", "NAG", "MALS", "SKM", "MIZ", "REBBSR", "TLN", "TN-", "BH-"];
const base = (p) => p.split("\\").pop().toUpperCase();
const fil = draws.filter((d) => fams.some((f) => base(d).includes(f)));
fs.writeFileSync(path.join(D, "_bridge_draws.json"), JSON.stringify(fil));
console.log("bridge candidate drawings:", fil.length, "of", draws.length);
console.log("sample bridge files:", fil.slice(0, 8).map(base).join(", "));
