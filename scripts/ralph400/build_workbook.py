"""Build the cleaned-up RALPH 400 structure BOM workbook.

Every number lives on the Rules sheet as a named cell; every part row on the
Part List reads like a sentence of named values. Mirrors src/lib/ralph400
(model.ts clean mode + catalog.ts) as of 2026-10-03. When a rule changes in
model.ts, change it here too and rebuild:

  npx tsx scripts/ralph400/export-catalog.ts > catalog.json
  python scripts/ralph400/build_workbook.py "RALPH 400 BOM - Clean.xlsx" catalog.json

Verified line-for-line against buildPartList() on 17 jobs (all CWT sides,
2-6 stops, shallow and deep pits, below-minimum inputs) with the `formulas`
package before the 2026-10-03 release.
"""
import sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule

OUT = sys.argv[1]
wb = Workbook()

YELLOW = PatternFill("solid", fgColor="FFF4C2")
BLUE = PatternFill("solid", fgColor="DDEBF7")
GREY = PatternFill("solid", fgColor="F2F2F2")
HEAD = PatternFill("solid", fgColor="1F3864")
SEC = PatternFill("solid", fgColor="D9E1F2")
WHITE_B = Font(bold=True, color="FFFFFF")
BOLD = Font(bold=True)
TITLE = Font(bold=True, size=14)
MUTED = Font(color="808080", italic=True)
thin = Side(style="thin", color="BFBFBF")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top")


def name(n, ref):
    wb.defined_names[n] = DefinedName(n, attr_text=ref)


def header(ws, row, cols, widths=None):
    for i, h in enumerate(cols, 1):
        c = ws.cell(row=row, column=i, value=h)
        c.fill, c.font, c.border = HEAD, WHITE_B, BOX
        c.alignment = Alignment(wrap_text=True, vertical="center")
    if widths:
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[chr(64 + i)].width = w


# ---------------------------------------------------------------- How to use
ws = wb.active
ws.title = "How to use"
lines = [
    ("RALPH 400 External Structure - BOM", TITLE),
    ("Cleaned-up workbook, 3 Oct 2026. Same rules as the ERP page /ralph400 (RALPH 400 Structure Part List).", MUTED),
    ("", None),
    ("1. Fill the yellow cells on 'Inputs'. Nothing else needs typing for a job.", None),
    ("2. Read 'Checks'. Every line must say OK before the list is used.", None),
    ("3. 'Part List' is the BOM. Filter column F (Needed) to YES to see only what this job gets.", None),
    ("   Column J is the piece mark to write on each part: code · face-level · size (see Catalog).", None),
    ("", None),
    ("To change a rule (e.g. a cover allowance or a panel height) edit the blue cell on 'Rules'.", BOLD),
    ("Every formula refers to rules and inputs by NAME (e.g. Cover_135, In_Width), never by a typed number,", None),
    ("so one edit on 'Rules' flows through the whole list. Formulas > Name Manager lists every name.", None),
    ("", None),
    ("How the sheets connect", BOLD),
    ("Inputs  ->  Levels (height of each floor's extension, glass and cladding)", None),
    ("Inputs  ->  Faces  (width of each face; which faces get glass, cladding, bracket channels)", None),
    ("Levels + Faces + Rules  ->  Part List  ->  fastener totals at the bottom of Part List", None),
    ("Catalog = item codes and names.  Changes = what was corrected against the old workbook.", None),
    ("", None),
    ("Colours", BOLD),
    ("Yellow = you type it.  Blue = a rule (edit with care).  Grey = calculated, do not type over.", None),
    ("", None),
    ("Faces are named looking at the lift from the landing: FRONT = door side, BACK, LEFT, RIGHT.", None),
    ("The counterweight face is clad in 1.2 mm sheet and carries the 3 mm bracket channels; the other", None),
    ("side faces get 6 mm glass with 1.5 mm channels + 1.2 mm covers. With the counterweight at the", None),
    ("BACK, the FRONT is also clad in the extensions. The overhead is clad on all four faces.", None),
]
for i, (t, f) in enumerate(lines, 1):
    c = ws.cell(row=i, column=1, value=t)
    if f:
        c.font = f
ws.column_dimensions["A"].width = 110

