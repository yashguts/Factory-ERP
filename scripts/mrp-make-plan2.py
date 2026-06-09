"""
READ-ONLY. Make-shortfall program plan WITH assembly explosion.

Unlike v1 (which only matched programs that DIRECTLY output the finished item),
this explodes each Make shortfall item through its parts list (item_bom_lines)
down to the parts that programs actually cut (component + cut_part outputs),
netting stock at every level. Then greedy set-cover for the fewest audited
programs. Writes Desktop\\Factory-ERP-MRP-Make-Plan-v2.csv. No DB writes.
"""
import urllib.request, json, math, collections, csv
from collections import defaultdict, deque

URL="https://qwzisnmueuqnzzokkpmn.supabase.co"
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3emlzbm11ZXVxbnp6b2trcG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjM3OTQsImV4cCI6MjA5NTI5OTc5NH0.ljreeP3W9jHYexh6hgs7jGc5z5wM60p9Pq1UKmbto14"
CUTOFF="2026-07-01"
FIRST_PHASE={"RAIL","Stud Anchor","BRICK","MAIN BRACKET","COUNTER BRACKET","RAIL CLIP",
  "Buffer Channel Main","Buffer Channel Counter","Door Post / Frame","Door Sill","Linton Panel",
  "CONT. STAND","TROUGHING 50","TROUGHING 100","FIREMAN SWITCH"}

def get(p):
    r=urllib.request.Request(f"{URL}/rest/v1/{p}",headers={"apikey":KEY,"Authorization":f"Bearer {KEY}"})
    with urllib.request.urlopen(r) as x: return json.load(x)
def get_all(table,select,extra=""):
    out,off=[],0
    while True:
        c=get(f"{table}?select={select}&{extra}&order=id&limit=1000&offset={off}"); out+=c
        if len(c)<1000: break
        off+=1000
    return out
def batched(ids,fn,n=150):
    out=[]
    for i in range(0,len(ids),n): out+=fn(ids[i:i+n])
    return out

# ---- shortfall (same calc as getMrpData) ----
jobs=get_all("jobs","id,requirement_stage",f"status=eq.in_production&requirement_dispatch_date=lte.{CUTOFF}")
stage={j["id"]:(j.get("requirement_stage") or "full_material") for j in jobs}
h2j={}
for h in batched(list(stage),lambda b:get(f"job_bom_headers?select=id,job_id&job_id=in.({','.join(b)})")): h2j[h["id"]]=h["job_id"]
lines=[]
for i in range(0,len(h2j),150):
    b=list(h2j)[i:i+150]
    lines+=get_all("job_bom_lines","id,item_id,required_quantity,job_bom_id,category",
        f"job_bom_id=in.({','.join(b)})&item_id=not.is.null&required_quantity=gt.0")
disp=defaultdict(float)
for d in get_all("job_dispatch_lines","job_bom_line_id,qty","job_bom_line_id=not.is.null"): disp[d["job_bom_line_id"]]+=float(d.get("qty") or 0)
required=defaultdict(float)
for l in lines:
    st=stage.get(h2j.get(l["job_bom_id"]))
    if not st or st=="new": continue
    if st=="first_phase" and l.get("category") not in FIRST_PHASE: continue
    net=max(0.0,float(l["required_quantity"] or 0)-disp.get(l["id"],0))
    if net>0: required[l["item_id"]]+=net

# ---- parts lists (neutral -> child_item_id; inherit/pinned fall back to child_item_id) ----
parts_of=defaultdict(list)
for b in get_all("item_bom_lines","parent_item_id,child_item_id,qty"):
    if b["child_item_id"]: parts_of[b["parent_item_id"]].append((b["child_item_id"],float(b["qty"] or 1)))

# ---- involved items = shortfall finished + all parts-list descendants ----
involved=set(required); stack=list(required)
while stack:
    it=stack.pop()
    for (c,_) in parts_of.get(it,[]):
        if c not in involved: involved.add(c); stack.append(c)
inv=list(involved)
items={it["id"]:it for it in batched(inv,lambda b:get(f"items?select=id,code,name,category_id,procurement_type,stock_behaviour&id=in.({','.join(b)})"))}
cats={c["id"]:c for c in get_all("item_categories","id,name,procurement_type")}
stock=defaultdict(float)
for v in batched(inv,lambda b:get(f"inventory?select=item_id,quantity&item_id=in.({','.join(b)})")): stock[v["item_id"]]+=float(v.get("quantity") or 0)

def eff(it):
    o=items.get(it,{}); c=cats.get(o.get("category_id")) or {}
    return o.get("procurement_type") or c.get("procurement_type")
