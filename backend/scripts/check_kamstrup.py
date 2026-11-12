#!/usr/bin/env python3
"""One read-only request to the real Kamstrup endpoint, to check connectivity from
this machine and to see what the adapter understands.

    python scripts/check_kamstrup.py 12345678
"""
from __future__ import annotations

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Settings  # noqa: E402
from app.kamstrup import normalise  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].isalnum():
        print(__doc__)
        return 2
    cfg = Settings()
    url = f"{cfg.kamstrup_base_url.rstrip('/')}/{sys.argv[1]}"
    r = httpx.get(url, timeout=cfg.kamstrup_timeout_s,
                  headers={"Accept": "application/json", "Origin": "https://example.org"})
    print(f"HTTP {r.status_code} from {url}")
    cors = r.headers.get("access-control-allow-origin")
    print(f"Browser access (CORS): {'allowed for ' + cors if cors else 'not allowed -> the proxy is required'}")
    if r.status_code != 200:
        print(r.text[:500])
        return 1
    data = r.json()
    raw = data.get("Links") or []
    links = normalise(data)
    print(f"Top-level keys: {', '.join(data.keys())}")
    if raw:
        print(f"Link keys:      {', '.join(raw[0].keys())}")
    print(f"Links in response: {len(raw)}, understood: {len(links)}")
    for l in sorted(links, key=lambda x: -x.rssi_dbm):
        print(f"  {l.concentrator_serial:>12}  {l.rssi_dbm:>5} dBm  {l.timestamp_raw or '(no timestamp)'}")
    return 0 if len(links) == len(raw) else 1


if __name__ == "__main__":
    raise SystemExit(main())
