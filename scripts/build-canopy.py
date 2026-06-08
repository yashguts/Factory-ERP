"""
Build the Canopy cabin catalog from the owner's pasted inventory list.
Direct import (NO finish fan-out): items under the Canopy type, sub-typed by
Category (Fan / Blower / Goods / R1 Type), names prefixed "Canopy ", quantities
preserved (negatives kept), deduped by name. Outputs scripts/canopy.json + CSV.
"""
import json, os, re

OUT_JSON = os.path.join(os.path.dirname(__file__), "canopy.json")
OUT_CSV  = r"C:\Users\yash_\OneDrive\Desktop\Cabin-Canopy-Catalog.csv"

# category|name|qty  (transcribed verbatim from the owner's list)
DATA = """
Fan|STD 750x1000|0
Fan|STD 800X800|0
Fan|STD 800X900|0
Fan|STD 800X1000|0
Fan|STD 800X1100|0
Fan|STD 800X1300|0
Fan|STD 820X800|1
Fan|STD 820X900|0
Fan|STD820X1000|3
Fan|STD 820X1100|1
Fan|STD 900X700|0
Fan|STD 900X800|1
Fan|STD 900X900|4
Fan|STD 900X1000|0
Fan|STD 900X1100|1
Fan|STD 900X1200|0
Fan|STD 900X1300|0
Fan|STD 900X1600|0
Fan|STD 950X1150|2
Fan|STD 950X1250|1
Fan|STD 1000X700|0
Fan|STD 1000X750|0
Fan|STD 1000X800|4
Fan|STD 1000X900|0
Fan|STD 1000X950|1
Fan|STD 1000X1000|0
Fan|STD 1000X1100|0
Fan|STD 1000X1160|0
Fan|STD 1000X1300|1
Fan|STD 1000X1350|0
Fan|STD 1000X1400|0
Fan|STD 1000X1750|1
Fan|STD 1000X2000|0
Fan|STD 1000X2400|0
Fan|STD 1050X820|1
Fan|STD 1100X700|0
Fan|STD 1100X800|0
Fan|STD 1100X850|1
Fan|STD 1100X900|0
Fan|STD 1100X1000|1
Fan|STD 1100X1160|0
Fan|STD 1100X1300|0
Fan|STD 1100X1800|0
Fan|STD 1100X2400|0
Fan|STD 1150X800|1
Fan|STD 1170X700|0
Fan|STD 1170X715|0
Fan|STD 1170X720|2
Fan|STD 1170X780|1
Fan|STD 1170X800|1
Fan|STD 1170X900|10
Fan|STD 1170X920|0
Fan|STD 1170X1000|0
Fan|STD 1170X1700|0
Fan|STD 1200X800|0
Fan|STD 1200X1100|2
Fan|STD 1200X1400|0
Fan|STD 1250X1000|0
Fan|STD 1300X1000|1
Fan|STD 1300X1100|0
Fan|STD 1300X1300|0
Fan|STD 1300X1310|0
Fan|STD 1400x900|0
Fan|STD 1400x1200|0
Fan|STD 1400x1900|0
Fan|STD 1500X2000|0
Fan|STD 1600X2400|0
Fan|STD 1600X2500|1
Fan|STD 1700X1300|0
Fan|STD 1700X1500|1
Fan|STD 1800X1400|0
Fan|STD 1900X2500|1
Blower|Blower|0
Blower|Blower 650X900|3
Blower|Blower 700X900|2
Blower|Blower 700X900 B-100|0
Blower|Blower 750X900 B-100|0
Blower|Blower 800X800|0
Blower|Blower 800X900|1
Blower|Blower 800X1000|0
Blower|Blower 820X850|0
Blower|Blower 820x1100|0
Blower|Blower 820x1200|0
Blower|Blower 820x1300|3
Blower|Blower 850x900|0
Blower|Blower 900X900|0
Blower|Blower 900X1000|2
Blower|Blower 900X1400|0
Blower|Blower 900X1600|1
Blower|BLOWER 900X2300|2
Blower|Blower_950X850|1
Blower|Blower 1000X700|0
Blower|Blower 1000X750|0
Blower|Blower 1000X900|3
Blower|Blower 1000X1000|3
Blower|Blower 1000X1200|0
Blower|Blower 1000X1300|0
Blower|Blower 1000X1400|0
Blower|Blower 1000X1700|0
Blower|Blower 1000X2000|0
Blower|Blower 1100x650|0
Blower|Blower 1100X700|0
Blower|Blower 1100X800|1
Blower|Blower1100X900|6
Blower|Blower 1100X1000|2
Blower|Blower 1100X2000|0
Blower|Blower 1100X1300|0
Blower|Blower 1100X1500|0
Blower|Blower 1100X1600|0
Blower|Blower 1100X1800|0
Blower|Blower 1100X2400|0
Blower|BLOWER 1150X1500|0
Blower|Blower 1170X800|19
Blower|Blower 1170X850|0
Blower|Blower 1170X900|3
Blower|BLOWER 1170X920|1
Blower|Blower 1170X1400|0
Blower|Blower 1170X1500|0
Blower|Blower 1170X1800|0
Blower|Blower 1170X2300|0
Blower|BLOWER 1200X700|0
Blower|BLOWER 1200X800|0
Blower|BLOWER 1200X900|0
Blower|Blower 1200X1200|1
Blower|Blower 1200X1400|0
Blower|Blower 1200X2000|0
Blower|B`lower 1300x800|0
Blower|Blower 1300X1100|1
Blower|Blower 1300X1350(BSO)|2
Blower|Blower 1300X1350|1
Blower|Blower 1300X1700|0
Blower|BLOWER 1300X1800|0
Blower|BLOWER 1300X2000|0
Blower|BLOWER 1300X2300|0
Blower|BLOWER 1300X2400|0
Blower|Blower 1400X1000|0
Blower|Blower 1400X1650(BSO)|0
Blower|Blower 1400X1800|0
Blower|Blower 1500X1300|0
Blower|Blower 1500X1400|0
Blower|Blower 1500X1500|0
Blower|Blower 1500X2400|0
Blower|Blower 1600X1100|0
Blower|Blower 1600X1400|0
Blower|Blower 1600X1900|1
Blower|Blower 1600X2000|0
Blower|Blower1600X2300|0
Blower|BLOWER 1600X2400|0
Blower|Blower 1700X1500|0
Blower|Blower 1800X650|0
Blower|Blower 1800X1200|0
Blower|Blower 1800X1300|1
Blower|Blower 1800X2000|0
Blower|Blower 1900X1700|0
Blower|Blower 2000X1500|0
Blower|Blower 2000X1100|0
Goods|GOODS_1100x1800|0
Goods|GOODS_1100x2000|0
Goods|GOODS_1300X2200|0
Goods|GOODS_1300X2550|0
Goods|GOODS_1300X2400|0
Goods|GOODS 1400x1600|0
Goods|GOODS 1500X2000|0
Goods|GOODS 1500X3300|0
Goods|GOODS_1600X2300|1
Goods|GOODS 1600X2500|0
Goods|GOODS_1700X1900|0
Goods|GOODS_1700X2000|0
Goods|GOODS_1700X2500|0
Goods|GOODS_1700X4000|0
Goods|GOODS 1800X1900|0
Goods|GOODS 1800X2000|0
Goods|GOODS_1800X2100|0
Goods|GOODS 1800X2400|0
Goods|GOODS_1800X2500|1
Goods|GOODS_1900X2000|0
Goods|GOODS_2000X1700|0
Goods|GOODS 2000X2100|0
Goods|GOODS_2000X2200|0
Goods|GOODS 2000X2300|0
Goods|GOODS 2000X2400|0
Goods|GOODS_2100X2500|0
Goods|GOODS_2100X2700|0
Goods|Goods 2300x2200|0
Goods|Goods 2300x2900|0
Goods|GOODS_2400X3200|0
Goods|GOODS_2400X5400|0
Goods|GOODS_2500X1700|0
Goods|GOODS_2500x2300|0
Goods|GOODS_2600X3300|0
Goods|Goods 2700x4700|0
Goods|GOODS_2750X5330|0
Goods|GOODS_3100x2550|0
R1 Type|800x300 Blower R1|0
R1 Type|800X300 R1|0
R1 Type|800X200 R1|0
R1 Type|800X100 R1|0
R1 Type|820x300 Blower R1|3
R1 Type|820X300 R1|7
R1 Type|820X200 R1|7
R1 Type|820X100 R1|0
R1 Type|900X300 Blower R1|0
R1 Type|900X300 R1|3
R1 Type|900X200 R1|0
R1 Type|900X100 R1|2
R1 Type|1000X300 Blower R1|5
R1 Type|1000X300 R1|1
R1 Type|1000X200 R1|8
R1 Type|1000X100 R1|2
R1 Type|1100X300 Blower R1|2
R1 Type|1100X300 R1|8
R1 Type|1100X200 R1|0
R1 Type|1100X100 R1|4
R1 Type|1200X300 Blower R1|0
R1 Type|1200X300 R1|0
R1 Type|1200X200 R1|0
R1 Type|1200X100 R1|0
R1 Type|1300X300 Blower R1|0
R1 Type|1300X300 R1|0
R1 Type|1300X200 R1|0
R1 Type|1300X150 R1|0
R1 Type|1300X100 R1|0
R1 Type|1400x300 Blower R1|0
R1 Type|1400x300 R1|1
R1 Type|1400x200 R1|0
R1 Type|1400x100 R1|0
R1 Type|1500x300 Blower R1|0
R1 Type|1500x300 R1|3
R1 Type|1500x250 R1|0
R1 Type|1500x200 R1|0
R1 Type|1500x100 R1|2
R1 Type|1600x300 Blower R1|2
R1 Type|1600x300 R1|1
R1 Type|1600x200 R1|2
R1 Type|1600x100 R1|0
R1 Type|1700x300 R1|0
R1 Type|1700x300 Blower R1|1
R1 Type|1700x200 R1|1
R1 Type|1700x100 R1|0
R1 Type|1800x300 R1|2
R1 Type|1800x300 Blower R1|0
R1 Type|1800x200 R1|2
R1 Type|1800x100 R1|0
R1 Type|2000X300 R1|-3
R1 Type|2000X300 Blower R1|-2
R1 Type|2000x200 R1|-1
R1 Type|2000x150 R1|-1
R1 Type|2000x100 R1|0
R1 Type|2200X300 R1|11
R1 Type|2200X300 BLOWER R1|4
R1 Type|2200X200 R1|0
R1 Type|2200X100 R1|0
"""

