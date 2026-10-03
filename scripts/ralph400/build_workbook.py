"""Build the RALPH 400 structure BOM workbook - ONE tab.

Left half  : what you use  - Inputs (yellow), check status, Part List.
Right half : how it works  - Checks, Levels, Faces, Rules (blue = editable rule).

Every number lives in a named cell (Formulas > Name Manager), so formulas read
in words (Span_RIGHT+Cover_135) and one edit on a rule flows everywhere.
Mirrors src/lib/ralph400 (model.ts clean mode + catalog.ts + part-list.ts
order). When a rule changes in model.ts, change it here too and rebuild:

  npx tsx scripts/ralph400/export-catalog.ts > catalog.json
  python scripts/ralph400/build_workbook.py "RALPH 400 BOM - Clean.xlsx" catalog.json

Verified line-for-line and mark-for-mark against buildPartList() (17 jobs:
all CWT sides, 2-6 stops, shallow + deep pits, below-minimum inputs) with the
`formulas` package.
"""
import json
import sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
from openpyxl.utils import get_column_letter as COL

OUT, CAT = sys.argv[1], sys.argv[2]
cat = json.load(open(CAT, encoding="utf-8"))
NAME = {c["code"]: c["name"] for c in cat}

SH = "BOM"
wb = Workbook()
ws = wb.active
ws.title = SH
ws.sheet_view.zoomScale = 90

YELLOW = PatternFill("solid", fgColor="FFF4C2")
BLUE = PatternFill("solid", fgColor="DDEBF7")
GREY = PatternFill("solid", fgColor="F2F2F2")
HEAD = PatternFill("solid", fgColor="1F3864")
BAND = PatternFill("solid", fgColor="D9E1F2")
WHITE_B = Font(bold=True, color="FFFFFF", size=9)
BOLD = Font(bold=True, size=9)
BASE = Font(size=9)
TITLE = Font(bold=True, size=13)
MUTED = Font(color="808080", italic=True, size=9)
thin = Side(style="thin", color="BFBFBF")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top")


def name(n, row, col):
    wb.defined_names[n] = DefinedName(n, attr_text=f"{SH}!${COL(col)}${row}")


def put(row, col, v, font=BASE, fill=None, box=True, align=None):
    c = ws.cell(row=row, column=col, value=v)
    c.font = font
    if fill:
        c.fill = fill
    if box:
        c.border = BOX
    if align:
        c.alignment = align
    return c


def band(row, col, text, ncols):
    for k in range(ncols):
        c = ws.cell(row=row, column=col + k)
        c.fill = HEAD
        c.border = BOX
    ws.cell(row=row, column=col, value=text).font = WHITE_B


def heads(row, col, labels):
    for k, h in enumerate(labels):
        put(row, col + k, h, BOLD, BAND)


# Columns. Left: A part / input label, B code / input value, C face, D level,
# E needed, F qty, G length, H width, I piece mark, J rule.  K = gap.
# Right: L label, M value/result, N..S table cells, T notes.
widths = {"A": 38, "B": 13, "C": 7, "D": 6, "E": 7, "F": 6, "G": 9, "H": 8, "I": 30, "J": 46,
          "K": 2, "L": 30, "M": 10, "N": 9, "O": 9, "P": 9, "Q": 9, "R": 9, "S": 9, "T": 60}
for k, w in widths.items():
    ws.column_dimensions[k].width = w
L = 12  # column L

# ================================================================ title
ws.cell(row=1, column=1, value='="RALPH 400 external structure - part list - job "&In_JobNo').font = TITLE
ws.cell(row=2, column=1, value="Type only the yellow cells. Filter column E (Needed) to YES for this job's list. "
                               "Columns L-T show how every number is worked out; blue cells are the rules.").font = MUTED

