"""
Build the Front Wall cabin catalog from 'Cabin Panel and Front Post.xlsx'
sheet 'Front Post' (Type col = Front Wall). Rules agreed with owner:

- Sub-type = door-type Category (ACO/AT/Collapsible/Goods Collapsible/Swing/MT/
  COP Back Cover/AFF/Goods AFF).
- Shape = P1{L/R}[(R)]-{width|WxD} + LHO/RHO + R1 + COP + height (STD=2000,
  BIG=2100, 1900). R1 and LHO/RHO and (R) are SHAPE variants.
- Fan-out (designer 24 + plain SS by grade: SS/SS304/SS430/SS441 = 28) applies to
  SS shapes at standard gauge, EXCEPT categories Collapsible / Goods Collapsible /
  COP Back Cover, EXCEPT goods rows, EXCEPT explicit 1.5/1.6/2mm rows.
- Granite / Touch are NOT fanned out — preserved where they appear (clean name).
- Bare rows (no material, no finish) = plain SS. Only explicit "MS" = MS.
- Map existing designer names + fix typos. Preserve all stock (negatives kept).
Outputs: scripts/front-wall.json + Desktop CSV.
"""
import pandas as pd, re, json, os

PATH = r"C:\Users\yash_\OneDrive\Desktop\Cabin Panel and Front Post.xlsx"
OUT_JSON = os.path.join(os.path.dirname(__file__), "front-wall.json")
OUT_CSV  = r"C:\Users\yash_\OneDrive\Desktop\Cabin-Front-Wall-Catalog.csv"

DESIGNER = ["Mirror","Black Hairline","Black Mirror","Golden","Golden Hairline","Golden Mirror",
    "Golden Jewellery","Rose Gold","Rose Gold Mirror","Rose Gold Etching","Rose Gold Lilen","Champagne",
    "Silver Linen","Silver Horizontal","Silver Vertical","White Mirror Silver","Blue Flower","Moon Rock",
    "Honey Comb","Designer IPF01","Grade 430 Mirror","Bronze","Wooden","Chequered"]
SS_PLAIN = ["SS","SS 304","SS 430","SS 441"]
FANOUT = SS_PLAIN + DESIGNER                      # 28 finishes fanned out onto SS shapes
EXCLUDE_CATS = {"Collapsible","Goods Collapsible","COP Back Cover"}

df = pd.read_excel(PATH, sheet_name="Front Post", header=0)
df.columns = ["type","category","name","stock"]
df = df[df["name"].notna()].reset_index(drop=True)
df["stock"] = pd.to_numeric(df["stock"], errors="coerce").fillna(0)

def clean(s):
    s = str(s).strip().upper()
    s = s.replace("COP BACK COVER", " ")          # category already says it
    s = re.sub(r"\bPIR\b", "P1R", s); s = re.sub(r"\bPIL\b", "P1L", s)
    s = s.replace("ROSEGOLD", "ROSE GOLD").replace("R1RG", "R1 RG").replace("RI MIRROR", "R1 MIRROR")
    s = re.sub(r"CHAMPIANG|CHAPIGANE|CHAMPIAN|CHAPIGAN", "CHAMPAGNE", s)
    return re.sub(r"\s+", " ", s).strip()

def designer_finish(s):
    for k, v in [("ROSE GOLD MIRROR","Rose Gold Mirror"),("RG MIRROR","Rose Gold Mirror"),
        ("ROSE GOLD","Rose Gold"),("R GOLD","Rose Gold"),("GOLDEN MIRROR","Golden Mirror"),
        ("GOLD MIRROR","Golden Mirror"),("GOLDEN HAIR","Golden Hairline"),("GOLDEN","Golden"),
        ("MOON ROCK","Moon Rock"),("CHAMPAGNE","Champagne"),("BLACK HAIR","Black Hairline"),
        ("BLACK HL","Black Hairline"),("BLACK MIRROR","Black Mirror"),("HONEY","Honey Comb"),
        ("BLUE","Blue Flower"),("IPF","Designer IPF01"),("WHITE MIRROR","White Mirror Silver"),
        ("MIRROR","Mirror")]:
        if k in s: return v
    return ""

def parse(category, raw):
    s = clean(raw)
    m = re.match(r"^P\s*1\s*([LR])\s*(\(R\))?\s*-?\s*(\d+(?:\s*X\s*\d+)?)\s*(.*)$", s)
    if not m: return None
    pos, rflag, width, tail = m.group(1), bool(m.group(2)), m.group(3).replace(" ", ""), m.group(4)
    hand = "LHO" if re.search(r"\(?\s*LHO", tail) else "RHO" if re.search(r"\(?\s*RHO", tail) else ""
    r1   = bool(re.search(r"\bR1\b", tail))
    cop  = "COP" in tail
    goods = category.startswith("Goods") or "GOODS" in tail
    height = 1900 if "1900" in tail else 2100 if "BIG" in tail else 2000
    thick = 1.5 if "1.5" in tail else 1.6 if "1.6" in tail else 2.0 if re.search(r"\b2\s*MM|2\.0MM", tail) else 1.2
    granite = "GRANITE" in tail
    touch = "TOUCH" in tail
    df_fin = designer_finish(tail)
    if granite: finish = "Granite" + (" Touch" if touch else "")     # special, preserved
    elif df_fin: finish = df_fin + (" Touch" if touch else "")
    elif touch: finish = "Mirror Touch"                              # 'touch' alone seen with mirror
    else: finish = ""
    is_ms = bool(re.search(r"\bMS\b", tail))
    special = granite or touch                                       # Granite/Touch: never fanned out
    return dict(category=category, pos=pos, rflag=rflag, width=width, hand=hand, r1=r1, cop=cop,
                goods=goods, height=height, thick=thick, finish=finish, is_ms=is_ms, special=special,
                stock=float(0))