# ---------------------------------------------------------------- Inputs
ws = wb.create_sheet("Inputs")
header(ws, 1, ["Input", "Value", "Unit", "Notes"], [34, 16, 8, 70])
inputs = [
    ("In_JobNo", "Job no", "BLR 94", "", "Label only"),
    ("In_Width", "Shaft width EXTERNAL (entrance face)", 1600, "mm", "Outer size of the structure"),
    ("In_Depth", "Shaft depth EXTERNAL (front to back)", 1550, "mm", "Outer size of the structure"),
    ("In_Pit", "Pit depth", 0, "mm", "0 allowed. Under 170 the pit piece is fixed at 74.5"),
    ("In_Overhead", "Overhead (top landing to shaft top)", 2860, "mm", "Must be more than Min_Overhead (see Rules)"),
    ("In_Stops", "Number of landings (stops)", 4, "", "2 to 6. A job with N stops needs N-1 floor heights below"),
    ("In_Rise1", "Floor height: ground to 1st", 3720, "mm", "Finished floor level to finished floor level"),
    ("In_Rise2", "Floor height: 1st to 2nd", 3295, "mm", "Leave 0 when the floor does not exist"),
    ("In_Rise3", "Floor height: 2nd to 3rd", 3365, "mm", ""),
    ("In_Rise4", "Floor height: 3rd to 4th", 0, "mm", ""),
    ("In_Rise5", "Floor height: 4th to 5th", 0, "mm", ""),
    ("In_CWT", "Counterweight side", "LEFT", "", "BACK, LEFT or RIGHT, seen from the landing"),
    ("In_DoorType", "Door type", "AT", "", "Label only"),
    ("In_DoorOpening", "Door opening", "AT 700 R", "", "Label only - printed on the D-locking door post"),
]
for i, (n, label, val, unit, note) in enumerate(inputs, 2):
    ws.cell(row=i, column=1, value=label).border = BOX
    c = ws.cell(row=i, column=2, value=val)
    c.fill, c.border = YELLOW, BOX
    ws.cell(row=i, column=3, value=unit).border = BOX
    ws.cell(row=i, column=4, value=note).border = BOX
    name(n, f"Inputs!$B${i}")
row_of = {n: i for i, (n, *_r) in enumerate(inputs, 2)}
for n, lst in [
    ("In_CWT", '"BACK,LEFT,RIGHT"'),
    ("In_DoorType", '"AT,ACO,SWING,MCD"'),
    ("In_Stops", '"2,3,4,5,6"'),
]:
    dv = DataValidation(type="list", formula1=lst, allow_blank=False)
    ws.add_data_validation(dv)
    dv.add(f"B{row_of[n]}")
ws.cell(row=20, column=1, value="Door opening options").font = BOLD
openings = ["AT 600 R", "AT 700 R", "AT 800 R", "AT 600 L", "AT 700 L", "AT 800 L",
            "600 CO", "700 CO", "800 CO", "600L SW", "700L SW", "800L SW"]
for i, o in enumerate(openings, 21):
    ws.cell(row=i, column=1, value=o)
name("List_DoorOpening", f"Inputs!$A$21:$A${20 + len(openings)}")
dv = DataValidation(type="list", formula1="=List_DoorOpening", allow_blank=True)
ws.add_data_validation(dv)
dv.add(f"B{row_of['In_DoorOpening']}")
ws.freeze_panes = "A2"