# ================================================================ inputs (left top)
band(4, 1, "INPUTS", 4)
inputs = [
    ("In_JobNo", "Job no", "BLR 94", "label only"),
    ("In_Width", "Shaft width EXTERNAL (entrance face)", 1600, "mm"),
    ("In_Depth", "Shaft depth EXTERNAL (front to back)", 1550, "mm"),
    ("In_Pit", "Pit depth", 0, "mm  (0 allowed)"),
    ("In_Overhead", "Overhead (top landing to shaft top)", 2860, "mm"),
    ("In_Stops", "Number of landings (stops)", 4, "2 to 6"),
    ("In_Rise1", "Floor height: ground to 1st", 3720, "mm  FFL to FFL"),
    ("In_Rise2", "Floor height: 1st to 2nd", 3295, "mm  0 = no floor"),
    ("In_Rise3", "Floor height: 2nd to 3rd", 3365, "mm"),
    ("In_Rise4", "Floor height: 3rd to 4th", 0, "mm"),
    ("In_Rise5", "Floor height: 4th to 5th", 0, "mm"),
    ("In_CWT", "Counterweight side (seen from landing)", "LEFT", "BACK / LEFT / RIGHT"),
    ("In_DoorType", "Door type", "AT", "label only"),
    ("In_DoorOpening", "Door opening", "AT 700 R", "label on D-locking post"),
]
IN_ROW = {}
for i, (n, label, val, note) in enumerate(inputs, 5):
    put(i, 1, label)
    put(i, 2, val, BOLD, YELLOW)
    c = ws.cell(row=i, column=3, value=note)
    c.font = MUTED
    name(n, i, 2)
    IN_ROW[n] = i
for n, lst in [("In_CWT", '"BACK,LEFT,RIGHT"'), ("In_DoorType", '"AT,ACO,SWING,MCD"'), ("In_Stops", '"2,3,4,5,6"')]:
    dv = DataValidation(type="list", formula1=lst, allow_blank=False)
    ws.add_data_validation(dv)
    dv.add(f"B{IN_ROW[n]}")
STATUS_ROW = 5 + len(inputs) + 1  # 20

# ================================================================ right panel
r = 4
# ---------------- checks (filled after levels exist; rows reserved here)
CHECK_BAND = r
checks = [
    ("Width and depth filled", "AND(In_Width>Face_Deduct,In_Depth>Face_Deduct)", "Enter the external width and depth."),
    ("Stops 2 to 6", "AND(In_Stops>=2,In_Stops<=6,In_Stops=INT(In_Stops))", "Five floor heights, so at most 6 stops."),
    ("Counterweight BACK / LEFT / RIGHT", 'OR(In_CWT="BACK",In_CWT="LEFT",In_CWT="RIGHT")',
     "Pick from the list. Hydraulic (no counterweight): pick the rail side."),
    ("Pit depth 0 or more", "In_Pit>=0", "0 is allowed."),
    ("Overhead above minimum", "In_Overhead>Min_Overhead", "Below Min_Overhead the overhead cladding has no height."),
]
LV = ["GND", "1ST", "2ND", "3RD", "4TH"]
for k, lv in enumerate(LV, 1):
    checks.append((f"Floor height {k} ({'ground' if k == 1 else LV[k - 2].lower()} to {LV[k - 1].lower() if k > 1 else '1st'})",
                   f"AND(OR(In_Stops<{k + 1},AND(In_Rise{k}>0,In_Rise{k}>=MinRise_{lv})),OR(In_Stops>={k + 1},In_Rise{k}=0))",
                   f"Needed for {k + 1}+ stops and at least the minimum on the Levels table; leave 0 when not used."))
checks.append(("Door opening from the list", 'OR(In_DoorOpening="",COUNTIF(List_DoorOpening,In_DoorOpening)>0)',
               "Pick from the list (it only labels the D-locking post)."))
band(r, L, "CHECKS", 9)
heads(r + 1, L, ["Check", "Result"])
put(r + 1, L + 2, "What to do", BOLD, BAND)
first_check = r + 2
for i, (what, f, todo) in enumerate(checks, first_check):
    put(i, L, what)
    put(i, L + 1, f'=IF({f},"OK","CHECK")', BOLD, GREY)
    ws.cell(row=i, column=L + 2, value=todo).font = MUTED
