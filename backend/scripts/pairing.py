#!/usr/bin/env python3
"""Manage pairing codes (one per installer/phone).

    python scripts/pairing.py add --name Ana --url https://linkiq.example.org
    python scripts/pairing.py list
    python scripts/pairing.py revoke --name Ana

"add" prints a pairing link and writes a QR code (pair-<name>.svg). The installer
scans it once with the phone camera; the app opens already paired. The code sits in
the URL fragment (#pair=...), which browsers never send to the server or its logs.
Only a hash of the code is stored, so the link cannot be shown again: issue a new one.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Settings  # noqa: E402
from app.db import Database  # noqa: E402
from app.service import Service  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["add", "list", "revoke"])
    ap.add_argument("--name")
    ap.add_argument("--url", default="http://localhost:8000", help="public address of this instance")
    ap.add_argument("--db", default=os.environ.get("LINKIQ_DB_PATH", "linkiq.sqlite3"))
    args = ap.parse_args()
    svc = Service(Settings(db_path=args.db), Database(args.db), gateway=None)  # type: ignore[arg-type]

    if args.action == "list":
        for r in svc.list_access_codes():
            print(f"{r['created_utc']}  {'RETRAS' if r['revoked'] else 'activ '}  {r['name']}")
        return 0
    if not args.name:
        ap.error("--name is required")
    if args.action == "revoke":
        print(f"{svc.revoke_access_codes(args.name)} code(s) revoked for {args.name}")
        return 0

    code = svc.add_access_code(args.name)
    link = f"{args.url.rstrip('/')}/#pair={code}"
    print(f"Pairing link for {args.name} (shown only once):\n  {link}")
    try:
        import segno

        out = f"pair-{''.join(ch for ch in args.name if ch.isalnum()) or 'code'}.svg"
        segno.make(link, error="m").save(out, scale=8, border=3)
        print(f"QR code written to {out}")
    except ImportError:
        print("(install 'segno' to also get a QR code)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