# ---------------------------------------------------------------- Rules
ws = wb.create_sheet("Rules")
header(ws, 1, ["Name", "Value", "Unit", "What it means / where it comes from"], [26, 10, 8, 95])
rules = [
    ("Geometry", None, None, None),
    ("Module", 2450, "mm", "Height of the fixed console module at every landing (corner posts D100-D103)."),
    ("Base_Drop", 67.5, "mm", "Half a 135 channel: the module base sits 67.5 below each landing."),
    ("Pit_Stub_Deduct", 95.5, "mm", "Pit piece = pit depth - 95.5 (67.5 + 28) when the pit is deep enough."),
    ("Pit_Stub_Min", 74.5, "mm", "Pit piece length used when the pit is shallower than Shallow_Pit."),
    ("Shallow_Pit", 170, "mm", "Pit depth below which the pit piece is fixed at Pit_Stub_Min."),
    ("Top_Gap", 30, "mm", "Corner posts stop 30 below the shaft top."),
    ("Face_Deduct", 200, "mm", "Every channel / panel spans a face: external size minus two 100 mm corner posts."),
    ("Glass", None, None, None),
    ("Glass_Allow", 35, "mm", "Glass width = face span + 35 (20.5 + 20.5 rebate - 6)."),
    ("Glass_Deduct", 97, "mm", "Extension glass height = extension - 97 (45.5 + 45.5 + 6)."),
    ("Glass_Panel", 1128, "mm", "Module glass height (1090 + 22 + 22 - 6). 2 per face per landing, less the lowest."),
    ("Glass_Lowest", 1098, "mm", "Lowest module glass on each face (1225 - (75 + 45.5 + 6) = 1098.5, cut 1098). 1 per face per job."),
    ("Cladding", None, None, None),
    ("Clad_Deduct", 142, "mm", "Extension cladding height = extension - 142 (67.5 + 74.5)."),
    ("OH_Clad_Deduct", 202.5, "mm", "Overhead cladding height = overhead extension - (67.5 + 135)."),
    ("Clad_Panel", 1090, "mm", "Module cladding height (2450 / 2 - 135). 2 per face per landing, less the lowest."),
    ("Clad_Lowest", 1062, "mm", "Lowest module cladding on each face (2450 / 2 - 163; 163 = 95.5 + 67.5). 1 per face per job."),
    ("Channels and covers", None, None, None),
    ("Cover_170", 9, "mm", "Cover for a 170 channel = channel length + 9 (4.5 + 4.5)."),
    ("Cover_135", 38, "mm", "Cover for a 135 channel (incl. the overhead ring) = channel length + 38 (19 + 19)."),
    ("Ch135_Per_Stop", 3, "", "135 channels per face = 3 x stops - 1."),
    ("Plates", None, None, None),
    ("Plate122_Per_Job", 2, "", "Bracket fixing plate 122: fixed per job."),
    ("Plate124_Per_Bracket", 2, "", "Bracket fixing plate 124: 2 per 135 bracket channel (= 6 x stops - 2)."),
    ("JointHex_Per_Stop", 12, "", "Joint plate, hex: per landing."),
    ("JointHole_Per_Stop", 8, "", "Joint plate, hole: per landing."),
    ("Fasteners - M8 bolts per part (each pairs with an M8 rivnut)", None, None, None),
    ("M8_Ch170", 6, "", "Per 170 channel."),
    ("M8_Ch135", 4, "", "Per 135 channel (1.5 mm, 3 mm bracket, top and overhead-ring channels)."),
    ("M8_Lintel", 4, "", "Per lintel panel."),
    ("M8_Post_Per_Stop", 16, "", "Corner-post joints: 4 per corner per landing."),
    ("M8_Post_Top", 8, "", "Corner-post top: 2 per corner, once per job."),
    ("Fasteners - M5 screws per part (each pairs with an M5 rivnut)", None, None, None),
    ("M5_Sill_Ground", 5, "", "Sill channel at the ground landing."),
    ("M5_Sill", 7, "", "Sill channel at every other landing."),
    ("M5_Cover", 8, "", "Per channel cover."),
    ("M5_Ch170", 12, "", "Per 170 channel (6 + 6)."),
    ("M5_Ch135", 12, "", "Per 135 channel (6 + 6)."),
    ("M5_DeadWeight", 4, "", "Per dead weight channel."),
    ("M5_DoorPost_DLock", 8, "", "Per D-locking door post."),
    ("M5_DoorPost_Clad", 8, "", "Per door post cladding."),
    ("M5_Lintel", 13, "", "Per lintel panel."),
    ("Derived limits (calculated - do not type)", None, None, None),
    ("Min_Rise", "=Module+Clad_Deduct", "mm", "Smallest floor height above ground that still leaves a cladding panel."),
    ("Min_Overhead", "=Module+Top_Gap-Base_Drop+OH_Clad_Deduct", "mm", "Overhead must be MORE than this, or the overhead cladding has no height."),
]
r = 2
for n, v, unit, note in rules:
    if v is None:
        c = ws.cell(row=r, column=1, value=n)
        c.font, c.fill = BOLD, SEC
        for col in range(2, 5):
            ws.cell(row=r, column=col).fill = SEC
    else:
        ws.cell(row=r, column=1, value=n).border = BOX
        c = ws.cell(row=r, column=2, value=v)
        c.fill = GREY if isinstance(v, str) else BLUE
        c.border = BOX
        ws.cell(row=r, column=3, value=unit).border = BOX
        d = ws.cell(row=r, column=4, value=note)
        d.border, d.alignment = BOX, WRAP
        name(n, f"Rules!$B${r}")
    r += 1
ws.freeze_panes = "A2"

# ---------------------------------------------------------------- Levels
ws = wb.create_sheet("Levels")
header(ws, 1, ["Level", "Floor height used", "Built?", "Minimum floor height",
               "Corner post extension", "Extension glass height", "Extension cladding height", "How the extension is worked out"],
       [11, 14, 9, 14, 16, 14, 16, 70])
