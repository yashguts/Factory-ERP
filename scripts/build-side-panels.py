"""
Build the Side Panel cabin catalog from 'Cabin Panel and Front Post.xlsx' Sheet1.

Rules (agreed with owner):
- MS = plain, 1 item each (passenger + goods), thickness default 1.2 unless stated.
- SS passenger panels: expand each SHAPE (series+pos+width+cop+spl+height) across the
  full designer finish list, at standard gauge. Drop "SS" from the name (finish implies SS).
- SS goods: kept plain (no finish expansion), keep STD/2400/2600 heights.
- Explicit-thickness rows (1.5/1.6/2.0mm): kept ONLY as the actual rows that exist
  (preserve stock); NOT cross-expanded -> this drops impossible finish x gauge combos.
- Plain-SS rows with stock: preserved as "... SS" so no stock is lost.
- Stock copied from the sheet (negatives preserved); generated variants start at 0.
Outputs: scripts/side-panels.json (for the importer) + a CSV record on the Desktop.
"""
import pandas as pd, re, json, os

PATH = r"C:\Users\yash_\OneDrive\Desktop\Cabin Panel and Front Post.xlsx"
OUT_JSON = os.path.join(os.path.dirname(__file__), "side-panels.json")
OUT_CSV  = r"C:\Users\yash_\OneDrive\Desktop\Cabin-Side-Panels-Catalog.csv"

DESIGNER_FINISHES = [
    "Mirror","Black Hairline","Black Mirror","Golden","Golden Hairline","Golden Mirror",
    "Golden Jewellery","Rose Gold","Rose Gold Mirror","Rose Gold Etching","Rose Gold Lilen",
    "Champagne","Silver Linen","Silver Horizontal","Silver Vertical","White Mirror Silver",
    "Blue Flower","Moon Rock","Honey Comb","Designer IPF01","Grade 430 Mirror",
    "Bronze","Wooden","Chequered",
]

df = pd.read_excel(PATH, sheet_name="Sheet1", header=0)
df.columns = ["material","name","spec","combined","stock"]
df = df.dropna(how="all").reset_index(drop=True)
df["stock"] = pd.to_numeric(df["stock"], errors="coerce").fillna(0)
df["material"] = df["material"].astype(str).str.strip().str.upper()

def parse_name(raw):
    s = str(raw).strip().upper()
    cop = "COP" in s
    spl = "(S)" in s or "SPL" in s
    core = re.sub(r"COP|SPL|\(.*?\)", "", s)  # strip COP/SPL/any (...) like (S) (2600)
    m = re.match(r"^P\s*(\d)\s*([CRL]?)\s*-?\s*(\d{2,4})", core)
    if not m:
        return None
    return dict(series=f"P{m.group(1)}", pos=m.group(2) or "", width=int(m.group(3)),
                cop=cop, spl=spl)

def height(s):
    s = s.upper()
    return 2600 if "2600" in s else 2400 if "2400" in s else 2100 if "BIG" in s else 2000

def thick(s):
    s = s.upper()
    return 1.5 if "1.5" in s else 1.6 if "1.6" in s else 2.0 if re.search(r"\b2\s*MM|2\.0MM", s) else 1.2

def is_goods(s):
    s = s.upper()
    return bool(re.search(r"\bGOODS\b", s)) or bool(re.search(r"(?:^|\s)G(?:\s|$)", s))

def finish(spec):
    s = re.sub(r"\(G\)", "", str(spec).upper())
    rules = [
        ("ROSE GOLD MIRROR","Rose Gold Mirror"),("RG MIRROR","Rose Gold Mirror"),
        ("ROSE GOLD ETCH","Rose Gold Etching"),("ROSE GOLD LILEN","Rose Gold Lilen"),
        ("ROSE GOLD","Rose Gold"),("R GOLD","Rose Gold"),
        ("GOLDEN MIRROR","Golden Mirror"),("GOLD MIRROR","Golden Mirror"),
        ("GOLDEN HAIR","Golden Hairline"),("GOLDEN JEWELL","Golden Jewellery"),("GOLDEN","Golden"),
        ("MOON ROCK","Moon Rock"),("CHAMP","Champagne"),
        ("BLACK HAIR","Black Hairline"),("BLACK HL","Black Hairline"),("BLACK MIRROR","Black Mirror"),
        ("HONEY","Honey Comb"),("IPF","Designer IPF01"),("430","Grade 430 Mirror"),("BLUE","Blue Flower"),
        ("BRONZE","Bronze"),("WOOD","Wooden"),("CHEQ","Chequered"),("WHITE MIRROR","White Mirror Silver"),
        ("SILVER VERT","Silver Vertical"),("SILVER HORI","Silver Horizontal"),
        ("SILVER LIN","Silver Linen"),("SILVER","Silver Linen"),("MIRROR","Mirror"),
    ]
    for k, v in rules:
        if k in s:
            return v
    return ""