last_check = first_check + len(checks) - 1
for rng in [f"M{first_check}:M{last_check}"]:
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'M{first_check}="CHECK"'],
                                                   fill=PatternFill("solid", fgColor="F8CBAD"), font=Font(bold=True, color="9C0006")))
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'M{first_check}="OK"'], fill=PatternFill("solid", fgColor="C6EFCE")))
r = last_check + 2

# ---------------- levels
band(r, L, "LEVELS  (per floor)", 9)
heads(r + 1, L, ["Level", "Floor ht", "Min ht", "Built?", "Extension", "Glass ht", "Clad ht"])
put(r + 1, L + 8, "How the extension is worked out", BOLD, BAND)
levels = [
    ("PIT", None, None, None, "=IF(In_Pit>=Shallow_Pit,In_Pit-Pit_Stub_Deduct,Pit_Stub_Min)",
     "Pit piece: pit - 95.5, or 74.5 when the pit is under 170."),
    ("GND", "In_Rise1", 2, "=Module+Clad_Deduct+Base_Drop+Ext_PIT-In_Pit",
     "=IF(Built_GND,In_Rise1+In_Pit-Base_Drop-Ext_PIT-Module,0)",
     "Floor ht + pit - 67.5 - pit piece - 2450 (posts run from the pit floor)."),
    ("1ST", "In_Rise2", 3, "=Min_Rise", "=IF(Built_1ST,In_Rise2-Module,0)", "Floor ht - 2450."),
    ("2ND", "In_Rise3", 4, "=Min_Rise", "=IF(Built_2ND,In_Rise3-Module,0)", "Floor ht - 2450."),
    ("3RD", "In_Rise4", 5, "=Min_Rise", "=IF(Built_3RD,In_Rise4-Module,0)", "Floor ht - 2450."),
    ("4TH", "In_Rise5", 6, "=Min_Rise", "=IF(Built_4TH,In_Rise5-Module,0)", "Floor ht - 2450."),
    ("OH", None, None, None, "=In_Overhead+Base_Drop-Module-Top_Gap", "Overhead + 67.5 - 2450 - 30. Overhead cladding = this - 202.5."),
]
for i, (lv, rise, stops, mn, ext, how) in enumerate(levels, r + 2):
    put(i, L, lv, BOLD)
    for c in range(L + 1, L + 7):
        put(i, c, None, BASE, GREY)
    if rise:
        put(i, L + 1, f"={rise}", BASE, GREY)
        put(i, L + 2, mn, BASE, GREY)
        name(f"MinRise_{lv}", i, L + 2)
        put(i, L + 3, f"=AND(In_Stops>={stops},{rise}>=MinRise_{lv})", BASE, GREY)
        put(i, L + 5, f"=IF(Built_{lv},Ext_{lv}-Glass_Deduct,0)", BASE, GREY)
        put(i, L + 6, f"=IF(Built_{lv},Ext_{lv}-Clad_Deduct,0)", BASE, GREY)
        name(f"GlassH_{lv}", i, L + 5)
        name(f"CladH_{lv}", i, L + 6)
    else:
        put(i, L + 3, True, BASE, GREY)
        if lv == "OH":
            put(i, L + 6, "=Ext_OH-OH_Clad_Deduct", BASE, GREY)
            name("CladH_OH", i, L + 6)
    name(f"Built_{lv}", i, L + 3)
    put(i, L + 4, ext, BOLD, GREY)
    name(f"Ext_{lv}", i, L + 4)
    ws.cell(row=i, column=L + 8, value=how).font = MUTED
r = r + 2 + len(levels) + 1