levels = [
    ("PIT", None, None, None, "=IF(In_Pit>=Shallow_Pit,In_Pit-Pit_Stub_Deduct,Pit_Stub_Min)",
     "Pit piece: pit depth - 95.5, or 74.5 when the pit is under 170."),
    ("GND", "In_Rise1", 2, "=Module+Clad_Deduct+Base_Drop+Ext_PIT-In_Pit",
     "=IF(Built_GND,In_Rise1+In_Pit-Base_Drop-Ext_PIT-Module,0)",
     "Ground to 1st: floor height + pit - 67.5 - pit piece - 2450. The posts run from the pit floor."),
    ("1ST", "In_Rise2", 3, "=Min_Rise", "=IF(Built_1ST,In_Rise2-Module,0)", "Floor height - 2450."),
    ("2ND", "In_Rise3", 4, "=Min_Rise", "=IF(Built_2ND,In_Rise3-Module,0)", "Floor height - 2450."),
    ("3RD", "In_Rise4", 5, "=Min_Rise", "=IF(Built_3RD,In_Rise4-Module,0)", "Floor height - 2450."),
    ("4TH", "In_Rise5", 6, "=Min_Rise", "=IF(Built_4TH,In_Rise5-Module,0)", "Floor height - 2450 (the old extra -35 is gone)."),
    ("OH", None, None, None, "=In_Overhead+Base_Drop-Module-Top_Gap",
     "Overhead extension: overhead + 67.5 - 2450 - 30."),
]
for i, (lv, rise, stops, mn, ext, how) in enumerate(levels, 2):
    ws.cell(row=i, column=1, value=lv).font = BOLD
    if rise:
        ws.cell(row=i, column=2, value=f"={rise}")
        # Built when the job has this many stops AND the height clears the minimum.
        ws.cell(row=i, column=3, value=f"=AND(In_Stops>={stops},{rise}>=MinRise_{lv})")
        ws.cell(row=i, column=4, value=mn)
        name(f"MinRise_{lv}", f"Levels!$D${i}")
        ws.cell(row=i, column=6, value=f"=IF(Built_{lv},Ext_{lv}-Glass_Deduct,0)")
        ws.cell(row=i, column=7, value=f"=IF(Built_{lv},Ext_{lv}-Clad_Deduct,0)")
        name(f"GlassH_{lv}", f"Levels!$F${i}")
        name(f"CladH_{lv}", f"Levels!$G${i}")
    else:
        ws.cell(row=i, column=3, value=True)
        if lv == "OH":
            ws.cell(row=i, column=7, value="=Ext_OH-OH_Clad_Deduct")
            name("CladH_OH", f"Levels!$G${i}")
    name(f"Built_{lv}", f"Levels!$C${i}")
    ws.cell(row=i, column=5, value=ext)
    name(f"Ext_{lv}", f"Levels!$E${i}")
    ws.cell(row=i, column=8, value=how).alignment = WRAP
    for col in range(1, 9):
        ws.cell(row=i, column=col).border = BOX
        if 2 <= col <= 7:
            ws.cell(row=i, column=col).fill = GREY

# ---------------------------------------------------------------- Faces
ws = wb.create_sheet("Faces")
header(ws, 1, ["Face", "Span (channel / panel width)", "Counterweight face?", "Glass?", "Cladding in extensions?", "Why"],
       [10, 18, 14, 9, 16, 80])
faces = [
    ("LEFT", "=In_Depth-Face_Deduct", '=In_CWT="LEFT"', '=In_CWT<>"LEFT"', '=In_CWT="LEFT"',
     "Side face spans the depth. Glass unless the counterweight is here."),
    ("RIGHT", "=In_Depth-Face_Deduct", '=In_CWT="RIGHT"', '=In_CWT<>"RIGHT"', '=In_CWT="RIGHT"',
     "Side face spans the depth. Glass unless the counterweight is here."),
    ("BACK", "=In_Width-Face_Deduct", '=In_CWT="BACK"', '=In_CWT<>"BACK"', '=In_CWT="BACK"',
     "Back face spans the width. Glass unless the counterweight is here."),
    ("FRONT", "=In_Width-Face_Deduct", "=FALSE", "=FALSE", '=In_CWT="BACK"',
     "Door face. No glass; clad in the extensions only when the counterweight is at the BACK."),
]
for i, (f, span, cw, gl, cl, why) in enumerate(faces, 2):
    ws.cell(row=i, column=1, value=f).font = BOLD
    for col, (v, nm) in enumerate([(span, "Span"), (cw, "IsCWT"), (gl, "Glass"), (cl, "Clad")], 2):
        ws.cell(row=i, column=col, value=v).fill = GREY
        name(f"{nm}_{f}", f"Faces!${chr(64 + col)}${i}")
    ws.cell(row=i, column=6, value=why).alignment = WRAP
    for col in range(1, 7):
        ws.cell(row=i, column=col).border = BOX
r = len(faces) + 3
ws.cell(row=r, column=1, value="CWT face span").font = BOLD
ws.cell(row=r, column=2, value='=IF(In_CWT="BACK",Span_BACK,Span_LEFT)').fill = GREY
name("Span_CWT", f"Faces!$B${r}")

