"""
READ-ONLY analysis. Minimal set of AUDITED programs to run so the Make-type MRP
shortfall (cutoff 1 Jul 2026) hits zero.

1. Replicate getMrpData's Make shortfall (in-production jobs, requirement-stage scope,
   dispatch-netted) at the cutoff.
2. Map audited program outputs -> items.
3. Greedy set-cover: fewest audited programs (run enough times) to cover every coverable
   shortfall item. Report per category. For items no audited program makes, name the
   pending program(s) that WOULD cover them (audit-then-run).

No DB writes.
"""
import urllib.request, json, math, collections

URL = "https://qwzisnmueuqnzzokkpmn.supabase.co"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14"
CUTOFF = "2026-07-01"
FIRST_PHASE = {"RAIL","Stud Anchor","BRICK","MAIN BRACKET","COUNTER BRACKET","RAIL CLIP",
  "Buffer Channel Main","Buffer Channel Counter","Door Post / Frame","Door Sill","Linton Panel",
  "CONT. STAND","TROUGHING 50","TROUGHING 100","FIREMAN SWITCH"}

def get(path):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}",
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def get_all(table, select, extra=""):
    out, off = [], 0
    while True:
        c = get(f"{table}?select={select}&{extra}&order=id&limit=1000&offset={off}")
        out += c
        if len(c) < 1000: break
        off += 1000
    return out

def in_batches(ids, fn, n=150):
    out = []
    for i in range(0, len(ids), n):
        out += fn(ids[i:i+n])
    return out

# ---- 1. MRP Make shortfall (replicates getMrpData) ----
jobs = get_all("jobs", "id,requirement_stage",
               f"status=eq.in_production&requirement_dispatch_date=lte.{CUTOFF}")
stage_by_job = {j["id"]: (j.get("requirement_stage") or "full_material") for j in jobs}
job_ids = list(stage_by_job)

header_to_job = {}
for h in in_batches(job_ids, lambda b: get(f"job_bom_headers?select=id,job_id&job_id=in.({','.join(b)})")):
    header_to_job[h["id"]] = h["job_id"]
header_ids = list(header_to_job)

# NOTE: job_bom_lines can exceed the 1000-row PostgREST cap, so paginate each batch
# (get_all loops range/offset) — a plain get() would silently truncate to 1000.
lines = []
for i in range(0, len(header_ids), 150):
    b = header_ids[i:i+150]
    lines += get_all("job_bom_lines",
        "id,item_id,required_quantity,job_bom_id,category",
        f"job_bom_id=in.({','.join(b)})&item_id=not.is.null&required_quantity=gt.0")

disp = collections.defaultdict(float)
for d in get_all("job_dispatch_lines", "job_bom_line_id,qty", "job_bom_line_id=not.is.null"):
    disp[d["job_bom_line_id"]] += float(d.get("qty") or 0)

required = collections.defaultdict(float)
for l in lines:
    job = header_to_job.get(l["job_bom_id"]); stage = stage_by_job.get(job)
    if not stage or stage == "new": continue
    if stage == "first_phase" and l.get("category") not in FIRST_PHASE: continue
    net = max(0.0, float(l["required_quantity"] or 0) - disp.get(l["id"], 0))
    if net > 0: required[l["item_id"]] += net

req_ids = list(required)
items = {it["id"]: it for it in in_batches(req_ids, lambda b: get(
    f"items?select=id,code,name,category_id,procurement_type&id=in.({','.join(b)})"))}
cats = {c["id"]: c for c in get_all("item_categories", "id,name,procurement_type")}
stock = collections.defaultdict(float)
for inv in in_batches(req_ids, lambda b: get(f"inventory?select=item_id,quantity&item_id=in.({','.join(b)})")):
    stock[inv["item_id"]] += float(inv.get("quantity") or 0)

short = {}   # item_id -> {code,name,cat,shortfall}
for iid, req in required.items():
    it = items.get(iid)
    if not it: continue
    cat = cats.get(it.get("category_id")) or {}
    eff = it.get("procurement_type") or cat.get("procurement_type")
    sf = req - stock.get(iid, 0)
    if eff == "make" and sf > 0:
        short[iid] = {"code": it["code"], "name": it["name"],
                      "cat": cat.get("name") or "(none)", "shortfall": sf}

# ---- 2. program outputs (audited + pending) for shortfall items ----
ops = {o["id"]: o for o in get_all("operations", "id,name,code,machine,audited_at,is_active", "is_active=eq.true")}
aud_by_item = collections.defaultdict(dict)   # item -> {op_id: qty_per_run}
pend_by_item = collections.defaultdict(dict)
# Only role='component' outputs produce a real stocked item (cut_part/tooling/scrap don't).
for o in get_all("operation_outputs", "operation_id,item_id,qty_per_run,role",
                 "item_id=not.is.null&qty_per_run=gt.0&role=eq.component"):
    op = ops.get(o["operation_id"])
    if not op or o["item_id"] not in short: continue
    tgt = aud_by_item if op["audited_at"] else pend_by_item
    tgt[o["item_id"]][o["operation_id"]] = tgt[o["item_id"]].get(o["operation_id"], 0) + float(o["qty_per_run"])