# ---------------- faces
band(r, L, "FACES  (F door, B back, L left, R right)", 9)
heads(r + 1, L, ["Face", "Span", "CWT face?", "Glass?", "Cladding?"])
put(r + 1, L + 8, "Why", BOLD, BAND)
faces = [
    ("LEFT", "=In_Depth-Face_Deduct", '=In_CWT="LEFT"', '=In_CWT<>"LEFT"', '=In_CWT="LEFT"', "Spans the depth. Glass unless the counterweight is here."),
    ("RIGHT", "=In_Depth-Face_Deduct", '=In_CWT="RIGHT"', '=In_CWT<>"RIGHT"', '=In_CWT="RIGHT"', "Spans the depth. Glass unless the counterweight is here."),
    ("BACK", "=In_Width-Face_Deduct", '=In_CWT="BACK"', '=In_CWT<>"BACK"', '=In_CWT="BACK"', "Spans the width. Glass unless the counterweight is here."),
    ("FRONT", "=In_Width-Face_Deduct", "=FALSE", "=FALSE", '=In_CWT="BACK"', "Door face: no glass; clad in the extensions only when the counterweight is at the BACK."),
]
for i, (f, span, cw, gl, cl, why) in enumerate(faces, r + 2):
    put(i, L, f, BOLD)
    for k, (v, nm) in enumerate([(span, "Span"), (cw, "IsCWT"), (gl, "Glass"), (cl, "Clad")], 1):
        put(i, L + k, v, BASE, GREY)
        name(f"{nm}_{f}", i, L + k)
    ws.cell(row=i, column=L + 8, value=why).font = MUTED
i = r + 2 + len(faces)
put(i, L, "Counterweight face span", BOLD)
put(i, L + 1, '=IF(In_CWT="BACK",Span_BACK,Span_LEFT)', BASE, GREY)
name("Span_CWT", i, L + 1)
r = i + 2

# ---------------- rules
band(r, L, "RULES  (blue = edit with care; every formula uses these names)", 9)
heads(r + 1, L, ["Name", "Value"])
put(r + 1, L + 2, "What it means", BOLD, BAND)
rules = [
    ("Geometry", None, None),
    ("Module", 2450, "Fixed console module height at every landing (posts D100-D103)."),
    ("Base_Drop", 67.5, "Module base sits 67.5 below each landing (half a 135 channel)."),
    ("Pit_Stub_Deduct", 95.5, "Pit piece = pit - 95.5 (67.5 + 28) on a deep pit."),
    ("Pit_Stub_Min", 74.5, "Pit piece length when the pit is shallower than Shallow_Pit."),
    ("Shallow_Pit", 170, "Pit depth below which the pit piece is fixed."),
    ("Top_Gap", 30, "Corner posts stop 30 below the shaft top."),
    ("Face_Deduct", 200, "Face span = external size - two 100 mm corner posts."),
    ("Glass", None, None),
    ("Glass_Allow", 35, "Glass width = span + 35 (20.5 + 20.5 rebate - 6)."),
    ("Glass_Deduct", 97, "Extension glass height = extension - 97 (45.5 + 45.5 + 6)."),
    ("Glass_Panel", 1128, "Module glass height (1090 + 22 + 22 - 6). 2 per face per landing, less the lowest."),
    ("Glass_Lowest", 1098, "Lowest module glass, 1 per glass face per job."),
    ("Cladding", None, None),
    ("Clad_Deduct", 142, "Extension cladding height = extension - 142 (67.5 + 74.5)."),
    ("OH_Clad_Deduct", 202.5, "Overhead cladding height = overhead extension - (67.5 + 135)."),
    ("Clad_Panel", 1090, "Module sheet height (2450/2 - 135). 2 per face per landing, less the lowest."),
    ("Clad_Lowest", 1062, "Lowest module sheet (2450/2 - 163), 1 per clad face per job."),
    ("Channels, covers, plates", None, None),
    ("Cover_170", 9, "170 cover = channel + 9 (4.5 + 4.5)."),
    ("Cover_135", 38, "135 cover (incl. overhead ring) = channel + 38 (19 + 19)."),
    ("Ch135_Per_Stop", 3, "135 channels per face = 3 x stops - 1."),
    ("Plate122_Per_Job", 2, "Plate 122: fixed per job."),
    ("Plate124_Per_Bracket", 2, "Plate 124: 2 per 135 bracket channel (= 6 x stops - 2)."),
    ("JointHex_Per_Stop", 12, "Joint plate hex per landing."),
    ("JointHole_Per_Stop", 8, "Joint plate hole per landing."),
    ("M8 bolts per part (1 rivnut each)", None, None),
    ("M8_Ch170", 6, "Per 170 channel."),
    ("M8_Ch135", 4, "Per 135 / top / overhead-ring channel."),
    ("M8_Lintel", 4, "Per lintel panel."),
    ("M8_Post_Per_Stop", 16, "Corner-post joints: 4 per corner per landing."),
    ("M8_Post_Top", 8, "Corner-post top: 2 per corner, once per job."),
    ("M5 screws per part (1 rivnut each)", None, None),
    ("M5_Sill_Ground", 5, "Sill at the ground landing."),
    ("M5_Sill", 7, "Sill at every other landing."),
    ("M5_Cover", 8, "Per channel cover."),
    ("M5_Ch170", 12, "Per 170 channel (6 + 6)."),
    ("M5_Ch135", 12, "Per 135 / top / overhead-ring channel (6 + 6)."),
    ("M5_DeadWeight", 4, "Per dead weight channel."),
    ("M5_DoorPost_DLock", 8, "Per D-locking door post."),
    ("M5_DoorPost_Clad", 8, "Per door post cladding."),
    ("M5_Lintel", 13, "Per lintel panel."),
    ("Limits (calculated)", None, None),
    ("Min_Rise", "=Module+Clad_Deduct", "Smallest floor height above ground."),
    ("Min_Overhead", "=Module+Top_Gap-Base_Drop+OH_Clad_Deduct", "Overhead must be MORE than this."),
]
i = r + 2
for n, v, note in rules:
    if v is None:
        for k in range(3):
            ws.cell(row=i, column=L + k).fill = BAND
        ws.cell(row=i, column=L, value=n).font = BOLD
    else:
        put(i, L, n)
        put(i, L + 1, v, BOLD, GREY if isinstance(v, str) else BLUE)
        ws.cell(row=i, column=L + 2, value=note).font = MUTED
        name(n, i, L + 1)
    i += 1