# ---------------------------------------------------------------- Part list
ws = wb.create_sheet("Part List")
ws.cell(row=1, column=1, value='="RALPH 400 structure part list - job "&In_JobNo').font = TITLE
ws.cell(row=2, column=1, value="Filter column F (Needed) to YES for the job's list. Sizes in mm. Do not type in this sheet: change Inputs or Rules.").font = MUTED
HR = 4
header(ws, HR, ["Section", "Code", "Part", "Face", "Level", "Needed", "Qty", "Length / height", "Width", "Piece mark", "Rule"],
       [20, 13, 36, 8, 7, 8, 7, 13, 9, 30, 70])
ws.column_dimensions["K"].width = 70
import json
cat = json.load(open(sys.argv[2], encoding="utf-8"))
NAME = {c["code"]: c["name"] for c in cat}
rows = []  # (section, code_formula, part, face, level, needed_formula, qty_formula, len_formula, width_formula, rule)
LV = ["GND", "1ST", "2ND", "3RD", "4TH"]
SIDE = ["LEFT", "RIGHT", "BACK"]
CORNERS = [("FL", "D100-0001"), ("FR", "D101-0001"), ("BL", "D102-0001"), ("BR", "D103-0001")]


def add(*r):
    rows.append(r)


def fixed(code):
    """Code + catalog name for a part whose code never changes."""
    return f'"{code}"', NAME[code]


def cwt_pick(face, bracket, plain):
    """Bracket version on the counterweight face, plain version elsewhere."""
    return (f'IF(IsCWT_{face},"{bracket}","{plain}")',
            f'=IF(IsCWT_{face},"{NAME[bracket]}","{NAME[plain]}")')


S = "Corner posts"
for cn, dwg in CORNERS:
    add(S, *fixed(f"R4-PST-{cn}"), "", "", "TRUE", "In_Stops", "Module", None, f"One per landing. Drawing {dwg}.")
for lv in ["PIT"] + LV + ["OH"]:
    for cn, _ in CORNERS:
        add(S, *fixed(f"R4-PSX-{cn}"), "", lv, f"AND(Built_{lv},Ext_{lv}>0)", "1", f"Ext_{lv}", None,
            "One per corner per level (corners are mirrored); length from the Levels sheet.")

S = "Module panels (MOD)"
for f in SIDE:
    add(S, *fixed("R4-GL-6"), f, "MOD", f"Glass_{f}", "1", "Glass_Lowest", f"Span_{f}+Glass_Allow",
        "Lowest module glass (1098), one per glass face.")
for f in SIDE:
    add(S, *fixed("R4-GL-6"), f, "MOD", f"Glass_{f}", "2*In_Stops-1", "Glass_Panel", f"Span_{f}+Glass_Allow",
        "Module glass (1128): two per landing per glass face, less the lowest.")
for f in SIDE:
    add(S, *fixed("R4-SH-12"), f, "MOD", f"Clad_{f}", "1", "Clad_Lowest", f"Span_{f}",
        "Lowest module sheet (1062) on the counterweight face.")
for f in SIDE:
    add(S, *fixed("R4-SH-12"), f, "MOD", f"Clad_{f}", "2*In_Stops-1", "Clad_Panel", f"Span_{f}",
        "Module sheet (1090): two per landing on the counterweight face, less the lowest.")

S = "Extension glass"
for lv in LV:
    for f in SIDE:
        add(S, *fixed("R4-GL-6"), f, lv, f"AND(Glass_{f},Built_{lv},GlassH_{lv}>0)", "1",
            f"GlassH_{lv}", f"Span_{f}+Glass_Allow", "Extension - 97 tall; face span + 35 wide.")

S = "Extension cladding"
for lv in LV:
    for f in SIDE + ["FRONT"]:
        add(S, *fixed("R4-SH-12"), f, lv, f"AND(Clad_{f},Built_{lv},CladH_{lv}>0)", "1",
            f"CladH_{lv}", f"Span_{f}", "Extension - 142 tall; face span wide.")
for f in SIDE + ["FRONT"]:
    add(S, *fixed("R4-SH-12"), f, "OH", "CladH_OH>0", "1", "CladH_OH", f"Span_{f}",
        "Overhead is clad on all four faces: overhead extension - 202.5 tall.")

S = "Channels and covers"
for f in SIDE:
    add(S, *cwt_pick(f, "R4-C170-30B", "R4-C170-15"), f, "", "TRUE", "1", f"Span_{f}", None,
        "Bottom ring; bracket version on the counterweight face.")
for f in SIDE:
    add(S, *fixed("R4-V170-12"), f, "", f"NOT(IsCWT_{f})", "1", f"Span_{f}+Cover_170", None,
        "Channel + 9. None on the counterweight face.")
