"""
Verify (and optionally fix) operations.machining_time_seconds against each
program's TruTops PDF sketch.

Ground truth = the single "H : MM : SS [h:min:s]" total printed on every report.
For all programs that have a sketch we download the PDF, read that total, and
compare it to the stored value.

  python scripts/verify-machining-time.py            # dry run: report only
  python scripts/verify-machining-time.py --apply    # also correct the DB

Credentials: env SUPABASE_URL + SUPABASE_ANON_KEY (or SERVICE key), else read
from .env.local (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).

Exit code is always 0 (a scheduled run should not be treated as "failed" just
because it found drift). The summary — including every correction — is printed
to stdout so the scheduler's log captures it.
"""
import os, re, sys, json, io, urllib.request, urllib.error, concurrent.futures, datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import fitz  # PyMuPDF

APPLY = "--apply" in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _creds():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if url and key:
        return url.rstrip("/"), key
    env_path = os.path.join(ROOT, ".env.local")
    txt = open(env_path, "r", encoding="utf-8").read()
    def g(k):
        m = re.search(rf"^{k}=(.*)$", txt, re.M)
        return m.group(1).strip() if m else None
    url = url or g("NEXT_PUBLIC_SUPABASE_URL")
    key = key or g("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not (url and key):
        raise SystemExit("Supabase credentials not found (env or .env.local).")
    return url.rstrip("/"), key


URL, KEY = _creds()
HDRS = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
TIME_RE = re.compile(r"(\d+)\s*:\s*(\d+)\s*:\s*(\d+)\s*\[h:min:s\]")


def fetch_ops():
    req = urllib.request.Request(
        f"{URL}/rest/v1/operations?select=id,code,name,machining_time_seconds,sketch_url"
        f"&sketch_url=not.is.null&order=code",
        headers=HDRS,
    )
    return json.load(urllib.request.urlopen(req, timeout=60))


def pdf_seconds(sketch_url):
    data = urllib.request.urlopen(sketch_url, timeout=120).read()
    doc = fitz.open(stream=data, filetype="pdf")
    text = "\n".join(p.get_text() for p in doc)
    doc.close()
    secs = sorted({int(h) * 3600 + int(m) * 60 + int(s) for h, m, s in TIME_RE.findall(text)})
    return secs  # [] none, [n] good, [a,b,..] ambiguous


def classify(op):
    out = {"id": op["id"], "code": op["code"], "stored": op["machining_time_seconds"]}
    try:
        secs = pdf_seconds(op["sketch_url"])
        if not secs:
            out["status"] = "no_time_in_pdf"
        elif len(secs) > 1:
            out["status"] = "ambiguous"
            out["pdf_candidates"] = secs
        else:
            out["pdf"] = secs[0]
            if op["machining_time_seconds"] is None:
                out["status"] = "fill"
            elif int(op["machining_time_seconds"]) != secs[0]:
                out["status"] = "mismatch"
            else:
                out["status"] = "ok"
    except Exception as e:
        out["status"] = "error"
        out["error"] = str(e)[:200]
    return out


def apply_fix(op_id, secs):
    body = json.dumps({"machining_time_seconds": secs}).encode()
    req = urllib.request.Request(
        f"{URL}/rest/v1/operations?id=eq.{op_id}",
        data=body, method="PATCH",
        headers={**HDRS, "Content-Type": "application/json", "Prefer": "return=minimal"},
    )
    urllib.request.urlopen(req, timeout=60).read()


def mmss(s):
    return f"{int(s)//60}:{int(s)%60:02d}" if s is not None else "—"


def main():
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ops = fetch_ops()
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(classify, ops))

    by = {}
    for r in results:
        by.setdefault(r["status"], []).append(r)

    changes = by.get("mismatch", []) + by.get("fill", [])
    applied, failed = [], []
    if APPLY:
        for r in changes:
            try:
                apply_fix(r["id"], r["pdf"])
                applied.append(r)
            except Exception as e:
                r["apply_error"] = str(e)[:200]
                failed.append(r)

    print(f"[{stamp}] machining-time check  mode={'APPLY' if APPLY else 'dry-run'}  "
          f"programs={len(ops)}")
    print(f"  ok={len(by.get('ok', []))}  mismatch={len(by.get('mismatch', []))}  "
          f"fill={len(by.get('fill', []))}  ambiguous={len(by.get('ambiguous', []))}  "
          f"no_time={len(by.get('no_time_in_pdf', []))}  error={len(by.get('error', []))}")

    for r in sorted(by.get("mismatch", []), key=lambda r: r["code"]):
        tag = "FIXED" if (APPLY and r in applied) else ("FAILED" if APPLY else "would fix")
        print(f"  [{tag}] {r['code']:40} {mmss(r['stored'])} -> {mmss(r['pdf'])}")
    for r in sorted(by.get("fill", []), key=lambda r: r["code"]):
        tag = "FILLED" if (APPLY and r in applied) else ("FAILED" if APPLY else "would fill")
        print(f"  [{tag}] {r['code']:40} (blank) -> {mmss(r['pdf'])}")
    for r in by.get("ambiguous", []):
        print(f"  [AMBIGUOUS] {r['code']:40} pdf has multiple times {r['pdf_candidates']} — left as-is")
    for r in by.get("no_time_in_pdf", []):
        print(f"  [NO-TIME] {r['code']:40} no [h:min:s] found in PDF — left as-is")
    for r in by.get("error", []):
        print(f"  [ERROR] {r['code']:40} {r.get('error')}")
    for r in failed:
        print(f"  [APPLY-FAILED] {r['code']:40} {r.get('apply_error')}")

    if not changes:
        print("  no drift — all machining times match their PDFs.")

    # Signal counts to the GitHub Actions step (so the workflow only pings you
    # when something actually changed or needs a look). No-op outside CI.
    gho = os.environ.get("GITHUB_OUTPUT")
    if gho:
        with open(gho, "a", encoding="utf-8") as f:
            f.write(f"applied={len(applied)}\n")
            f.write(f"ambiguous={len(by.get('ambiguous', []))}\n")
            f.write(f"errors={len(by.get('error', [])) + len(failed)}\n")

    # Machine-readable artifact next to the script (handy for a follow-up read).
    json.dump(
        {"stamp": stamp, "apply": APPLY, "summary": {k: len(v) for k, v in by.items()},
         "applied": [{"code": r["code"], "stored": r["stored"], "pdf": r["pdf"]} for r in applied]},
        open(os.path.join(HERE, "_study", "mt-last-run.json"), "w", encoding="utf-8")
        if os.path.isdir(os.path.join(HERE, "_study")) else io.StringIO(),
        indent=2,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