coverable = set(aud_by_item)                       # shortfall items an audited program makes
gap = set(short) - coverable                       # need a pending program (or none)

# ---- 3. greedy set-cover over audited programs ----
prog_items = collections.defaultdict(set)          # op_id -> coverable shortfall items it makes
for iid in coverable:
    for op_id in aud_by_item[iid]:
        prog_items[op_id].add(iid)

uncovered = set(coverable); selected = {}
while uncovered:
    best = max(prog_items, key=lambda op: (
        len(prog_items[op] & uncovered),
        sum(short[i]["shortfall"] for i in prog_items[op] & uncovered)))
    newly = prog_items[best] & uncovered
    if not newly: break
    selected[best] = newly
    uncovered -= newly

runs = {}
for op_id, its in selected.items():
    runs[op_id] = max(math.ceil(short[i]["shortfall"] / aud_by_item[i][op_id]) for i in its)

# ---- 4. report ----
print(f"Make shortfall @ cutoff {CUTOFF}: {len(short)} items, "
      f"{round(sum(s['shortfall'] for s in short.values()))} units")
print(f"  coverable by audited programs: {len(coverable)} items")
print(f"  audit-gap (no audited program): {len(gap)} items "
      f"({sum(1 for i in gap if i in pend_by_item)} have a PENDING program)")
print(f"\n>>> MINIMUM AUDITED PROGRAMS TO RUN: {len(selected)} <<<\n")

# sanity: per-category shortfall totals (cross-check vs SQL)
bycat_tot = collections.defaultdict(lambda: [0, 0.0])
for s in short.values():
    bycat_tot[s["cat"]][0] += 1; bycat_tot[s["cat"]][1] += s["shortfall"]

print("="*78)
print("THE PLAN — programs to run (each covers items across categories):")
print("="*78)
for op_id in sorted(selected, key=lambda o: -len(selected[o])):
    op = ops[op_id]
    covered = sorted(selected[op_id], key=lambda i: short[i]["cat"])
    print(f"\n[{op['code']}] {op['name']}  ({op['machine']})  ->  RUN x{runs[op_id]}"
          f"   covers {len(covered)} shortfall item(s):")
    for i in covered:
        s = short[i]; made = runs[op_id] * aud_by_item[i][op_id]
        print(f"    - {s['code']:14} {s['name'][:42]:42} [{s['cat']}]  need {s['shortfall']:g}, make {made:g}")

print("\n" + "="*78)
print("AUDIT-GAP — shortfall items NO audited program covers:")
print("="*78)
gap_by_cat = collections.defaultdict(list)
for i in gap: gap_by_cat[short[i]["cat"]].append(i)
unlock = collections.Counter()
for cat in sorted(gap_by_cat):
    print(f"\n  {cat}:")
    for i in sorted(gap_by_cat[cat], key=lambda i:-short[i]["shortfall"]):
        s = short[i]
        if i in pend_by_item:
            pend = sorted(pend_by_item[i], key=lambda o: ops[o]["code"])
            names = ", ".join(f"{ops[o]['code']}" for o in pend[:3])
            for o in pend_by_item[i]: unlock[o] += 1
            print(f"    - {s['code']:14} need {s['shortfall']:g}  -> AUDIT one of: {names}")
        else:
            print(f"    - {s['code']:14} need {s['shortfall']:g}  -> NO program exists yet")

if unlock:
    print("\n  Highest-leverage PENDING programs to audit (unlock the most gap items):")
    for op_id, n in unlock.most_common(12):
        print(f"    [{ops[op_id]['code']}] {ops[op_id]['name'][:46]:46} -> unlocks {n} item(s)")

# ---- 5. full CSV record on the Desktop ----
import csv
item_to_prog = {i: op for op, its in selected.items() for i in its}
out_rows = []
for iid, s in sorted(short.items(), key=lambda kv: (kv[1]["cat"], -kv[1]["shortfall"])):
    if iid in item_to_prog:
        op = ops[item_to_prog[iid]]; r = runs[item_to_prog[iid]]
        out_rows.append({"category": s["cat"], "code": s["code"], "name": s["name"],
            "shortfall": round(s["shortfall"]), "status": "RUN audited program",
            "program": op["code"], "program_name": op["name"], "runs": r,
            "units_made": round(r * aud_by_item[iid][item_to_prog[iid]])})
    elif iid in pend_by_item:
        progs = ";".join(sorted(ops[o]["code"] for o in pend_by_item[iid]))
        out_rows.append({"category": s["cat"], "code": s["code"], "name": s["name"],
            "shortfall": round(s["shortfall"]), "status": "AUDIT pending program, then run",
            "program": progs, "program_name": "", "runs": "", "units_made": ""})
    else:
        out_rows.append({"category": s["cat"], "code": s["code"], "name": s["name"],
            "shortfall": round(s["shortfall"]), "status": "NO program exists - create one",
            "program": "", "program_name": "", "runs": "", "units_made": ""})
path = r"C:\Users\yash_\OneDrive\Desktop\Factory-ERP-MRP-Make-Plan.csv"
with open(path, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=["category","code","name","shortfall","status","program","program_name","runs","units_made"])
    w.writeheader(); w.writerows(out_rows)
print(f"\nWrote full plan: {path} ({len(out_rows)} items)")