add(S, *fixed("R4-C142"), "", "", "TRUE", "In_Stops", "Span_FRONT", None, "One per landing, across the door face.")
for f in SIDE:
    add(S, *fixed("R4-C135-15"), f, "", f"NOT(IsCWT_{f})", "Ch135_Per_Stop*In_Stops-1", f"Span_{f}", None,
        "3 x stops - 1 per glass face. Replaced by the bracket channel on the counterweight face.")
for f in SIDE:
    add(S, *fixed("R4-V135-12"), f, "", f"NOT(IsCWT_{f})", "Ch135_Per_Stop*In_Stops-1", f"Span_{f}+Cover_135", None,
        "Channel + 38, one per 135 channel.")
add(S, *fixed("R4-C135-30B"), "=In_CWT", "", 'OR(In_CWT="LEFT",In_CWT="RIGHT",In_CWT="BACK")',
    "Ch135_Per_Stop*In_Stops-1", "Span_CWT", None, "On the counterweight face, where the counterweight rail brackets fix.")
for f in SIDE + ["FRONT"]:
    add(S, *cwt_pick(f, "R4-CTP-30B", "R4-CTP-30"), f, "", "TRUE", "1", f"Span_{f}", None,
        "Top frame, one per face (own profile).")

S = "Overhead ring"
for f in SIDE + ["FRONT"]:
    add(S, *cwt_pick(f, "R4-CRG-30B", "R4-CRG-15"), f, "", "TRUE", "1", f"Span_{f}", None,
        "One ring channel per face closing the overhead (own profile).")
for f in SIDE:
    add(S, *fixed("R4-VRG-12"), f, "", f"NOT(IsCWT_{f})", "1", f"Span_{f}+Cover_135", None,
        "Channel + 38. None on the counterweight face or the front.")

S = "Doors and plates"
for code in ["R4-DLP-R", "R4-DPC-R", "R4-LNT-R", "R4-DLP-L", "R4-DPC-L", "R4-LNT-L"]:
    c, part = fixed(code)
    if code == "R4-DLP-R":
        part = f'="{NAME[code]} · opening "&In_DoorOpening'
    add(S, c, part, "", "", "TRUE", "In_Stops", None, None, "One per landing. Both hands: the door has a jamb on each side.")
add(S, *fixed("R4-CHD"), "", "", "TRUE", "In_Stops", None, None, "One per landing.")
add(S, *fixed("R4-CDW"), "", "", "TRUE", "In_Stops", None, None, "One per landing.")
add(S, *fixed("R4-P122"), "", "", "TRUE", "Plate122_Per_Job", None, None, "Fixed per job.")
add(S, *fixed("R4-P124"), "", "", "TRUE", "Plate124_Per_Bracket*(Ch135_Per_Stop*In_Stops-1)", None, None,
    "2 per 135 bracket channel.")
add(S, *fixed("R4-PJX"), "", "", "TRUE", "JointHex_Per_Stop*In_Stops", None, None, "Per landing.")
add(S, *fixed("R4-PJH"), "", "", "TRUE", "JointHole_Per_Stop*In_Stops", None, None, "Per landing.")

first = HR + 1
last_parts = HR + len(rows)
# Fastener totals read the parts above them (named range stops before the fasteners).
QTY = "PL_Qty"
CODE = "PL_Code"


def cnt(pattern):
    return f'SUMIFS({QTY},{CODE},"{pattern}")'


CH135_FAMILY = f"({cnt('R4-C135*')}+{cnt('R4-CTP*')}+{cnt('R4-CRG*')})"
m8 = (f"M8_Ch170*{cnt('R4-C170*')}+M8_Ch135*{CH135_FAMILY}"
      f"+M8_Lintel*{cnt('R4-LNT*')}+M8_Post_Per_Stop*In_Stops+M8_Post_Top")
m5 = (f"M5_Sill_Ground+M5_Sill*(In_Stops-1)+M5_Cover*{cnt('R4-V*')}"
      f"+M5_Ch170*{cnt('R4-C170*')}+M5_Ch135*{CH135_FAMILY}"
      f"+M5_DeadWeight*{cnt('R4-CDW')}+M5_DoorPost_DLock*{cnt('R4-DLP*')}"
      f"+M5_DoorPost_Clad*{cnt('R4-DPC*')}+M5_Lintel*{cnt('R4-LNT*')}")
S = "Fasteners"
add(S, *fixed("R4-B830"), "", "", "TRUE", m8, None, None, "Counted from the parts above using the M8 per-part figures on Rules.")
add(S, *fixed("R4-RN8"), "", "", "TRUE", "Total_M8", None, None, "One per M8 bolt.")
add(S, *fixed("R4-S520"), "", "", "TRUE", m5, None, None, "Counted from the parts above using the M5 per-part figures on Rules.")
add(S, *fixed("R4-RN5"), "", "", "TRUE", "Total_M5", None, None, "One per M5 screw.")