r = i + 1

# ---------------- door options + code key
band(r, L, "DOOR OPENING OPTIONS", 2)
openings = ["AT 600 R", "AT 700 R", "AT 800 R", "AT 600 L", "AT 700 L", "AT 800 L",
            "600 CO", "700 CO", "800 CO", "600L SW", "700L SW", "800L SW"]
for k, o in enumerate(openings, r + 1):
    put(k, L, o)
wb.defined_names["List_DoorOpening"] = DefinedName(
    "List_DoorOpening", attr_text=f"{SH}!$L${r + 1}:$L${r + len(openings)}")
dv = DataValidation(type="list", formula1="=List_DoorOpening", allow_blank=True)
ws.add_data_validation(dv)
dv.add(f"B{IN_ROW['In_DoorOpening']}")
r = r + len(openings) + 2
band(r, L, "CODE KEY", 9)
for k, t in enumerate([
    "CODE = what the part IS (profile, thickness, hand). Same code only if two pieces can be swapped.",
    "R4-<PART>[-<thickness>][B]: 15 = 1.5 mm, 30 = 3 mm, 12 = 1.2 mm, 6 = 6 mm; B = bracket version (counterweight face).",
    "Corner parts end FL / FR / BL / BR; door parts R / L.",
    "PIECE MARK = code · face-level · size, e.g. R4-C135-15 · B · 1400.  Levels: PIT, GND-4TH, OH, MOD (2450 module).",
], r + 1):
    ws.cell(row=k, column=L, value=t).font = MUTED

# ================================================================ part list (left)
CORNERS = [("FL", "D100-0001"), ("FR", "D101-0001"), ("BL", "D102-0001"), ("BR", "D103-0001")]
SIDE = ["LEFT", "RIGHT", "BACK"]
sections = []  # (title, [rows])