byname = {}
for line in DATA.strip().splitlines():
    cat, name, qty = [p.strip() for p in line.split("|")]
    name = name.replace("B`lower", "Blower")          # fix the one typo
    name = re.sub(r"\s+", " ", name).strip()
    full = f"Canopy {name}"
    q = float(qty)
    if full in byname:
        byname[full]["stock"] += q                    # dedupe repeats (sum qty)
    else:
        byname[full] = {"category": cat, "name": full, "stock": q}

out = list(byname.values())
total = round(sum(it["stock"] for it in out), 3)
print("input rows:", len(DATA.strip().splitlines()), "| unique items:", len(out))
print("by category:", {c: sum(1 for it in out if it["category"] == c) for c in ["Fan","Blower","Goods","R1 Type"]})
print("total stock:", total, "| items w/ stock:", sum(1 for it in out if it["stock"] != 0),
      "| negatives:", sum(1 for it in out if it["stock"] < 0))
print("samples:")
for it in out[:4] + [x for x in out if x["stock"] != 0][:4]:
    print(f"  [{it['category']}] {it['name']}  qty={it['stock']:g}")

json.dump(out, open(OUT_JSON, "w"), indent=0)
try:
    import pandas as pd
    pd.DataFrame(out)[["category","name","stock"]].to_csv(OUT_CSV, index=False)
    print("wrote", OUT_JSON, "and", OUT_CSV)
except Exception:
    print("wrote", OUT_JSON)
