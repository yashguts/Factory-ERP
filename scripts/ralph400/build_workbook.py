"""Build the RALPH 400 structure BOM workbook - one tab, read top to bottom,
no named ranges: every formula uses plain cell references, and the part
list spells each formula out in words with the real numbers beside it.

  1 Inputs        yellow cells, the only ones you type in
  2 Checks        OK / CHECK per input rule, formula shown
  3 Part list     qty / length / width with their formulas shown (FORMULATEXT)
  4 Rules         every fixed number, named, with its meaning (blue = editable)
  5 Calculations  every derived number (extensions, spans, which face gets what)

Built with names for readability of THIS script, then every name is swapped for
its cell address (no named ranges left in the file).
Mirrors src/lib/ralph400 (model.ts clean mode + catalog.ts + part-list.ts order).
When a rule changes in model.ts, change it here too and rebuild:

  npx tsx scripts/ralph400/export-catalog.ts > catalog.json
  python scripts/ralph400/build_workbook.py "RALPH 400 BOM - Clean.xlsx" catalog.json

Verified line-for-line and mark-for-mark against buildPartList() (17 jobs) with
the `formulas` package (run with --no-formulatext: that package cannot evaluate
nothing - the words columns are plain text and change no value).
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
SHOW_FORMULAS = "--no-formulatext" not in sys.argv
NAME = {c["code"]: c["name"] for c in json.load(open(CAT, encoding="utf-8"))}

SH = "BOM"
wb = Workbook()
ws = wb.active
ws.title = SH

YELLOW = PatternFill("solid", fgColor="FFF4C2")
BLUE = PatternFill("solid", fgColor="DDEBF7")
GREY = PatternFill("solid", fgColor="F2F2F2")
HEAD = PatternFill("solid", fgColor="1F3864")
BAND = PatternFill("solid", fgColor="D9E1F2")
F = lambda **k: Font(size=10, **k)
WHITE_B, BOLD, BASE = F(bold=True, color="FFFFFF"), F(bold=True), F()
CODEF = Font(name="Consolas", size=9, color="375623")
TITLE = Font(bold=True, size=14)
MUTED = F(color="7F7F7F", italic=True)
thin = Side(style="thin", color="BFBFBF")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)

# A part/name · B code/value · C face/formula(spills) · D level · E needed · F qty
# G length · H width · I qty formula / meaning · J length formula · K width formula · L piece mark
for col, w in zip("ABCDEFGHIJKLM", [40, 13, 8, 7, 8, 7, 9, 8, 26, 24, 22, 20, 30]):
    ws.column_dimensions[col].width = w


def name(n, row, col=2):
    wb.defined_names[n] = DefinedName(n, attr_text=f"{SH}!${COL(col)}${row}")


def put(row, col, v, font=BASE, fill=None, box=True):
    c = ws.cell(row=row, column=col, value=v)
    c.font = font
    if fill:
        c.fill = fill
    if box:
        c.border = BOX
    return c


def band(row, text, sub=""):
    for col in range(1, 14):
        ws.cell(row=row, column=col).fill = HEAD
    ws.cell(row=row, column=1, value=text).font = WHITE_B
    if sub:
        ws.cell(row=row, column=3, value=sub).font = F(color="D9E1F2", italic=True)


def heads(row, labels):
    for k, h in enumerate(labels, 1):
        if h:
            put(row, k, h, BOLD, BAND)


LABEL = {
    "In_Width": "Width", "In_Depth": "Depth", "In_Pit": "Pit", "In_Overhead": "Overhead", "In_Stops": "Stops",
    "In_Rise1": "H1", "In_Rise2": "H2", "In_Rise3": "H3", "In_Rise4": "H4", "In_Rise5": "H5",
    "In_CWT": "CWT side", "In_DoorOpening": "Door opening", "In_DoorType": "Door type", "In_JobNo": "Job",
    "List_DoorOpening": "the list",
    "Ext_PIT": "Pit piece", "Ext_GND": "Ext GND", "Ext_1ST": "Ext 1ST", "Ext_2ND": "Ext 2ND", "Ext_3RD": "Ext 3RD",
    "Ext_4TH": "Ext 4TH", "Ext_OH": "Ext OH",
    "Built_PIT": "PIT built", "Built_GND": "GND built", "Built_1ST": "1ST built", "Built_2ND": "2ND built",
    "Built_3RD": "3RD built", "Built_4TH": "4TH built", "Built_OH": "OH built",
    "MinRise_GND": "Min H1", "MinRise_1ST": "Min H2", "MinRise_2ND": "Min H3", "MinRise_3RD": "Min H4",
    "MinRise_4TH": "Min H5", "Min_Rise": "Min floor height", "Min_Overhead": "Min overhead",
    "Span_LEFT": "Span L", "Span_RIGHT": "Span R", "Span_BACK": "Span B", "Span_FRONT": "Span F", "Span_CWT": "CWT span",
    "IsCWT_LEFT": "CWT on L", "IsCWT_RIGHT": "CWT on R", "IsCWT_BACK": "CWT on B", "IsCWT_FRONT": "CWT on F",
    "Glass_LEFT": "L is glass", "Glass_RIGHT": "R is glass", "Glass_BACK": "B is glass", "Glass_FRONT": "F is glass",
    "Clad_LEFT": "L is clad", "Clad_RIGHT": "R is clad", "Clad_BACK": "B is clad", "Clad_FRONT": "F is clad",
    "N_Ch170": "no. of 170 ch", "N_Ch135": "no. of 135/top ch", "N_Cover": "no. of covers",
    "N_Lintel": "no. of lintels", "N_DLock": "no. of D-lock posts", "N_PostClad": "no. of post claddings",
    "N_DeadWeight": "no. of dead wt ch", "Count_M8": "M8 count", "Count_M5": "M5 count",
    "PL_Qty": "Qty", "PL_Code": "Code", "Door_Hand": "Door hand", "Span_FRONT_Ext": "Front ext width",
}
SAY = []  # (row, col, expression) -> the formula in words, written at the end


def say(row, col, expr):
    SAY.append((row, col, expr))


ws.cell(row=1, column=1, value='="RALPH 400 external structure - BOM - job "&In_JobNo').font = TITLE
ws.cell(row=2, column=1, value="Type only the yellow cells. Every number shows its formula beside it; every name in a "
                               "formula is listed under RULES or CALCULATIONS with its value and meaning.").font = MUTED
r = 4

# ================================================================ 1 INPUTS
band(r, "1  INPUTS", "type here")
heads(r + 1, ["Input", "Value", "Called", None, None, None, None, None, "Note"])
inputs = [
    ("In_JobNo", "Job no", "BLR 94", "label only"),
    ("In_Width", "Shaft width EXTERNAL (entrance face), mm", 1600, ""),
    ("In_Depth", "Shaft depth EXTERNAL (front to back), mm", 1550, ""),
    ("In_Pit", "Pit depth, mm", 0, "0 allowed"),
    ("In_Overhead", "Overhead (top landing to shaft top), mm", 2860, ""),
    ("In_Stops", "Number of landings (stops)", 4, "2 to 6"),
    ("In_Rise1", "Floor height ground to 1st, mm", 3720, "FFL to FFL"),
    ("In_Rise2", "Floor height 1st to 2nd, mm", 3295, "0 when the floor does not exist"),
    ("In_Rise3", "Floor height 2nd to 3rd, mm", 3365, ""),
    ("In_Rise4", "Floor height 3rd to 4th, mm", 0, ""),
    ("In_Rise5", "Floor height 4th to 5th, mm", 0, ""),
    ("In_CWT", "Counterweight side (seen from the landing)", "LEFT", "BACK, LEFT or RIGHT"),
    ("In_DoorType", "Door type", "AT", "label only"),
    ("In_DoorOpening", "Door opening", "AT 700 R", "printed on the D-locking post"),
]
IN_ROW = {}
for i, (n, label, val, note) in enumerate(inputs, r + 2):
    put(i, 1, label)
    put(i, 2, val, BOLD, YELLOW)
    put(i, 3, LABEL.get(n, ""), BOLD, box=False)
    ws.cell(row=i, column=9, value=note).font = MUTED
    name(n, i)
    IN_ROW[n] = i
for n, lst in [("In_CWT", '"BACK,LEFT,RIGHT"'), ("In_DoorType", '"AT,ACO,SWING,MCD"'), ("In_Stops", '"2,3,4,5,6"')]:
    dv = DataValidation(type="list", formula1=lst, allow_blank=False)
    ws.add_data_validation(dv)
    dv.add(f"B{IN_ROW[n]}")
r = r + 2 + len(inputs) + 1

# ================================================================ 2 CHECKS
LV = ["GND", "1ST", "2ND", "3RD", "4TH"]
band(r, "2  CHECKS", "every line must say OK")
heads(r + 1, ["Check", "Result", "Rule (in words)", None, None, None, None, None, "If it says CHECK"])
checks = [
    ("Width and depth filled", "AND(In_Width>Face_Deduct,In_Depth>Face_Deduct)", "Enter the external width and depth."),
    ("Stops 2 to 6", "AND(In_Stops>=2,In_Stops<=6)", "Five floor heights, so at most 6 stops."),
    ("Counterweight BACK, LEFT or RIGHT", 'OR(In_CWT="BACK",In_CWT="LEFT",In_CWT="RIGHT")', "Hydraulic (no counterweight): pick the rail side."),
    ("Pit depth 0 or more", "In_Pit>=0", ""),
    ("Overhead above Min_Overhead", "In_Overhead>Min_Overhead", "Below it the overhead cladding has no height."),
]
for k, lv in enumerate(LV, 1):
    checks.append((f"Floor height {k} filled and above its minimum (when used)",
                   f"IF(In_Stops>{k},In_Rise{k}>=MinRise_{lv},In_Rise{k}=0)",
                   f"Needed for {k + 1}+ stops and at least MinRise_{lv}; leave 0 when not used."))
checks.append(("Door opening from the list", 'OR(In_DoorOpening="",COUNTIF(List_DoorOpening,In_DoorOpening)>0)', "Pick from the dropdown."))
first_check = r + 2
for i, (what, f, todo) in enumerate(checks, first_check):
    put(i, 1, what)
    put(i, 2, f'=IF({f},"OK","CHECK")', BOLD, GREY)
    say(i, 3, f)
    ws.cell(row=i, column=9, value=todo).font = MUTED
last_check = first_check + len(checks) - 1
i = last_check + 1
put(i, 1, "ALL CHECKS", BOLD)
put(i, 2, f'=IF(COUNTIF(B{first_check}:B{last_check},"CHECK")=0,"OK","CHECK")', BOLD, GREY)
STATUS = i
rng = f"B{first_check}:B{STATUS}"
ws.conditional_formatting.add(rng, FormulaRule(formula=[f'B{first_check}="CHECK"'], fill=PatternFill("solid", fgColor="F8CBAD"), font=F(bold=True, color="9C0006")))
ws.conditional_formatting.add(rng, FormulaRule(formula=[f'B{first_check}="OK"'], fill=PatternFill("solid", fgColor="C6EFCE")))
r = STATUS + 2

# ================================================================ 3 PART LIST
CORNERS = [("FL", "D100-0001"), ("FR", "D101-0001"), ("BL", "D102-0001"), ("BR", "D103-0001")]
SIDE = ["LEFT", "RIGHT", "BACK"]
sections = []


def section(t):
    sections.append((t, []))


def add(*row):
    sections[-1][1].append(row)


def fixed(code):
    return f'"{code}"', NAME[code]


def cwt_pick(face, bracket, plain):
    return (f'IF(IsCWT_{face},"{bracket}","{plain}")', f'=IF(IsCWT_{face},"{NAME[bracket]}","{NAME[plain]}")')


# row: code, part, face, level, needed, qty (before x Needed), length, width
section("Corner verticals (one per corner per floor)")
for lv in ["PIT"] + LV + ["OH"]:
    for cn, _ in CORNERS:
        add(*fixed(f"R4-PSX-{cn}"), "", lv, f"AND(Built_{lv},Ext_{lv}>0)", "1", f"Ext_{lv}", None)
    if lv == "PIT":  # owner v1 rows 24-25: no length given yet
        for pair in ["F&B", "L&R"]:
            add(*fixed("R4-CPT"), pair, "PIT", "Ext_PIT>Pit_Channel_Min", "Pit_Channel_Per_Pair", None, None)
section("2450 console modules")
for cn, dwg in CORNERS:
    c, p = fixed(f"R4-PST-{cn}")
    add(c, f"{p} (dwg {dwg})", "", "", "TRUE", "In_Stops", "Module", None)
for f in SIDE:
    add(*fixed("R4-GL-6"), f, "MOD", f"Glass_{f}", "1", "Glass_Lowest", f"Span_{f}+Glass_Allow")
for f in SIDE:
    add(*fixed("R4-GL-6"), f, "MOD", f"Glass_{f}", "2*In_Stops-1", "Glass_Panel", f"Span_{f}+Glass_Allow")
for f in SIDE:
    add(*fixed("R4-SH-12"), f, "MOD", f"Clad_{f}", "1", "Clad_Lowest", f"Span_{f}")
for f in SIDE:
    add(*fixed("R4-SH-12"), f, "MOD", f"Clad_{f}", "2*In_Stops-1", "Clad_Panel", f"Span_{f}")
section("Glass panels 6 mm (extensions)")
for lv in LV:
    for f in SIDE:
        add(*fixed("R4-GL-6"), f, lv, f"AND(Glass_{f},Built_{lv})", "1", f"Ext_{lv}-Glass_Deduct", f"Span_{f}+Glass_Allow")
section("Sheet cladding 1.2 mm (extensions + overhead)")
for lv in LV:
    for f in SIDE + ["FRONT"]:
        wd = "Span_FRONT_Ext" if f == "FRONT" else f"Span_{f}"
        add(*fixed("R4-SH-12"), f, lv, f"AND(Clad_{f},Built_{lv})", "1", f"Ext_{lv}-Clad_Deduct", wd)
for f in SIDE + ["FRONT"]:
    add(*fixed("R4-SH-12"), f, "OH", "Ext_OH>OH_Clad_Deduct", "1", "Ext_OH-OH_Clad_Deduct", f"Span_{f}")
section("Horizontal channels & covers")
for f in SIDE:
    add(*cwt_pick(f, "R4-C170-30B", "R4-C170-15"), f, "", "TRUE", "1", f"Span_{f}", None)
for f in SIDE:
    add(*fixed("R4-V170-12"), f, "", f"NOT(IsCWT_{f})", "1", f"Span_{f}+Cover_170", None)
add(*fixed("R4-C142"), "", "", "TRUE", "In_Stops", "Span_FRONT", None)
for f in SIDE:
    add(*fixed("R4-C135-15"), f, "", f"NOT(IsCWT_{f})", "Ch135_Per_Stop*In_Stops-1", f"Span_{f}", None)
for f in SIDE:
    add(*fixed("R4-V135-12"), f, "", f"NOT(IsCWT_{f})", "Ch135_Per_Stop*In_Stops-1", f"Span_{f}+Cover_135", None)
add(*fixed("R4-C135-30B"), "=In_CWT", "", "OR(IsCWT_LEFT,IsCWT_RIGHT,IsCWT_BACK)", "Ch135_Per_Stop*In_Stops-1", "Span_CWT", None)
for f in SIDE + ["FRONT"]:
    add(*cwt_pick(f, "R4-CTP-30B", "R4-CTP-30"), f, "", "TRUE", "1", f"Span_{f}", None)
# The overhead ring (2nd-last channels + covers) was removed on 2026-10-09.
section("Doors, plates & fasteners")
for hand in ["R", "L", "C"]:
    for part in ["DLP", "DPC", "LNT"]:
        code = f"R4-{part}-{hand}"
        add(f'"{code}"', f'="{NAME[code]} - opening "&In_DoorOpening', "", "", f'Door_Hand="{hand}"', "In_Stops", None, None)
add(*fixed("R4-CHD"), "", "", "TRUE", "In_Stops", None, None)
add(*fixed("R4-P122"), "", "", "TRUE", "Plate122_Per_Job", None, None)
add(*fixed("R4-P124"), "", "", "TRUE", "Plate124_Per_Bracket*(Ch135_Per_Stop*In_Stops-1)", None, None)
add(*fixed("R4-PJX"), "", "", "TRUE", "JointHex_Per_Stop*In_Stops", None, None)
add(*fixed("R4-PJH"), "", "", "TRUE", "JointHole_Per_Stop*In_Stops", None, None)
add(*fixed("R4-CDW"), "", "", "TRUE", "In_Stops", None, None)
add(*fixed("R4-BDW"), "", "", 'Door_Hand="C"', "In_Stops", None, None)
FAST_AT = len(sections[-1][1])
add(*fixed("R4-B830"), "", "", "TRUE", "Count_M8", None, None)
add(*fixed("R4-RN8"), "", "", "TRUE", "Count_M8", None, None)
add(*fixed("R4-S520"), "", "", "TRUE", "Count_M5", None, None)
add(*fixed("R4-RN5"), "", "", "TRUE", "Count_M5", None, None)

band(r, "3  PART LIST", "filter Needed = TRUE for this job; grey rows are not needed")
HR = r + 1
heads(HR, ["Part", "Code", "Face", "Level", "Needed", "Qty", "Length", "Width",
           "Needed when", "Qty =", "Length =", "Width =", "Piece mark"])
row = HR + 1
first_data = row
fast_first = None
for title, rws in sections:
    brow = row
    row += 1
    for k, (code, part, face, lv, need, qty, ln, wd) in enumerate(rws):
        i = row
        if title.startswith("Doors") and k == FAST_AT:
            fast_first = i
        put(i, 1, part)
        put(i, 2, f"={code}", CODEF, GREY)
        put(i, 3, face)
        put(i, 4, lv)
        put(i, 5, f"={need}", BASE, GREY)
        put(i, 6, f"=E{i}*({qty})" if qty not in ("1",) else f"=E{i}*1", BOLD, GREY)
        if ln:
            put(i, 7, f"={ln}", BASE, GREY)
        if wd:
            put(i, 8, f"={wd}", BASE, GREY)
        if need != "TRUE":
            say(i, 9, need)
        else:
            put(i, 9, "always", MUTED, box=False)
        say(i, 10, "Needed*" + (qty if qty == "1" or qty.replace("_", "").isalnum() else f"({qty})"))
        if ln:
            say(i, 11, ln)
        if wd:
            say(i, 12, wd)
        pos = f'IF(C{i}&""="",D{i}&"",IF(D{i}&""="",LEFT(C{i},1),LEFT(C{i},1)&"-"&D{i}))'
        size = f'IF(G{i}&""="","",IF(H{i}&""="",G{i}&"",G{i}&" × "&H{i}))'
        put(i, 13, f'=IF(E{i},B{i}&IF({pos}="",""," · "&{pos})&IF({size}="",""," · "&{size}),"")', BASE)
        row += 1
    for col in range(1, 14):
        ws.cell(row=brow, column=col).fill = BAND
    ws.cell(row=brow, column=1, value=title).font = BOLD
    ws.cell(row=brow, column=5, value=f"=COUNTIF(E{brow + 1}:E{row - 1},TRUE)>0").font = F(color="8EA9DB")
last_data = row - 1
wb.defined_names["PL_Qty"] = DefinedName("PL_Qty", attr_text=f"{SH}!$F${first_data}:$F${fast_first - 1}")
wb.defined_names["PL_Code"] = DefinedName("PL_Code", attr_text=f"{SH}!$B${first_data}:$B${fast_first - 1}")
ws.auto_filter.ref = f"A{HR}:M{last_data}"
ws.conditional_formatting.add(f"A{first_data}:M{last_data}",
                              FormulaRule(formula=[f'AND($E{first_data}=FALSE,$B{first_data}<>"")'], font=F(color="C0C0C0")))
put(row, 1, "Total pieces", BOLD)
put(row, 6, f"=SUM(F{first_data}:F{last_data})", BOLD, GREY)
r = row + 2

# ================================================================ 4 RULES
band(r, "4  RULES", "fixed numbers - blue cells may be edited; everything above updates")
heads(r + 1, ["Name", "Value", None, None, None, None, None, None, "What it means"])
rules = [
    ("Geometry", None, None),
    ("Module", 2450, "Fixed console module height at every landing (posts D100-D103)."),
    ("Base_Drop", 95.5, "Module base sits 95.5 below each landing (owner v1, 9 Oct 2026; was 67.5)."),
    ("Pit_Stub_Deduct", 95.5, "Pit piece = pit - 95.5 on a deep pit."),
    ("Pit_Stub_Min", 74.5, "Pit piece length when the pit is shallower than Shallow_Pit."),
    ("Shallow_Pit", 170, "Pit depth below which the pit piece is fixed."),
    ("Top_Gap", 30, "Corner posts stop 30 below the shaft top."),
    ("Face_Deduct", 200, "Face span = external size - two 100 mm corner posts."),
    ("Glass", None, None),
    ("Glass_Allow", 38, "Glass width = span + 38 (owner, 3 Oct 2026; was 35)."),
    ("Glass_Deduct", 97, "Extension glass height = extension - 97 (45.5 + 45.5 + 6)."),
    ("Glass_Panel", 1128, "Module glass height (1090 + 22 + 22 - 6)."),
    ("Glass_Lowest", 1098, "Lowest module glass, 1 per glass face per job."),
    ("Cladding", None, None),
    ("Clad_Deduct", 142, "Extension cladding height = extension - 142."),
    ("OH_Clad_Deduct", 230.5, "Overhead cladding height = overhead extension - (95.5 + 135)."),
    ("Clad_Panel", 1090, "Module sheet height (2450/2 - 135)."),
    ("Clad_Lowest", 1062, "Lowest module sheet (2450/2 - 163), 1 per clad face per job."),
    ("Channels, covers, plates", None, None),
    ("Cover_170", 9, "170 cover = channel + 9 (4.5 + 4.5)."),
    ("Cover_135", 38, "135 cover = channel + 38 (19 + 19)."),
    ("Ch135_Per_Stop", 3, "135 channels per face = 3 x stops - 1."),
    ("Plate122_Per_Job", 2, "Plate 122 per job."),
    ("Pit_Channel_Min", 250, "Pit channels when the pit piece is over this (owner v1, 9 Oct 2026)."),
    ("Pit_Channel_Per_Pair", 2, "Pit channels front & back, and left & right."),
    ("Plate124_Per_Bracket", 2, "Plate 124 per 135 bracket channel."),
    ("JointHex_Per_Stop", 12, "Joint plate hex per landing."),
    ("JointHole_Per_Stop", 8, "Joint plate hole per landing."),
    ("M8 bolts per part (1 rivnut each)", None, None),
    ("M8_Ch170", 6, "Per 170 channel."),
    ("M8_Ch135", 4, "Per 135 / top channel."),
    ("M8_Lintel", 4, "Per lintel panel."),
    ("M8_Post_Per_Stop", 16, "Corner-post joints: 4 per corner per landing."),
    ("M8_Post_Top", 8, "Corner-post top: 2 per corner, once per job."),
    ("M5 screws per part (1 rivnut each)", None, None),
    ("M5_Sill_Ground", 5, "Sill at the ground landing."),
    ("M5_Sill", 7, "Sill at every other landing."),
    ("M5_Cover", 8, "Per channel cover."),
    ("M5_Ch170", 12, "Per 170 channel (6 + 6)."),
    ("M5_Ch135", 12, "Per 135 / top channel (6 + 6)."),
    ("M5_DeadWeight", 4, "Per dead weight channel."),
    ("M5_DoorPost_DLock", 8, "Per D-locking door post."),
    ("M5_DoorPost_Clad", 8, "Per door post cladding."),
    ("M5_Lintel", 13, "Per lintel panel."),
]
i = r + 2
for n, v, note in rules:
    if v is None:
        for col in range(1, 14):
            ws.cell(row=i, column=col).fill = BAND
        ws.cell(row=i, column=1, value=n).font = BOLD
    else:
        put(i, 1, n.replace("_", " "), BOLD)
        put(i, 2, v, BOLD, BLUE)
        ws.cell(row=i, column=9, value=note).font = MUTED
        name(n, i)
    i += 1
r = i + 1

# ================================================================ 5 CALCULATIONS
band(r, "5  CALCULATIONS", "worked out from Inputs and Rules - do not type here")
heads(r + 1, ["Name", "Value", "Formula (in words)", None, None, None, None, None, "What it is"])


def S(n, label, *, sub=None):
    return ("sub", n) if sub else (n, label)


calcs = [
    ("Floors", None, None),
    ("Ext_PIT", "=IF(In_Pit>=Shallow_Pit,In_Pit-Pit_Stub_Deduct,Pit_Stub_Min)", "Pit piece length."),
    ("MinRise_GND", "=Module+Clad_Deduct+Base_Drop+Ext_PIT-In_Pit", "Smallest ground-to-1st floor height."),
    ("Min_Rise", "=Module+Clad_Deduct", "Smallest floor height above the ground floor."),
]
for k, lv in enumerate(LV[1:], 2):
    calcs.append((f"MinRise_{lv}", "=Min_Rise", f"Smallest floor height for {lv}."))
for k, lv in enumerate(LV, 1):
    calcs.append((f"Built_{lv}", f"=AND(In_Stops>{k},In_Rise{k}>=MinRise_{lv})", f"Is the {lv} extension in this job?"))
calcs += [("Built_PIT", "=TRUE", "Always built."), ("Built_OH", "=TRUE", "Always built.")]
calcs.append(("Ext_GND", "=IF(Built_GND,In_Rise1+In_Pit-Base_Drop-Ext_PIT-Module,0)", "Ground extension: posts run from the pit floor."))
for k, lv in enumerate(LV[1:], 2):
    calcs.append((f"Ext_{lv}", f"=IF(Built_{lv},In_Rise{k}-Module,0)", f"{lv} extension."))
calcs += [
    ("Ext_OH", "=In_Overhead+Base_Drop-Module-Top_Gap", "Overhead extension."),
    ("Min_Overhead", "=Module+Top_Gap-Base_Drop+OH_Clad_Deduct", "Overhead must be MORE than this."),
    ("Faces (L R B F)", None, None),
]
for f, span in [("LEFT", "In_Depth"), ("RIGHT", "In_Depth"), ("BACK", "In_Width"), ("FRONT", "In_Width")]:
    calcs.append((f"Span_{f}", f"={span}-Face_Deduct", f"{f.title()} face span (channel / panel width)."))
calcs.append(("Span_FRONT_Ext", "=In_Depth-Face_Deduct", "Front extension cladding width: depth - 200 (owner v2 row 20, 9 Oct 2026)."))
for f in ["LEFT", "RIGHT", "BACK"]:
    calcs.append((f"IsCWT_{f}", f'=In_CWT="{f}"', f"Is the counterweight on the {f.lower()}?"))
calcs.append(("IsCWT_FRONT", "=FALSE", "The front is the door."))
for f in ["LEFT", "RIGHT", "BACK"]:
    calcs.append((f"Glass_{f}", f"=NOT(IsCWT_{f})", f"Does the {f.lower()} face get glass?"))
calcs.append(("Glass_FRONT", "=FALSE", "The front never gets glass."))
for f in ["LEFT", "RIGHT", "BACK"]:
    calcs.append((f"Clad_{f}", f"=IsCWT_{f}", f"Is the {f.lower()} face sheet-clad?"))
calcs.append(("Clad_FRONT", "=TRUE", "The front is clad on every job (owner v1, 9 Oct 2026)."))
calcs.append(("Span_CWT", "=IF(IsCWT_BACK,Span_BACK,Span_LEFT)", "Span of the counterweight face."))
calcs.append(("Door_Hand", '=IF(ISNUMBER(SEARCH("CO",In_DoorOpening)),"C",IF(ISNUMBER(SEARCH("L",In_DoorOpening)),"L","R"))',
              "Door set hand from the opening: R, L, or C (centre opening)."))
calcs.append(("Fasteners", None, None))
QTY, CODE = "PL_Qty", "PL_Code"
cnt = lambda p: f'SUMIFS({QTY},{CODE},"{p}")'
calcs += [
    ("N_Ch170", f"={cnt('R4-C170*')}", "170 channels on the list."),
    ("N_Ch135", f"={cnt('R4-C135*')}+{cnt('R4-CTP*')}", "135 and top channels."),
    ("N_Cover", f"={cnt('R4-V*')}", "Channel covers."),
    ("N_Lintel", f"={cnt('R4-LNT*')}", "Lintel panels."),
    ("N_DLock", f"={cnt('R4-DLP*')}", "D-locking door posts."),
    ("N_PostClad", f"={cnt('R4-DPC*')}", "Door post claddings."),
    ("N_DeadWeight", f"={cnt('R4-CDW')}", "Dead weight channels."),
    ("Count_M8", "=M8_Ch170*N_Ch170+M8_Ch135*N_Ch135+M8_Lintel*N_Lintel+M8_Post_Per_Stop*In_Stops+M8_Post_Top", "M8 bolts (and M8 rivnuts)."),
    ("Count_M5", "=M5_Sill_Ground+M5_Sill*(In_Stops-1)+M5_Cover*N_Cover+M5_Ch170*N_Ch170+M5_Ch135*N_Ch135"
                 "+M5_DeadWeight*N_DeadWeight+M5_DoorPost_DLock*N_DLock+M5_DoorPost_Clad*N_PostClad+M5_Lintel*N_Lintel",
     "M5 screws (and M5 rivnuts)."),
]
i = r + 2
for n, f, note in calcs:
    if f is None:
        for col in range(1, 14):
            ws.cell(row=i, column=col).fill = BAND
        ws.cell(row=i, column=1, value=n).font = BOLD
    else:
        put(i, 1, LABEL.get(n, n), BOLD)
        put(i, 2, f, BOLD, GREY)
        say(i, 3, f.lstrip("="))
        ws.cell(row=i, column=9, value=note).font = MUTED
        name(n, i)
    i += 1
r = i + 1

# ================================================================ door options + code key
band(r, "DOOR OPENING OPTIONS  ·  CODE KEY")
openings = ["AT 600 R", "AT 700 R", "AT 800 R", "AT 600 L", "AT 700 L", "AT 800 L",
            "600 CO", "700 CO", "800 CO", "600L SW", "700L SW", "800L SW"]
for k, o in enumerate(openings, r + 1):
    put(k, 1, o)
wb.defined_names["List_DoorOpening"] = DefinedName("List_DoorOpening", attr_text=f"{SH}!$A${r + 1}:$A${r + len(openings)}")
dv = DataValidation(type="list", formula1="=List_DoorOpening", allow_blank=True)
ws.add_data_validation(dv)
dv.add(f"B{IN_ROW['In_DoorOpening']}")
for k, t in enumerate([
    "CODE = what the part IS (profile, thickness, hand). Same code only if two pieces can be swapped.",
    "R4-<PART>[-<thickness>][B]: 15 = 1.5 mm, 30 = 3 mm, 12 = 1.2 mm, 6 = 6 mm; B = bracket version (counterweight face).",
    "Corner parts end FL / FR / BL / BR; door parts R / L / C (centre opening).",
    "PIECE MARK = code · face-level · size, e.g. R4-C135-15 · B · 1400. Levels: PIT, GND-4TH, OH, MOD (2450 module).",
], r + 1):
    ws.cell(row=k, column=3, value=t).font = MUTED

import re

RULE_VAL = {n: v for n, v, _ in rules if v is not None}


def words(expr):
    """The formula in plain words: inputs and derived values by label, rules by their number.
    Quoted text (codes, "BACK") is kept as written."""
    parts = expr.split('"')
    return "".join(_words(x) if k % 2 == 0 else x for k, x in enumerate(parts)).strip()


def _words(t):
    for n in sorted(set(RULE_VAL) | set(LABEL), key=len, reverse=True):
        rep_by = LABEL[n] if n in LABEL else (f"{RULE_VAL[n]:g}" if isinstance(RULE_VAL[n], (int, float)) else n)
        t = re.sub(rf"\b{n}\b", rep_by, t)
    t = t.replace("Needed*", "Needed × ").replace("*", " × ").replace(">=", " ≥ ").replace("<=", " ≤ ")
    t = re.sub(r"(?<=[\w)])-(?=[\w(])", " − ", t).replace("+", " + ").replace(">", " > ").replace("<", " < ")
    t = re.sub(r"(?<![≥≤<> ])=", " = ", t).replace(",", ", ")
    return re.sub(r"\s+", " ", t)


for (row_, col_, expr) in SAY:
    put(row_, col_, words(expr), MUTED if col_ in (3, 9) else F(color="1F3864"), box=col_ not in (3,))

# Swap every name for its cell address: no named ranges are left in the file.
refs = {n: d.attr_text.split("!", 1)[1] for n, d in wb.defined_names.items()}
order = sorted(refs, key=len, reverse=True)
pat = re.compile(r"\b(" + "|".join(map(re.escape, order)) + r")\b")


def swap(f):
    parts = f.split('"')
    for k in range(0, len(parts), 2):  # outside quoted strings only
        parts[k] = pat.sub(lambda m: refs[m.group(1)], parts[k])
    return '"'.join(parts)


for row_ in ws.iter_rows():
    for c in row_:
        if isinstance(c.value, str) and c.value.startswith("="):
            c.value = swap(c.value)
for dv_ in ws.data_validations.dataValidation:
    if dv_.formula1 and dv_.formula1.startswith("="):
        dv_.formula1 = swap(dv_.formula1)
for n in list(wb.defined_names):
    del wb.defined_names[n]

ws.freeze_panes = "A4"
wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
print("part list rows", first_data, "-", last_data, "| inputs at B", IN_ROW["In_JobNo"], "| status B", STATUS, "->", OUT)