def section(title):
    sections.append((title, []))


def add(*row):
    sections[-1][1].append(row)


def fixed(code):
    return f'"{code}"', NAME[code]


def cwt_pick(face, bracket, plain):
    return (f'IF(IsCWT_{face},"{bracket}","{plain}")',
            f'=IF(IsCWT_{face},"{NAME[bracket]}","{NAME[plain]}")')


# Row tuple: code_formula, part, face, level, needed, qty, length, width, rule
section("Corner verticals")
for lv in ["PIT"] + LV + ["OH"]:
    for cn, _ in CORNERS:
        add(*fixed(f"R4-PSX-{cn}"), "", lv, f"AND(Built_{lv},Ext_{lv}>0)", "1", f"Ext_{lv}", None,
            "One per corner per floor; length from LEVELS.")

section("2450 console modules")
for cn, dwg in CORNERS:
    add(*fixed(f"R4-PST-{cn}"), "", "", "TRUE", "In_Stops", "Module", None, f"One per landing. Drawing {dwg}.")
for f in SIDE:
    add(*fixed("R4-GL-6"), f, "MOD", f"Glass_{f}", "1", "Glass_Lowest", f"Span_{f}+Glass_Allow", "Lowest module glass, 1 per glass face.")
for f in SIDE:
    add(*fixed("R4-GL-6"), f, "MOD", f"Glass_{f}", "2*In_Stops-1", "Glass_Panel", f"Span_{f}+Glass_Allow", "2 per landing per glass face, less the lowest.")
for f in SIDE:
    add(*fixed("R4-SH-12"), f, "MOD", f"Clad_{f}", "1", "Clad_Lowest", f"Span_{f}", "Lowest module sheet, counterweight face.")
for f in SIDE:
    add(*fixed("R4-SH-12"), f, "MOD", f"Clad_{f}", "2*In_Stops-1", "Clad_Panel", f"Span_{f}", "2 per landing on the counterweight face, less the lowest.")

section("Glass panels 6 mm (extensions)")
for lv in LV:
    for f in SIDE:
        add(*fixed("R4-GL-6"), f, lv, f"AND(Glass_{f},Built_{lv},GlassH_{lv}>0)", "1", f"GlassH_{lv}", f"Span_{f}+Glass_Allow",
            "Extension - 97 tall, span + 35 wide.")

section("Sheet cladding 1.2 mm (extensions + overhead)")
for lv in LV:
    for f in SIDE + ["FRONT"]:
        add(*fixed("R4-SH-12"), f, lv, f"AND(Clad_{f},Built_{lv},CladH_{lv}>0)", "1", f"CladH_{lv}", f"Span_{f}",
            "Extension - 142 tall, span wide.")
for f in SIDE + ["FRONT"]:
    add(*fixed("R4-SH-12"), f, "OH", "CladH_OH>0", "1", "CladH_OH", f"Span_{f}", "All four faces: overhead extension - 202.5.")

section("Horizontal channels & covers")
for f in SIDE:
    add(*cwt_pick(f, "R4-C170-30B", "R4-C170-15"), f, "", "TRUE", "1", f"Span_{f}", None, "Bottom ring; bracket version on the counterweight face.")
for f in SIDE:
    add(*fixed("R4-V170-12"), f, "", f"NOT(IsCWT_{f})", "1", f"Span_{f}+Cover_170", None, "Channel + 9; none on the counterweight face.")
add(*fixed("R4-C142"), "", "", "TRUE", "In_Stops", "Span_FRONT", None, "One per landing, across the door face.")
for f in SIDE:
    add(*fixed("R4-C135-15"), f, "", f"NOT(IsCWT_{f})", "Ch135_Per_Stop*In_Stops-1", f"Span_{f}", None, "3 x stops - 1 per glass face.")
for f in SIDE:
    add(*fixed("R4-V135-12"), f, "", f"NOT(IsCWT_{f})", "Ch135_Per_Stop*In_Stops-1", f"Span_{f}+Cover_135", None, "Channel + 38, one per 135 channel.")