def catname(it):
    o=items.get(it,{}); return (cats.get(o.get("category_id")) or {}).get("name") or "(none)"
def is_make_leaf(it):  # leaf that must be produced by a program (not bought)
    return eff(it)!="trade"   # phantom/make/unknown -> make; trade -> buy

# ---- producers (component + cut_part) for involved items ----
aud=defaultdict(dict); pend=defaultdict(dict)
ops={o["id"]:o for o in get_all("operations","id,name,code,machine,audited_at","is_active=eq.true")}
for o in get_all("operation_outputs","operation_id,item_id,qty_per_run,role","item_id=not.is.null&qty_per_run=gt.0&role=in.(component,cut_part)"):
    if o["item_id"] not in involved: continue
    op=ops.get(o["operation_id"]);
    if not op: continue
    (aud if op["audited_at"] else pend)[o["item_id"]][o["operation_id"]]= \
        (aud if op["audited_at"] else pend)[o["item_id"]].get(o["operation_id"],0)+float(o["qty_per_run"])

# ---- Make shortfall finished items ----
short={it: required[it]-stock.get(it,0) for it in required
       if eff(it)=="make" and required[it]-stock.get(it,0)>0}

# ---- per-finished leaf set (for makeability classification) ----
def leaves_of(f):
    seen=set(); out=set(); st=[f]
    while st:
        it=st.pop()
        if it in seen: continue
        seen.add(it)
        kids=parts_of.get(it,[])
        if kids and it!=f or (kids and it==f):  # assembly -> recurse into parts
            for (c,_) in kids: st.append(c)
        if not kids:                            # leaf
            out.add(it)
    return out

status={}   # f -> ('direct'|'assembly-ok'|'blocked'|'no-make', detail)
for f in short:
    lv=leaves_of(f)
    make_leaves=[l for l in lv if is_make_leaf(l)]
    missing=[l for l in make_leaves if l not in aud]      # make-leaves with no AUDITED producer
    if not make_leaves:
        status[f]=("no-make", [])                          # nothing to cut?? (shouldn't happen)
    elif not missing:
        kind = "direct" if (len(lv)==1 and f in lv) else "assembly-ok"
        status[f]=(kind, make_leaves)
    else:
        status[f]=("blocked", missing)

makeable={f for f in short if status[f][0] in ("direct","assembly-ok")}

# ---- global topo explosion seeded from MAKEABLE finished items -> leaf_produce ----
seed=set(); stk=list(makeable)
while stk:
    it=stk.pop()
    if it in seed: continue
    seed.add(it)
    for (c,_) in parts_of.get(it,[]): stk.append(c)
indeg={it:0 for it in seed}
for it in seed:
    for (c,_) in parts_of.get(it,[]):
        if c in seed: indeg[c]+=1
q=deque([it for it in seed if indeg[it]==0]); topo=[]
while q:
    it=q.popleft(); topo.append(it)
    for (c,_) in parts_of.get(it,[]):
        if c in seed:
            indeg[c]-=1
            if indeg[c]==0: q.append(c)
demand=defaultdict(float)
for f in makeable: demand[f]+=required[f]
leaf_produce=defaultdict(float)
for it in topo:
    prod=max(0.0, demand[it]-stock.get(it,0))
    if prod<=0: continue
    kids=parts_of.get(it,[])
    if kids:
        for (c,cq) in kids: demand[c]+=prod*cq
    else:
        if is_make_leaf(it): leaf_produce[it]+=prod

# ---- least-waste greedy: minimise TOTAL parts produced while covering all needed parts ----
prog_out=defaultdict(dict)                 # audited op -> {needed-part: qty/run}
for part in leaf_produce:
    for op,q in aud.get(part,{}).items(): prog_out[op][part]=q
remaining=dict(leaf_produce); runs=defaultdict(int)
while True:
    best=None; best_key=(-1.0,-1.0)
    for op,outs in prog_out.items():
        u=t=0.0
        for part,q in outs.items():
            t+=q; u+=min(remaining.get(part,0.0),q)
        if u>0 and (u/t,u)>best_key: best_key=(u/t,u); best=op
    if best is None: break
    batch=min(math.ceil(remaining[p]/prog_out[best][p]) for p in prog_out[best] if remaining.get(p,0)>0)
    runs[best]+=batch
    for part,q in prog_out[best].items():
        if remaining.get(part,0)>0: remaining[part]=max(0.0,remaining[part]-q*batch)