for i, (sec, code, part, face, lv, need, qty, ln, wd, rule) in enumerate(rows, first):
    # Piece mark = code · face-level · size, e.g. "R4-C135-15 · B · 1400".
    # &"" keeps an empty cell as text (a bare reference to it reads as 0).
    pos = f'IF(D{i}&""="",E{i}&"",IF(E{i}&""="",LEFT(D{i},1),LEFT(D{i},1)&"-"&E{i}))'
    size = f'IF(H{i}="","",IF(I{i}="",H{i}&"",H{i}&" × "&I{i}))'
    mark = f'=IF(F{i}="YES",B{i}&IF({pos}="",""," · "&{pos})&IF({size}="",""," · "&{size}),"")'
    vals = [sec, f"={code}", part, face, lv,
            f'=IF({need},"YES","no")',
            f'=IF(F{i}="YES",{qty},0)',
            f'=IF(F{i}="YES",{ln},"")' if ln else "",
            f'=IF(F{i}="YES",{wd},"")' if wd else "",
            mark,
            rule]
    for col, v in enumerate(vals, 1):
        c = ws.cell(row=i, column=col, value=v)
        c.border = BOX
        if col in (2, 6, 7, 8, 9, 10):
            c.fill = GREY
    if code == '"R4-B830"':
        name("Total_M8", f"'Part List'!$G${i}")
    if code == '"R4-S520"':
        name("Total_M5", f"'Part List'!$G${i}")
name(QTY, f"'Part List'!$G${first}:$G${last_parts}")
name(CODE, f"'Part List'!$B${first}:$B${last_parts}")
end = HR + len(rows)
ws.auto_filter.ref = f"A{HR}:K{end}"
ws.freeze_panes = ws.cell(row=HR + 1, column=4)
ws.conditional_formatting.add(f"A{first}:K{end}", FormulaRule(formula=[f'$F{first}="no"'], font=Font(color="A6A6A6")))
t = end + 2
ws.cell(row=t, column=3, value="Total pieces (needed lines)").font = BOLD
ws.cell(row=t, column=7, value=f"=SUM(G{first}:G{end})").font = BOLD

# ---------------------------------------------------------------- Checks
ws = wb.create_sheet("Checks")
header(ws, 1, ["Check", "Result", "What to do"], [60, 10, 80])
checks = [
    ("Width and depth are filled", "AND(In_Width>Face_Deduct,In_Depth>Face_Deduct)", "Enter the external width and depth."),
    ("Number of stops is 2 to 6", "AND(In_Stops>=2,In_Stops<=6,In_Stops=INT(In_Stops))", "The sheet has five floor heights, so at most 6 stops."),
    ("Counterweight side is BACK, LEFT or RIGHT", 'OR(In_CWT="BACK",In_CWT="LEFT",In_CWT="RIGHT")',
     "Pick from the list. A hydraulic lift has no counterweight - pick the rail side."),
    ("Pit depth is 0 or more", "In_Pit>=0", "Enter the pit depth (0 is allowed)."),
    ("Overhead is more than Min_Overhead", "In_Overhead>Min_Overhead", "Below this the overhead cladding has no height."),
]
for k, lv in enumerate(LV, 1):
    checks.append((f"Floor height {k} (In_Rise{k}) is filled when the job has {k + 1}+ stops",
                   f"OR(In_Stops<{k + 1},In_Rise{k}>0)", "A job with N stops needs N-1 floor heights."))
    checks.append((f"Floor height {k} clears its minimum (Levels sheet)",
                   f"OR(In_Stops<{k + 1},In_Rise{k}>=MinRise_{lv})", "Below the minimum the extension panels would be negative."))
    checks.append((f"Floor height {k} is empty when the job has fewer stops",
                   f"OR(In_Stops>={k + 1},In_Rise{k}=0)", "Clear it (it is ignored, but probably a typo)."))
checks.append(("Door opening is one of the listed options", "OR(In_DoorOpening=\"\",COUNTIF(List_DoorOpening,In_DoorOpening)>0)",
               "Pick from the list (it only labels the D-locking post)."))
for i, (what, f, todo) in enumerate(checks, 2):
    ws.cell(row=i, column=1, value=what).border = BOX
    c = ws.cell(row=i, column=2, value=f'=IF({f},"OK","CHECK")')
    c.border, c.fill = BOX, GREY
    ws.cell(row=i, column=3, value=todo).border = BOX
n = len(checks) + 1
ws.conditional_formatting.add(f"B2:B{n}", FormulaRule(formula=['B2="CHECK"'], fill=PatternFill("solid", fgColor="F8CBAD"), font=Font(bold=True, color="9C0006")))
ws.conditional_formatting.add(f"B2:B{n}", FormulaRule(formula=['B2="OK"'], fill=PatternFill("solid", fgColor="C6EFCE")))
ws.cell(row=n + 2, column=1, value="All checks").font = BOLD
ws.cell(row=n + 2, column=2, value=f'=IF(COUNTIF(B2:B{n},"CHECK")=0,"OK","CHECK")').font = BOLD

