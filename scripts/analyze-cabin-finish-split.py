"""
READ-ONLY analysis: can every finish-fanned cabin item be split into
(base item, finish) losslessly, so (base + finish) -> exactly one inventory item?

No DB writes. Fetches Side Panel / Front Wall / Car Linton items, reverse-parses
each name into (family, finish) using the SAME vocabulary the build scripts used,
then validates the split is a bijection. Writes a CSV report to the Desktop.
"""
import urllib.request, urllib.parse, json, re, csv, os, collections

SUPABASE_URL = "https://qwzisnmueuqnzzokkpmn.supabase.co"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14"
OUT_CSV = r"C:\Users\yash_\OneDrive\Desktop\Cabin-Finish-Split-Report.csv"

def supa(path):
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def supa_all(table, select, extra=""):
    # order=id is REQUIRED: without a stable sort, PostgREST offset paging can
    # repeat/skip rows across pages -> false duplicates.
    out, off = [], 0
    while True:
        chunk = supa(f"{table}?select={select}&{extra}&order=id&limit=1000&offset={off}")
        out += chunk
        if len(chunk) < 1000:
            break
        off += 1000
    return out

# ---- category subtrees for the 3 fanned types ----
cats = supa_all("item_categories", "id,name,parent_id")
children = collections.defaultdict(list)
for c in cats:
    if c["parent_id"]:
        children[c["parent_id"]].append(c["id"])
cabin = next(c for c in cats if c["name"] == "Cabin" and c["parent_id"] is None)
def subtree(root_id):
    ids, stack = [], [root_id]
    while stack:
        i = stack.pop(); ids.append(i); stack += children.get(i, [])
    return ids
type_root = {}
for c in cats:
    if c["parent_id"] == cabin["id"] and c["name"] in ("Side Panel", "Front Wall", "Car Linton"):
        type_root[c["name"]] = c["id"]

# ---- finish vocabulary (from the build scripts) ----
DESIGNER = ["Mirror","Black Hairline","Black Mirror","Golden","Golden Hairline","Golden Mirror",
    "Golden Jewellery","Rose Gold","Rose Gold Mirror","Rose Gold Etching","Rose Gold Lilen","Champagne",
    "Silver Linen","Silver Horizontal","Silver Vertical","White Mirror Silver","Blue Flower","Moon Rock",
    "Honey Comb","Designer IPF01","Grade 430 Mirror","Bronze","Wooden","Chequered","TI Black"]
SS = ["SS 304","SS 430","SS 441","SS"]          # grades before plain SS (longest-first)
MS = ["MS"]
# "Touch" stays a finish (Mirror Touch / Rose Gold Touch / Rose Gold Mirror Touch).
# "Granite" is a TYPE, not a finish -> handled in the splitter (kept in the base item).
TOUCH = ["Mirror Touch"] + [d + " Touch" for d in DESIGNER]
VOCAB = sorted(set(DESIGNER + SS + MS + TOUCH), key=len, reverse=True)  # longest-first

# Type tokens that belong to the BASE item, never the finish.
TYPE_TOKENS = ["Granite"]
GLASS = ["(Both Side Glass)","(LHS Glass)","(RHS Glass)","(Glass)"]
THK = [" 1.5mm"," 1.6mm"," 2mm"]

def strip_tokens(name):
    """Pull glass + thickness out (they belong to the BASE, not the finish)."""
    base_extra = ""
    n = name
    for g in GLASS:
        if g in n:
            n = n.replace(g, "").strip(); base_extra = " " + g
    for t in THK:
        if n.endswith(t):
            n = n[: -len(t)].strip(); base_extra = t + base_extra
    return n, base_extra

def split_side_or_fw(name):
    core, extra = strip_tokens(name)
    # Pull type tokens (e.g. Granite) OUT of the finish and INTO the base item.
    type_sfx = ""
    for t in TYPE_TOKENS:
        m = re.search(r"\s*\b" + re.escape(t) + r"\b", core)
        if m:
            core = (core[:m.start()] + " " + core[m.end():]).strip()
            type_sfx += " " + t
    for f in VOCAB:
        if core == f or core.endswith(" " + f):
            base = core[: len(core) - len(f)].strip()
            return (base + type_sfx + extra).strip(), f
    if type_sfx:                       # a type item (Granite) with no finish yet
        return (core + type_sfx + extra).strip(), "(no finish)"
    return None, None                  # genuinely unrecognised -> must be flagged

def split_car_linton(name):
    # designer in parens
    m = re.search(r"\(([^)]+)\)", name)
    if m:
        fin = m.group(1).strip()
        base = re.sub(r"\s*\([^)]+\)", "", name)
        base = re.sub(r"\bPannel\s+(\w+)\s+SS\s*/", r"Pannel \1 /", base)  # drop material slot
        return re.sub(r"\s+", " ", base).strip(), fin
    # material slot holds grade / MS / plain SS
    m = re.search(r"Pannel\s+(\w+)\s+(SS 304|SS 430|SS 441|SS|MS)\s*/\s*(\d+)\s*mm\s*(R1|STD)?", name)
    if m:
        op, fin, size, var = m.group(1), m.group(2), m.group(3), (m.group(4) or "STD")
        return f"Car Linton Pannel {op} /{size}mm {var}", fin
    if name.lower().startswith("collapsible"):
        return name, "MS"
    return None, None

REPORT = []
print("="*72)
for tname in ("Side Panel", "Front Wall", "Car Linton"):
    ids = subtree(type_root[tname])
    items = supa_all("items", "id,code,name",
                     "is_active=eq.true&category_id=in.(%s)" % ",".join(ids))
    splitter = split_car_linton if tname == "Car Linton" else split_side_or_fw
    fam = collections.defaultdict(dict)   # base -> {finish: [items]}
    unparsed = []
    for it in items:
        base, fin = splitter(it["name"])
        if base is None:
            unparsed.append(it); continue
        fam[base].setdefault(fin, []).append(it)
        REPORT.append({"type": tname, "base": base, "finish": fin,
                       "code": it["code"], "name": it["name"]})
    # collisions: a (base, finish) that maps to >1 item -> would break exact lookup
    collisions = [(b, f, [x["code"] for x in lst])
                  for b, fs in fam.items() for f, lst in fs.items() if len(lst) > 1]
    finishes_per = [len(fs) for fs in fam.values()]
    print(f"{tname}:")
    print(f"  items={len(items)}  parsed={len(items)-len(unparsed)}  unparsed={len(unparsed)}")
    print(f"  bases (distinct items)={len(fam)}  "
          f"finishes/base: min={min(finishes_per)} max={max(finishes_per)} "
          f"avg={sum(finishes_per)/len(fam):.1f}")
    print(f"  COLLISIONS (base+finish -> >1 item): {len(collisions)}")
    for b, f, codes in collisions[:8]:
        print(f"     ! {b} | {f} -> {codes}")
    if unparsed:
        print("  UNPARSED (no recognised finish):")
        for it in unparsed[:12]:
            print(f"     ? {it['code']}  {it['name']}")
    # show one example base with all its finishes
    ex = max(fam.items(), key=lambda kv: len(kv[1]))
    print(f"  e.g. base '{ex[0]}' -> {len(ex[1])} finishes: "
          f"{', '.join(sorted(ex[1]))[:120]}...")
    print("-"*72)

with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=["type","base","finish","code","name"])
    w.writeheader(); w.writerows(REPORT)
print("wrote", OUT_CSV, f"({len(REPORT)} rows)")
