import openpyxl, json, re
from collections import Counter, defaultdict

PATH = r"C:\Users\yash_\OneDrive\Desktop\CNC Standard Programs.xlsx"
wb = openpyxl.load_workbook(PATH, data_only=False)
ws = wb["Std Program"]

def colorid(cell):
    f = cell.fill
    if not f or f.patternType != 'solid':
        return None
    fg = f.fgColor
    t = getattr(fg, 'type', None)
    if t == 'rgb' and fg.rgb and fg.rgb not in ('00000000', 'FFFFFFFF'):
        return fg.rgb
    if t == 'theme':
        return f"T{fg.theme}"
    if t == 'indexed' and fg.indexed not in (64, 65):
        return f"I{fg.indexed}"
    return None

def val(c):
    return None if c.value is None else str(c.value).strip()

programs = []
sections = []
cur = None
for row in ws.iter_rows(min_row=2):
    A = row[0]  # col A
    a = val(A)
    # columns by index: A0 B1 C2 D3 E4 F5 G6 H7 I8 J9
    B,C,D,E,F,G,H,I_,J = (val(row[i]) if i < len(row) else None for i in range(1,10))
    if a:
        acol = colorid(A)
        has_data = any([B,C,D,E,G,H,I_])
        if not has_data and acol == 'FFFF9900':
            sections.append((a, acol))
            cur = None
            # but a section row could still... skip
        else:
            cur = {"name": a, "color": acol,
                   "is_laser": bool(re.search(r'\bLC\b|LC ', a.upper())) or 'LC' in a.upper().split()[0] if a else False,
                   "mat": G, "thk": H, "sheet": I_, "unit_first": F,
                   "outputs": []}
            programs.append(cur)
            # first output on the program row itself
            pname = D or ((B or "") + (" " + C if C else "")).strip() or C
            if pname:
                cur["outputs"].append({"part": pname.strip(), "qty": E, "unit": F})
            continue
    # continuation row (output)
    if cur is not None:
        pname = D or ((B or "") + (" " + C if C else "")).strip() or C
        if pname:
            cur["outputs"].append({"part": pname.strip(), "qty": E, "unit": F})
        # capture sheet if program row lacked it
        if not cur["sheet"] and I_:
            cur["sheet"] = I_
        if not cur["thk"] and H:
            cur["thk"] = H
        if not cur["mat"] and G:
            cur["mat"] = G

# laser detection refine: token 'LC' present
for p in programs:
    toks = re.split(r'[^A-Za-z0-9]', p["name"].upper())
    p["is_laser"] = 'LC' in toks

colors = Counter(p["color"] for p in programs)
laser = sum(1 for p in programs if p["is_laser"])
thks = Counter(p["thk"] for p in programs)
sheets = Counter(p["sheet"] for p in programs)
mats = Counter(p["mat"] for p in programs)
all_parts = [o["part"] for p in programs for o in p["outputs"]]
distinct_parts = sorted(set(all_parts))

print(f"PROGRAMS: {len(programs)}")
print(f"SECTIONS (orange headers): {len(sections)} -> {[s[0] for s in sections][:30]}")
print(f"LASER (LC token) programs: {laser}")
print(f"COLOR distribution: {dict(colors)}")
print(f"  color -> sample names:")
seen = defaultdict(list)
for p in programs:
    if len(seen[p['color']]) < 4:
        seen[p['color']].append(p['name'])
for col, names in seen.items():
    print(f"    {col}: {names}")
print(f"MATERIALS: {dict(mats)}")
print(f"THICKNESS: {dict(thks)}")
print(f"SHEET SIZES: {dict(sheets)}")
print(f"TOTAL output rows: {len(all_parts)}  DISTINCT part names: {len(distinct_parts)}")

with open(r"C:\Users\yash_\AppData\Local\Temp\std_programs.json", "w", encoding="utf-8") as f:
    json.dump(programs, f, ensure_ascii=False, indent=1)
with open(r"C:\Users\yash_\AppData\Local\Temp\std_distinct_parts.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(distinct_parts))
print("WROTE std_programs.json and std_distinct_parts.txt")
