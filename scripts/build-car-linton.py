"""
Build the Car Linton cabin catalog from 'Car linton (2).xlsx'.
Rules agreed with owner:
- Sub-types by Category: ACO (opening CO), AT (opening SO), MT, Collapsible.
- Naming follows the sheet: "Car Linton Pannel {opening} {material}/{size}mm {variant}",
  designer finishes in parens "... ({finish})". SS grades go in the material slot
  ("SS 304/..."). Variant STD or R1.
- ACO + AT: full fan-out per (size, variant STD/R1): 25 designer finishes
  (24 standard + TI Black) + plain SS by grade (SS/304/430/441) + MS = 30 each.
- MT: MS only, STD only (as in sheet). Collapsible: the single MS item.
- Preserve the sheet's stock by matching on (opening, size, variant, finish/material),
  which is robust to the sheet's inconsistent "STD R1" vs "R1" labels.
Outputs scripts/car-linton.json + Desktop CSV.
"""
import pandas as pd, re, json, os

PATH = r"C:\Users\yash_\Downloads\Car linton (2).xlsx"
OUT_JSON = os.path.join(os.path.dirname(__file__), "car-linton.json")
OUT_CSV  = r"C:\Users\yash_\OneDrive\Desktop\Cabin-Car-Linton-Catalog.csv"

DESIGNER = ["Mirror","Black Hairline","Black Mirror","Golden","Golden Hairline","Golden Mirror",
    "Golden Jewellery","Rose Gold","Rose Gold Mirror","Rose Gold Etching","Rose Gold Lilen","Champagne",
    "Silver Linen","Silver Horizontal","Silver Vertical","White Mirror Silver","Blue Flower","Moon Rock",
    "Honey Comb","Designer IPF01","Grade 430 Mirror","Bronze","Wooden","Chequered","TI Black"]
SS_PLAIN = ["SS","SS 304","SS 430","SS 441"]
OPENING = {"ACO":"CO","AT":"SO"}
SIZES = {"ACO":[700,800,900,1000],"AT":[600,700,800,900,1000],"MT":[700,800]}
FINMAP = {"mirror":"Mirror","golden":"Golden","golden mirror":"Golden Mirror","rose gold":"Rose Gold",
          "champagne":"Champagne","ti black":"TI Black"}

df = pd.read_excel(PATH, sheet_name="Sheet1", header=0)
df.columns = ["category","name","qty"]
df["category"] = df["category"].ffill()
df = df[df["name"].notna()].reset_index(drop=True)
df["qty"] = pd.to_numeric(df["qty"], errors="coerce").fillna(0)

# stock by key (opening,size,variant,fom) ; collapsible keyed ("COLL",)
stock, unparsed = {}, []
for _, r in df.iterrows():
    nm = str(r["name"]).strip(); q = float(r["qty"])
    if nm.lower().startswith("collapsible"):
        stock[("COLL",)] = stock.get(("COLL",), 0) + q; continue
    m = re.search(r"Pannel\s+(\w+)\s+(SS|MS)\s*/\s*(\d+)\s*mm", nm)
    if not m:
        unparsed.append(nm); continue
    opening, mat, size = m.group(1), m.group(2), int(m.group(3))
    variant = "R1" if re.search(r"\bR1\b", nm) else "STD"
    fm = re.search(r"\(([^)]+)\)", nm)
    fom = FINMAP.get(fm.group(1).strip().lower(), fm.group(1).strip()) if fm else ("MS" if mat == "MS" else "SS")
    key = (opening, size, variant, fom)
    stock[key] = stock.get(key, 0) + q

items = []
def add(category, name, key):
    items.append({"category": category, "name": name, "stock": float(stock.get(key, 0.0))})

for cat in ["ACO", "AT"]:
    op = OPENING[cat]
    for size in SIZES[cat]:
        for variant in ["STD", "R1"]:
            for f in DESIGNER:
                add(cat, f"Car Linton Pannel {op} SS/{size}mm {variant} ({f})", (op, size, variant, f))
            for g in SS_PLAIN:
                add(cat, f"Car Linton Pannel {op} {g}/{size}mm {variant}", (op, size, variant, g))
            add(cat, f"Car Linton Pannel {op} MS/{size}mm {variant}", (op, size, variant, "MS"))
for size in SIZES["MT"]:
    add("MT", f"Car Linton Pannel MT MS/{size}mm STD", ("MT", size, "STD", "MS"))
items.append({"category": "Collapsible", "name": "Collapsible Car Linton Pannel MS 930",
              "stock": float(stock.get(("COLL",), 0.0))})

# dedup by name
seen = {}
for it in items: seen[it["name"]] = it
out = list(seen.values())

sheet_total = round(df["qty"].sum(), 3)
out_total = round(sum(it["stock"] for it in out), 3)
print("unparsed:", unparsed)
print("catalog items:", len(out))
print("by category:", {c: sum(1 for it in out if it["category"] == c) for c in ["ACO","AT","MT","Collapsible"]})
print(f"STOCK CHECK sheet={sheet_total} catalog={out_total} match={sheet_total == out_total}")
print("items with stock:", sum(1 for it in out if it["stock"] != 0))
print("\nsamples (stocked):")
for it in [x for x in out if x["stock"] != 0][:12]:
    print(f"  {it['category']:5} {it['name']:52} stock={it['stock']:g}")

json.dump(out, open(OUT_JSON, "w"), indent=0)
try:
    pd.DataFrame(out)[["category","name","stock"]].to_csv(OUT_CSV, index=False)
    print("\nwrote", OUT_JSON, "and", OUT_CSV)
except PermissionError:
    print("\nwrote", OUT_JSON, "(CSV locked - close it and re-run)")