# ---------------------------------------------------------------- Catalog
ws = wb.create_sheet("Catalog")
header(ws, 1, ["Code", "Name", "Family"], [18, 52, 10])
for i, c in enumerate(cat, 2):
    for col, v in enumerate([c["code"], c["name"], c["family"]], 1):
        ws.cell(row=i, column=col, value=v).border = BOX
r = len(cat) + 3
for t in [
    "CODE says what the part IS: profile, thickness, hand. Two pieces share a code only if they can be swapped.",
    "  R4-<PART>[-<thickness>][B]   thickness: 15 = 1.5 mm, 30 = 3 mm, 12 = 1.2 mm, 6 = 6 mm.  B = bracket version (counterweight face).",
    "  Corner parts end in the corner (FL, FR, BL, BR); door parts in the hand (R, L).",
    "PIECE MARK says where it goes and its size: code · face-level · size, e.g. R4-C135-15 · B · 1400 or R4-SH-12 · L-GND · 986 × 1350.",
    "  Faces: F front (door), B back, L left, R right.  Levels: PIT, GND, 1ST-4TH, OH (overhead), MOD (2450 module panel).",
    "NAME: <noun> <size> · <variant> · <thickness>, noun first so an A-Z sort keeps channels, covers, posts and plates together.",
]:
    ws.cell(row=r, column=1, value=t)
    r += 1

# ---------------------------------------------------------------- Changes
ws = wb.create_sheet("Changes")
header(ws, 1, ["What", "Old workbook", "Now", "Source"], [34, 34, 40, 40])
changes = [
    ("Ground floor extension", "H1 - 2450 (- (170 - P) on a shallow pit)", "H1 + P - 67.5 - pit piece - 2450", "Owner workbook K8"),
    ("4th floor extension", "H5 - 2450 - 35", "H5 - 2450", "Owner workbook S8 / Rules Book"),
    ("Extension glass height", "extension - 100", "extension - 97", "Rules Book (handwritten)"),
    ("Glass width", "face - 200 + 35 (six cells +38, one C4-135)", "face span + 35 everywhere", "Rules Book (20.5 + 20.5 - 6)"),
    ("Extension cladding height", "extension - 135", "extension - 142", "Rules Book (handwritten)"),
    ("Overhead cladding height", "OH - 2592", "overhead extension - 202.5 (= OH - 2615)", "Rules Book (handwritten)"),
    ("Module cladding", "2F x 1090", "1 x 1062 + (2F - 1) x 1090 per face", "Rules Book (handwritten)"),
    ("Cover lengths", "channel + 40", "170: + 9, 135: + 38", "Rules Book 'Glass cover' page"),
    ("Joint plate hex", "8F", "12F", "Rules Book (handwritten)"),
    ("M8 / M5 bolts, screws, rivnuts", "52F / 203F", "counted from the parts (Rules sheet)", "Rules Book (handwritten)"),
    ("Sill channel 142", "listed twice (channels + 2450 module)", "listed once", "Same part"),
    ("Floors that do not exist", "negative lengths / quantities", "Needed = no", "Rules Book slip 15"),
    ("Panel quantities on non-panel faces", "flat 1 / 2F-1 / 2F on every face", "only on faces that get the panel", "Slips 17-18"),
    ("Back / front widths", "used depth, or blank E5 (-200)", "width - 200", "Slips 2-5"),
    ("4TH back glass / 1ST back glass (CWT RIGHT) / 4TH left glass", "C4-135 / NO / missing cell", "span + 35", "Slips 6-8"),
    ("Left / right covers, top channels", "used W, no +allowance, blank when CWT BACK", "face span + allowance; always a length", "Slips 9-13"),
    ("Bracket tags, text quantities, #VALUE!", "tested wrong cell / text / errors", "code ends in B; numeric quantities", "Slips 1, 14"),
    ("Part names and codes", "workbook row text (e.g. HZ CH LEFT COVER 170 (1.2MM))", "item codes + tidy names + piece marks (Catalog sheet)", "Owner, 3 Oct 2026"),
    ("Corner post extensions", "one line x 4 per level", "one line per corner per level (mirrored parts)", "Owner, 3 Oct 2026"),
]
for i, row in enumerate(changes, 2):
    for col, v in enumerate(row, 1):
        c = ws.cell(row=i, column=col, value=v)
        c.border, c.alignment = BOX, WRAP

wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
print("rows", len(rows), "->", OUT)
