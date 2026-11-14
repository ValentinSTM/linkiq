#!/usr/bin/env python3
"""Pack the whole app into ONE file.

    python tools/build_single.py
        -> dist/linkiq.html                 the public app, no data inside

    python tools/build_single.py --sites linkiq_sites.csv --concentrators linkiq_koncentratorer.csv --out ../linkiq-med-register.html
        -> the same app with YOUR registry built in: installers import nothing,
           and it also works when the file is opened straight from the phone.
           This file contains your concentrator locations: do NOT publish it
           (keep it out of the public repository and of GitHub Pages).
"""
from pathlib import Path
import argparse, hashlib, json, re
from datetime import date

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / "frontend"


def js(name: str) -> str:
    return (FRONT / name).read_text(encoding="utf-8").replace("</script", "<\\/script")


def read_csv(path: str) -> str:
    raw = Path(path).read_bytes()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252")          # CSV saved by Excel


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites")
    ap.add_argument("--concentrators")
    ap.add_argument("--out")
    args = ap.parse_args()
    if bool(args.sites) != bool(args.concentrators):
        ap.error("give both --sites and --concentrators, or neither")

    html = (FRONT / "index.html").read_text(encoding="utf-8")
    css = (FRONT / "vendor/leaflet.css").read_text(encoding="utf-8") + "\n" + (FRONT / "styles.css").read_text(encoding="utf-8")
    html = re.sub(r'<link rel="(manifest|icon|apple-touch-icon|stylesheet)"[^>]*>\n?', "", html)
    html = html.replace("</head>", "<style>\n" + css + "\n</style>\n</head>")
    registry = ""
    if args.sites:
        sites, conc = read_csv(args.sites), read_csv(args.concentrators)
        data = {"sites": sites, "concentrators": conc, "built": date.today().isoformat(),
                "version": hashlib.sha1((sites + conc).encode("utf-8")).hexdigest()[:12]}
        registry = "<script>\nwindow.LINKIQ_REGISTRY = " + json.dumps(data, ensure_ascii=False).replace("</", "<\\/") + ";\n</script>\n"
    for name in ("vendor/leaflet.js", "i18n.js", "engine.js", "app.js"):
        tag = f'<script src="{name}"></script>'
        assert tag in html, name
        extra = "<script>\n" + js("vendor/jsQR.js") + "\n</script>\n" if name == "engine.js" else ""
        if name == "app.js":
            extra += registry
        html = html.replace(tag, extra + "<script>\n" + js(name) + "\n</script>")
    out = Path(args.out) if args.out else ROOT / "dist" / "linkiq.html"
    if args.sites and not args.out:
        ap.error("--out is required with a built-in registry, so the file is not written into the public dist/ by mistake")
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"{out}  {out.stat().st_size // 1024} KB" + ("  (registry built in: do not publish)" if args.sites else ""))


if __name__ == "__main__":
    main()
