#!/usr/bin/env python3
"""Pack the whole app into ONE file: dist/linkiq.html.

A phone that opens index.html from its storage cannot load the neighbouring
.css/.js files, so the page comes up bare and dead. The single file has
everything inside and can be copied, e-mailed or hosted as it is.

    python tools/build_single.py
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / "frontend"


def js(name: str) -> str:
    return (FRONT / name).read_text(encoding="utf-8").replace("</script", "<\\/script")


def main() -> None:
    html = (FRONT / "index.html").read_text(encoding="utf-8")
    css = (FRONT / "vendor/leaflet.css").read_text(encoding="utf-8") + "\n" + (FRONT / "styles.css").read_text(encoding="utf-8")
    html = re.sub(r'<link rel="(manifest|icon|apple-touch-icon|stylesheet)"[^>]*>\n?', "", html)
    html = html.replace("</head>", "<style>\n" + css + "\n</style>\n</head>")
    for name in ("vendor/leaflet.js", "i18n.js", "engine.js", "app.js"):
        tag = f'<script src="{name}"></script>'
        assert tag in html, name
        extra = "<script>\n" + js("vendor/jsQR.js") + "\n</script>\n" if name == "engine.js" else ""
        html = html.replace(tag, extra + "<script>\n" + js(name) + "\n</script>")
    out = ROOT / "dist" / "linkiq.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"{out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