add(*fixed("R4-C135-30B"), "=In_CWT", "", 'OR(In_CWT="LEFT",In_CWT="RIGHT",In_CWT="BACK")',
    "Ch135_Per_Stop*In_Stops-1", "Span_CWT", None, "Counterweight face, where the rail brackets fix.")
for f in SIDE + ["FRONT"]:
    add(*cwt_pick(f, "R4-CTP-30B", "R4-CTP-30"), f, "", "TRUE", "1", f"Span_{f}", None, "Top frame, one per face.")

section("Overhead ring")
for f in SIDE + ["FRONT"]:
    add(*cwt_pick(f, "R4-CRG-30B", "R4-CRG-15"), f, "", "TRUE", "1", f"Span_{f}", None, "One per face, closing the overhead.")
for f in SIDE:
    add(*fixed("R4-VRG-12"), f, "", f"NOT(IsCWT_{f})", "1", f"Span_{f}+Cover_135", None, "Channel + 38; none on the counterweight face or front.")

section("Doors, plates & fasteners")
for code in ["R4-DLP-R", "R4-DPC-R", "R4-LNT-R", "R4-DLP-L", "R4-DPC-L", "R4-LNT-L"]:
    c, part = fixed(code)
    if code == "R4-DLP-R":
        part = f'="{NAME[code]} · opening "&In_DoorOpening'
    add(c, part, "", "", "TRUE", "In_Stops", None, None, "One per landing; both hands (a jamb each side).")
add(*fixed("R4-CHD"), "", "", "TRUE", "In_Stops", None, None, "One per landing.")
add(*fixed("R4-P122"), "", "", "TRUE", "Plate122_Per_Job", None, None, "Fixed per job.")
add(*fixed("R4-P124"), "", "", "TRUE", "Plate124_Per_Bracket*(Ch135_Per_Stop*In_Stops-1)", None, None, "2 per 135 bracket channel.")
add(*fixed("R4-PJX"), "", "", "TRUE", "JointHex_Per_Stop*In_Stops", None, None, "Per landing.")
add(*fixed("R4-PJH"), "", "", "TRUE", "JointHole_Per_Stop*In_Stops", None, None, "Per landing.")
add(*fixed("R4-CDW"), "", "", "TRUE", "In_Stops", None, None, "One per landing.")
FAST_AT = len(sections[-1][1])  # fasteners follow; their counts read the rows above

QTY, CODE = "PL_Qty", "PL_Code"


def cnt(p):
    return f'SUMIFS({QTY},{CODE},"{p}")'


CH135 = f"({cnt('R4-C135*')}+{cnt('R4-CTP*')}+{cnt('R4-CRG*')})"
m8 = (f"M8_Ch170*{cnt('R4-C170*')}+M8_Ch135*{CH135}+M8_Lintel*{cnt('R4-LNT*')}"
      f"+M8_Post_Per_Stop*In_Stops+M8_Post_Top")
m5 = (f"M5_Sill_Ground+M5_Sill*(In_Stops-1)+M5_Cover*{cnt('R4-V*')}+M5_Ch170*{cnt('R4-C170*')}"
      f"+M5_Ch135*{CH135}+M5_DeadWeight*{cnt('R4-CDW')}+M5_DoorPost_DLock*{cnt('R4-DLP*')}"
      f"+M5_DoorPost_Clad*{cnt('R4-DPC*')}+M5_Lintel*{cnt('R4-LNT*')}")
add(*fixed("R4-RN8"), "", "", "TRUE", "Total_M8", None, None, "One per M8 bolt.")
add(*fixed("R4-RN5"), "", "", "TRUE", "Total_M5", None, None, "One per M5 screw.")
add(*fixed("R4-B830"), "", "", "TRUE", m8, None, None, "Counted from the parts above (M8 rules).")
add(*fixed("R4-S520"), "", "", "TRUE", m5, None, None, "Counted from the parts above (M5 rules).")

