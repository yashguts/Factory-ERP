"""
Populate items.family (= base item) and items.finish (= finish) for the finish-fanned
cabin items (Side Panel / Front Wall / Car Linton), so the New Cabin Job picker can
offer base-item -> finish and resolve to the exact inventory item.

- Inventory rows are otherwise UNTOUCHED (name/code/stock unchanged). family/finish are
  metadata only and are not shown on the inventory pages.
- Granite is a TYPE: it stays in the base; its finish is NULL (no finish yet).
- DRY-RUN by default. Pass --commit to write. Re-runnable (idempotent).
- Revert:  UPDATE items SET family=NULL, finish=NULL
           WHERE code ILIKE 'SIDE-%' OR code ILIKE 'FW-%' OR code ILIKE 'LINTON-%';
"""
import urllib.request, json, re, sys, collections

SUPABASE_URL = "https://qwzisnmueuqnzzokkpmn.supabase.co"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14"
COMMIT = "--commit" in sys.argv

def supa(path, method="GET", body=None):
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(req) as r:
        return r.read()

def supa_json(path):
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def all_rows(table, select, extra=""):
    out, off = [], 0
    while True:
        c = supa_json(f"{table}?select={select}&{extra}&order=id&limit=1000&offset={off}")
        out += c
        if len(c) < 1000: break
        off += 1000
    return out

# ---------- parser (validated in analyze-cabin-finish-split.py) ----------
DESIGNER = ["Mirror","Black Hairline","Black Mirror","Golden","Golden Hairline","Golden Mirror",
    "Golden Jewellery","Rose Gold","Rose Gold Mirror","Rose Gold Etching","Rose Gold Lilen","Champagne",
    "Silver Linen","Silver Horizontal","Silver Vertical","White Mirror Silver","Blue Flower","Moon Rock",
    "Honey Comb","Designer IPF01","Grade 430 Mirror","Bronze","Wooden","Chequered","TI Black"]
SS = ["SS 304","SS 430","SS 441","SS"]
MS = ["MS"]
TOUCH = ["Mirror Touch"] + [d + " Touch" for d in DESIGNER]
VOCAB = sorted(set(DESIGNER + SS + MS + TOUCH), key=len, reverse=True)
TYPE_TOKENS = ["Granite"]
GLASS = ["(Both Side Glass)","(LHS Glass)","(RHS Glass)","(Glass)"]
THK = [" 1.5mm"," 1.6mm"," 2mm"]
NO_FINISH = "\x00"   # internal sentinel -> stored as NULL

def strip_tokens(name):
    extra, n = "", name
    for g in GLASS:
        if g in n:
            n = n.replace(g, "").strip(); extra = " " + g
    for t in THK:
        if n.endswith(t):
            n = n[:-len(t)].strip(); extra = t + extra
    return n, extra

def split_side_or_fw(name):
    core, extra = strip_tokens(name)
    type_sfx = ""
    for t in TYPE_TOKENS:
        m = re.search(r"\s*\b" + re.escape(t) + r"\b", core)
        if m:
            core = (core[:m.start()] + " " + core[m.end():]).strip(); type_sfx += " " + t
    for f in VOCAB:
        if core == f or core.endswith(" " + f):
            base = core[:len(core) - len(f)].strip()
            return (base + type_sfx + extra).strip(), f
    if type_sfx:
        return (core + type_sfx + extra).strip(), NO_FINISH
    return None, None

def split_car_linton(name):
    m = re.search(r"\(([^)]+)\)", name)
    if m:
        fin = m.group(1).strip()
        base = re.sub(r"\s*\([^)]+\)", "", name)
        base = re.sub(r"\bPannel\s+(\w+)\s+SS\s*/", r"Pannel \1 /", base)
        return re.sub(r"\s+", " ", base).strip(), fin
    m = re.search(r"Pannel\s+(\w+)\s+(SS 304|SS 430|SS 441|SS|MS)\s*/\s*(\d+)\s*mm\s*(R1|STD)?", name)
    if m:
        op, fin, size, var = m.group(1), m.group(2), m.group(3), (m.group(4) or "STD")
        return f"Car Linton Pannel {op} /{size}mm {var}", fin
    if name.lower().startswith("collapsible"):
        return name, "MS"
    return None, None

# ---------- gather + parse ----------
cats = all_rows("item_categories", "id,name,parent_id")
children = collections.defaultdict(list)
for c in cats:
    if c["parent_id"]: children[c["parent_id"]].append(c["id"])
cabin = next(c for c in cats if c["name"] == "Cabin" and c["parent_id"] is None)
def subtree(rid):
    ids, st = [], [rid]
    while st:
        i = st.pop(); ids.append(i); st += children.get(i, [])
    return ids
roots = {c["name"]: c["id"] for c in cats
         if c["parent_id"] == cabin["id"] and c["name"] in ("Side Panel","Front Wall","Car Linton")}

updates = []        # (id, code, family, finish_or_None)
unparsed = []
for tname, rid in roots.items():
    items = all_rows("items", "id,code,name", "is_active=eq.true&category_id=in.(%s)" % ",".join(subtree(rid)))
    split = split_car_linton if tname == "Car Linton" else split_side_or_fw
    for it in items:
        base, fin = split(it["name"])
        if base is None:
            unparsed.append((tname, it["code"], it["name"])); continue
        updates.append((it["id"], it["code"], base, None if fin == NO_FINISH else fin))

# ---------- guards ----------
# 1) nothing unparsed
if unparsed:
    print("ABORT: unparsed items:", len(unparsed))
    for u in unparsed[:20]: print("   ?", u)
    sys.exit(1)
# 2) (family,finish) globally unique among our updates
keys = collections.Counter((u[2], u[3]) for u in updates)
dups = [k for k, c in keys.items() if c > 1]
# 3) no collision with existing non-cabin family/finish rows
existing = supa_json("items?select=code,family,finish&family=not.is.null")
cabin_codes = {u[1] for u in updates}
existing_keys = {(e["family"], e["finish"]) for e in existing if e["code"] not in cabin_codes}
collide = [k for k in keys if k in existing_keys and k[1] is not None]

fin_counts = collections.Counter(u[3] for u in updates)
print(f"to update: {len(updates)}  | distinct (family,finish): {len(keys)}  | internal dups: {len(dups)}")
print(f"Granite (finish NULL): {fin_counts.get(None, 0)}")
print(f"collisions vs existing non-cabin family/finish: {len(collide)} {collide[:5]}")
if dups or collide:
    print("ABORT: would break exact (family,finish) -> item mapping."); sys.exit(1)

if not COMMIT:
    print("\nDRY RUN ok (no writes). Re-run with --commit to apply. Samples:")
    for u in updates[:6]: print("   ", u[1], "| family=", u[2], "| finish=", u[3])
    sys.exit(0)

# ---------- write (concurrent per-item PATCH; idempotent, re-runnable) ----------
print("\nWriting (concurrent)...")
import concurrent.futures
def patch_one(u):
    _id, code, fam, fin = u
    supa(f"items?id=eq.{_id}", method="PATCH", body={"family": fam, "finish": fin})
    return 1
done = 0
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
    for _ in ex.map(patch_one, updates):
        done += 1
        if done % 1000 == 0:
            print(f"  {done}/{len(updates)}", flush=True)
print(f"DONE: set family/finish on {done} items.")
