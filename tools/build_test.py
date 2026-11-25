"""Build a separate TEST copy of the app (dist-test/) for its own repository and GitHub Pages site.

The test copy lives on the same github.io origin as the real app, so it keeps its own storage:
localStorage keys "linkiqtest.*", IndexedDB "linkiq-test", its own cache, and the name
"LinkIQ TEST" with an orange bar, so nobody mistakes it for the app the installers use.

    python tools/build_test.py
"""
import json, pathlib, re, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "frontend", ROOT / "dist-test"

shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(SRC, OUT, ignore=shutil.ignore_patterns("staticwebapp.config.json"))

def edit(name, pairs):
    p = OUT / name
    s = p.read_text(encoding="utf-8")
    for a, b in pairs:
        if a not in s:
            raise SystemExit(f"{name}: '{a}' not found")
        s = s.replace(a, b)
    p.write_text(s, encoding="utf-8")

edit("app.js", [
    ("'linkiq.' + k", "'linkiqtest.' + k"),
    ("localStorage.setItem('linkiq.probe', '1'); storageWorks = localStorage.getItem('linkiq.probe') === '1';",
     "localStorage.setItem('linkiqtest.probe', '1'); storageWorks = localStorage.getItem('linkiqtest.probe') === '1';"),
    ("indexedDB.open('linkiq', 1)", "indexedDB.open('linkiq-test', 1)"),
    ("$('ver').textContent = 'v' + VERSION;", "$('ver').textContent = 'v' + VERSION + ' TEST';"),
])
edit("sw.js", [("const VERSION = 'linkiq-shell-", "const VERSION = 'linkiq-test-shell-")])
m = json.loads((OUT / "manifest.webmanifest").read_text(encoding="utf-8"))
m.update(name="LinkIQ TEST", short_name="LinkIQ TEST", theme_color="#b34700", background_color="#b34700",
         # a normal Chrome tab from the home-screen icon: VVS-dialog then opens in a real tab with
         # address bar (li) and stays linked to LinkIQ (the report files are handed over directly)
         display="browser")
(OUT / "manifest.webmanifest").write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
edit("index.html", [("<title>", "<title>TEST · ")])
(OUT / "styles.css").open("a", encoding="utf-8").write("\n/* test copy */\nheader { background: #b34700 !important; }\n")
print(f"{OUT.relative_to(ROOT)}: test copy ready")