# status line (left, between inputs and part list)
put(STATUS_ROW, 1, "Checks (details in column L)", BOLD)
st = put(STATUS_ROW, 2, f'=IF(COUNTIF(M{first_check}:M{last_check},"CHECK")=0,"ALL OK","FIX INPUTS")', BOLD, GREY)
ws.conditional_formatting.add(f"B{STATUS_ROW}", FormulaRule(formula=[f'B{STATUS_ROW}="FIX INPUTS"'],
                                                            fill=PatternFill("solid", fgColor="F8CBAD"), font=Font(bold=True, color="9C0006")))
ws.conditional_formatting.add(f"B{STATUS_ROW}", FormulaRule(formula=[f'B{STATUS_ROW}="ALL OK"'], fill=PatternFill("solid", fgColor="C6EFCE")))

HR = STATUS_ROW + 2
band(HR - 1, 1, "PART LIST", 10)
heads(HR, 1, ["Part", "Code", "Face", "Level", "Needed", "Qty", "Length / ht", "Width", "Piece mark", "Rule"])
row = HR + 1
first_data = row
fast_first = None
for title, rws in sections:
    brow = row
    row += 1
    for k, (code, part, face, lv, need, qty, ln, wd, rule) in enumerate(rws):
        i = row
        if title.startswith("Doors") and k == FAST_AT:
            fast_first = i
        pos = f'IF(C{i}&""="",D{i}&"",IF(D{i}&""="",LEFT(C{i},1),LEFT(C{i},1)&"-"&D{i}))'
        size = f'IF(G{i}="","",IF(H{i}="",G{i}&"",G{i}&" × "&H{i}))'
        vals = [part, f"={code}", face, lv,
                f'=IF({need},"YES","no")',
                f'=IF(E{i}="YES",{qty},0)',
                f'=IF(E{i}="YES",{ln},"")' if ln else "",
                f'=IF(E{i}="YES",{wd},"")' if wd else "",
                f'=IF(E{i}="YES",B{i}&IF({pos}="",""," · "&{pos})&IF({size}="",""," · "&{size}),"")',
                rule]
        for col, v in enumerate(vals, 1):
            c = put(i, col, v, BOLD if col == 6 else BASE, GREY if 2 <= col <= 9 else None)
        if code == '"R4-B830"':
            name("Total_M8", i, 6)
        if code == '"R4-S520"':
            name("Total_M5", i, 6)
        row += 1
    # Section band: Needed = YES while any line in it is needed, so a YES filter keeps it.
    for col in range(1, 11):
        ws.cell(row=brow, column=col).fill = BAND
        ws.cell(row=brow, column=col).border = BOX
    ws.cell(row=brow, column=1, value=title).font = BOLD
    c = ws.cell(row=brow, column=5, value=f'=IF(COUNTIF(E{brow + 1}:E{row - 1},"YES")>0,"YES","no")')
    c.font = Font(size=9, color="8EA9DB")
last_data = row - 1
# Fastener counts read only the rows above them (no circular reference).
wb.defined_names[QTY] = DefinedName(QTY, attr_text=f"{SH}!$F${first_data}:$F${fast_first - 1}")
wb.defined_names[CODE] = DefinedName(CODE, attr_text=f"{SH}!$B${first_data}:$B${fast_first - 1}")
ws.auto_filter.ref = f"A{HR}:J{last_data}"
ws.conditional_formatting.add(f"A{first_data}:J{last_data}",
                              FormulaRule(formula=[f'AND($E{first_data}="no",$B{first_data}<>"")'], font=Font(size=9, color="BFBFBF")))
put(row + 1, 1, "Total pieces (needed lines)", BOLD, box=False)
put(row + 1, 6, f"=SUM(F{first_data}:F{last_data})", BOLD, box=False)
ws.freeze_panes = "A5"

wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
print("part rows", sum(len(s[1]) for s in sections), "| data rows", first_data, "-", last_data, "->", OUT)