def stem(p):
    return f"{p['series']}{p['pos']}-{p['width']}" + (" COP" if p["cop"] else "") + (" SPL" if p["spl"] else "")

def hlabel(h):
    return {2000:"STD",2100:"BIG",2400:"2400",2600:"2600"}[h]

def glabel(h):  # goods label
    return "Goods" + (f" {h}" if h in (2400,2600) else "")

def thk_sfx(t):
    return "" if t == 1.2 else (" 2mm" if t == 2.0 else f" {t}mm")

# ---- normalise every sheet row ----
rows = []
unparsed = []
for _, r in df.iterrows():
    p = parse_name(r["name"])
    if not p:
        unparsed.append(r["name"]); continue
    spec = str(r["spec"])
    p.update(material=r["material"], height=height(spec), thick=thick(spec),
             goods=is_goods(spec), finish=finish(spec), stock=float(r["stock"]))
    rows.append(p)

# ---- build catalog ----
# key -> dict(name, series, stock)  (dedupe by name; sum stock)
items = {}
def add(name, series, stock):
    if name in items:
        items[name]["stock"] += stock
    else:
        items[name] = dict(name=name, series=series, stock=stock, group=None)

# stock lookup for (A): passenger SS, default gauge, by (shape-key, finish)
def shapekey(p):
    return (p["series"], p["pos"], p["width"], p["cop"], p["spl"], p["height"])
aStock = {}
for p in rows:
    if p["material"] == "SS" and not p["goods"] and p["thick"] == 1.2 and p["finish"]:
        aStock[(shapekey(p), p["finish"])] = aStock.get((shapekey(p), p["finish"]), 0) + p["stock"]

# (A) expansion: every passenger-SS shape x 24 finishes, standard gauge
shapes = {}
for p in rows:
    if p["material"] == "SS" and not p["goods"]:
        shapes[shapekey(p)] = p  # representative
for sk, p in shapes.items():
    for f in DESIGNER_FINISHES:
        nm = f"{stem(p)} {hlabel(p['height'])} {f}"
        add(nm, p["series"], aStock.get((sk, f), 0.0))
        items[nm]["group"] = "A"

# (B) preserve actual rows that aren't passenger-SS-default-designer (already in A)
for p in rows:
    covered_by_A = (p["material"] == "SS" and not p["goods"] and p["thick"] == 1.2 and p["finish"])
    if covered_by_A:
        continue
    if p["material"] == "MS":
        lab = glabel(p["height"]) if p["goods"] else hlabel(p["height"])
        nm = f"{stem(p)} {lab} MS{thk_sfx(p['thick'])}"
    elif p["goods"]:  # SS goods
        nm = f"{stem(p)} {glabel(p['height'])} {p['finish'] or 'SS'}{thk_sfx(p['thick'])}"
    elif p["thick"] != 1.2:  # passenger SS explicit gauge
        nm = f"{stem(p)} {hlabel(p['height'])} {p['finish'] or 'SS'}{thk_sfx(p['thick'])}"
    else:  # passenger SS plain default gauge -> preserve only if it has stock
        if p["stock"] == 0:
            continue
        nm = f"{stem(p)} {hlabel(p['height'])} SS"
    add(nm, p["series"], p["stock"])
    if items[nm]["group"] is None:
        items[nm]["group"] = "B"

# ---- assign SIDE-NNN codes (ordered) ----
out = list(items.values())
def sortkey(it):
    m = re.match(r"^P(\d)([CRL]?)-?\s*(\d+)", it["name"])
    return (it["series"], int(m.group(3)) if m else 0, it["name"])
out.sort(key=sortkey)
for i, it in enumerate(out, 1):
    it["code"] = f"SIDE-{i:03d}"

# ---- sanity ----
sheet_total = round(sum(p["stock"] for p in rows), 3)
out_total = round(sum(it["stock"] for it in out), 3)
print("unparsed rows:", unparsed)
print("sheet rows parsed:", len(rows))
print("TOTAL catalog items:", len(out))
print("  group A (finish-expanded):", sum(1 for it in out if it["group"]=="A"))
print("  group B (preserved actual):", sum(1 for it in out if it["group"]=="B"))
print("items with stock != 0:", sum(1 for it in out if it["stock"]!=0))
print(f"STOCK CHECK  sheet_total={sheet_total}  catalog_total={out_total}  match={sheet_total==out_total}")
print("by series:", {s: sum(1 for it in out if it['series']==s) for s in ['P1','P2','P3','P4','P5','P6']})
print("\nsamples:")
for it in out[:6] + [it for it in out if it["stock"]!=0][:8]:
    print(f"  {it['code']}  {it['name']:42}  stock={it['stock']:g}  ({it['group']})")

json.dump(out, open(OUT_JSON, "w"), indent=0)
pd.DataFrame(out)[["code","series","name","stock","group"]].to_csv(OUT_CSV, index=False)
print("\nwrote", OUT_JSON, "and", OUT_CSV)