rows, unparsed = [], []
for _, r in df.iterrows():
    p = parse(str(r["category"]).strip(), r["name"])
    if not p: unparsed.append((r["name"], float(r["stock"]))); continue
    p["stock"] = float(r["stock"]); rows.append(p)

def stem(p):
    return f"P1{p['pos']}" + ("(R)" if p["rflag"] else "") + f"-{p['width']}"
HL = {2000:"STD",2100:"BIG",1900:"1900"}
def toks(p):
    t = []
    if p["hand"]: t.append(p["hand"])
    if p["r1"]: t.append("R1")
    if p["cop"]: t.append("COP")
    t.append(HL[p["height"]])
    if p["goods"] and not p["category"].startswith("Goods"): t.append("Goods")
    return t
def thk(t): return "" if t == 1.2 else (" 2mm" if t == 2.0 else f" {t}mm")
def name_for(p, finish):
    # category is part of the name: same panel code recurs across door types, and
    # item names must be globally unique.
    return " ".join([p["category"], stem(p)] + toks(p) + [finish]) + thk(p["thick"])

# material: only explicit MS is MS; everything else (SS, designer, bare) is SS
def is_ss(p): return not p["is_ms"]
def shapekey(p): return (p["category"], p["pos"], p["rflag"], p["width"], p["hand"], p["r1"], p["cop"], p["height"])
def fanout_row(p):  # part of (A) standard-gauge fan-out?
    return (is_ss(p) and not p["special"] and not p["goods"]
            and p["category"] not in EXCLUDE_CATS and p["thick"] == 1.2)

items = {}
def add(name, category, stock):
    if name in items: items[name]["stock"] += stock
    else: items[name] = dict(name=name, category=category, stock=stock, group=None)

# (A) fan-out: every SS shape (fan-out eligible) x 28 finishes at standard gauge
aStock = {}
for p in rows:
    if fanout_row(p):
        f = p["finish"] or "SS"            # designer name, or plain SS
        if f in FANOUT:
            aStock[(shapekey(p), f)] = aStock.get((shapekey(p), f), 0) + p["stock"]
shapes = {}
for p in rows:
    if is_ss(p) and not p["special"] and not p["goods"] and p["category"] not in EXCLUDE_CATS:
        shapes.setdefault(shapekey(p), p)
for sk, p in shapes.items():
    for f in FANOUT:
        nm = name_for(p, f)
        add(nm, p["category"], aStock.get((sk, f), 0.0))
        items[nm]["group"] = "A"

# (B) preserve every row not covered by (A)
for p in rows:
    if fanout_row(p) and (p["finish"] or "SS") in FANOUT:
        continue                                              # already in (A)
    if p["is_ms"]:
        fin = "MS"
    elif p["special"]:
        fin = p["finish"]                                     # Granite / *Touch
    elif p["finish"]:
        fin = p["finish"]                                     # designer at explicit gauge / excluded cat
    else:
        fin = "SS"                                            # plain SS (bare)
    nm = name_for(p, fin)
    add(nm, p["category"], p["stock"])
    if items[nm]["group"] is None: items[nm]["group"] = "B"

out = list(items.values())
out.sort(key=lambda it: (it["category"], it["name"]))
for i, it in enumerate(out, 1): it["code"] = f"FW-{i:04d}"

sheet_total = round(sum(p["stock"] for p in rows), 3)
out_total = round(sum(it["stock"] for it in out), 3)
print("unparsed:", unparsed, "| unparsed stock:", sum(s for _, s in unparsed))
print("rows parsed:", len(rows), "| catalog items:", len(out))
print("  A (fan-out):", sum(1 for it in out if it["group"]=="A"), "| B (preserved):", sum(1 for it in out if it["group"]=="B"))
print(f"STOCK CHECK sheet={sheet_total} catalog={out_total} match={sheet_total==out_total}")
print("by category:")
for c in sorted(set(it["category"] for it in out)):
    print(f"  {c:18}: {sum(1 for it in out if it['category']==c)}")
print("\nsamples (stocked):")
for it in [x for x in out if x["stock"] != 0][:14]:
    print(f"  {it['code']}  {it['name']:46} {it['category']:16} stock={it['stock']:g} ({it['group']})")

json.dump(out, open(OUT_JSON, "w"), indent=0)
try:
    pd.DataFrame(out)[["code","category","name","stock","group"]].to_csv(OUT_CSV, index=False)
    print("\nwrote", OUT_JSON, "and", OUT_CSV)
except PermissionError:
    print("\nwrote", OUT_JSON, "(CSV locked - close it and re-run)")