selected=dict(runs)
covers={op:[p for p in prog_out[op] if leaf_produce.get(p,0)>0] for op in selected}

# full output bundles of the chosen programs -> the "other parts" (waste) metric
full_out=defaultdict(dict)
if selected:
    for o in get_all("operation_outputs","operation_id,item_id,qty_per_run",
                     "operation_id=in.(%s)&role=in.(component,cut_part)&qty_per_run=gt.0"%",".join(selected)):
        if o["item_id"]:
            full_out[o["operation_id"]][o["item_id"]]=full_out[o["operation_id"]].get(o["item_id"],0)+float(o["qty_per_run"])
total_runs=sum(selected.values())
total_made=sum(selected[op]*sum(full_out[op].values()) for op in selected)
total_needed=sum(leaf_produce.values())

# ---- report ----
direct=[f for f in short if status[f][0]=="direct"]
asm=[f for f in short if status[f][0]=="assembly-ok"]
blocked=[f for f in short if status[f][0]=="blocked"]
print(f"Make shortfall @ {CUTOFF}: {len(short)} items, {round(sum(short.values()))} units")
print(f"  makeable with AUDITED programs: {len(makeable)} (direct {len(direct)} + via-assembly {len(asm)})")
print(f"  still blocked (a part has no audited program): {len(blocked)}")
print(f"\n>>> LEAST-WASTE PLAN: {len(selected)} programs, {total_runs} total runs <<<")
print(f"    parts produced {round(total_made)} | needed {round(total_needed)} | OTHER PARTS (waste) {round(total_made-total_needed)}\n")

print("="*82); print("THE PLAN - run these audited programs (fewest extra parts):"); print("="*82)
for op in sorted(selected,key=lambda o:-selected[o]):
    made=selected[op]*sum(full_out[op].values())
    used=sum(min(leaf_produce.get(p,0),selected[op]*prog_out[op][p]) for p in covers[op])
    print(f"\n[{ops[op]['code']}] {ops[op]['name'][:38]} ({ops[op]['machine']}) RUN x{selected[op]}"
          f"  -> {round(made)} parts, {round(made-used)} extra")
    for p in sorted(covers[op]):
        print(f"     {items[p]['code']:12} {items[p]['name'][:34]:34} need {round(leaf_produce[p])} make {round(selected[op]*prog_out[op][p])} [{catname(p)}]")

print("\n"+"="*82); print("NEWLY makeable via assembly explosion (v1 missed these):"); print("="*82)
for f in sorted(asm,key=lambda f:-short[f]):
    print(f"  {items[f]['code']:12} {items[f]['name'][:42]:42} need {round(short[f])} [{catname(f)}]")

print("\n"+"="*82); print(f"STILL BLOCKED ({len(blocked)}): a required part has no audited program:"); print("="*82)
for f in sorted(blocked,key=lambda f:-short[f]):
    notes=[items[l]["code"]+("=AUDIT "+sorted(ops[o]["code"] for o in pend[l])[0] if l in pend else "=no pgm") for l in status[f][1]]
    print(f"  {items[f]['code']:12} need {round(short[f]):>4} [{catname(f)}] missing: {'; '.join(notes[:4])}")

# ---- CSV ----
prog_for_part={}
for op in selected:
    for p in covers[op]: prog_for_part.setdefault(p,[]).append(f"{ops[op]['code']} x{selected[op]}")
rows=[]
for f in sorted(short,key=lambda f:(catname(f),-short[f])):
    if f in makeable:
        pl=set()
        for l in status[f][1]: pl.update(prog_for_part.get(l,[]))
        rows.append({"category":catname(f),"code":items[f]["code"],"name":items[f]["name"],
            "shortfall":round(short[f]),"status":"MAKEABLE ("+status[f][0]+")","programs":"; ".join(sorted(pl))})
    else:
        miss=[items[l]["code"]+("=>AUDIT "+sorted(ops[o]["code"] for o in pend[l])[0] if l in pend else "=>no program") for l in status[f][1]]
        rows.append({"category":catname(f),"code":items[f]["code"],"name":items[f]["name"],
            "shortfall":round(short[f]),"status":"BLOCKED","programs":"; ".join(miss)})
path=r"C:\Users\yash_\OneDrive\Desktop\Factory-ERP-MRP-Make-Plan-v2.csv"
with open(path,"w",newline="",encoding="utf-8") as fh:
    w=csv.DictWriter(fh,fieldnames=["category","code","name","shortfall","status","programs"]); w.writeheader(); w.writerows(rows)
print(f"\nWrote {path} ({len(rows)} items)")
