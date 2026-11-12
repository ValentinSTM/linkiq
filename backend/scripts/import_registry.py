#!/usr/bin/env python3
"""Import the Site and Concentrator registry from CSV (export the two Excel/SharePoint
site list and the concentrator list as CSV first).

    python scripts/import_registry.py --db linkiq.sqlite3 \
        --sites data/sites.sample.csv --concentrators data/concentrators.sample.csv

Rules from the handoff:
  * Breddegrad = latitude, Længdegrad = longitude.
  * Concentrators are mapped to sites only through an explicit site code.
    Nothing is guessed: an unknown or missing site code is flagged, not deleted.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db import Database  # noqa: E402

ALIASES = {
    "site_code": ["sitecode", "site_code", "site", "sitenr", "site nr", "siteid"],
    "name": ["name", "sitename", "navn"],
    "address": ["address", "adresse"],
    "latitude": ["latitude", "lat", "breddegrad"],
    "longitude": ["longitude", "lon", "lng", "længdegrad", "laengdegrad"],
    "status": ["status"],
    "serial": ["serialnumber", "serial", "serienummer", "concentratorserial"],
    "device_type": ["devicetype", "type"],
    "firmware": ["firmware", "fw"],
    "active": ["active", "aktiv"],
}


def read(path: str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        sample = fh.read(4096)
        fh.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        return [
            {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
            for row in csv.DictReader(fh, dialect=dialect)
        ]


def pick(row: dict[str, str], field: str) -> str:
    return next((row[a] for a in ALIASES[field] if row.get(a)), "")


def number(text: str) -> float | None:
    try:
        return float(text.replace(",", "."))  # Danish decimal comma
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="linkiq.sqlite3")
    ap.add_argument("--sites")
    ap.add_argument("--concentrators")
    args = ap.parse_args()
    db = Database(args.db)
    review = 0
    with db.tx() as c:
        if args.sites:
            for row in read(args.sites):
                code = pick(row, "site_code")
                if not code:
                    continue
                lat, lon = number(pick(row, "latitude")), number(pick(row, "longitude"))
                status = pick(row, "status") or "ACTIVE"
                ok = lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180
                if not ok:
                    lat = lon = None
                    status = "MISSING_LOCATION"
                    review += 1
                    print(f"  site {code}: missing/invalid coordinates -> MISSING_LOCATION")
                c.execute(
                    "INSERT INTO sites(site_code, name, address, latitude, longitude, status, ranking_eligible) "
                    "VALUES (?,?,?,?,?,?,?) ON CONFLICT(site_code) DO UPDATE SET name=excluded.name, "
                    "address=excluded.address, latitude=excluded.latitude, longitude=excluded.longitude, "
                    "status=excluded.status, ranking_eligible=excluded.ranking_eligible",
                    (code, pick(row, "name"), pick(row, "address"), lat, lon, status, int(ok)),
                )
        known = {r[0] for r in c.execute("SELECT site_code FROM sites")}
        if args.concentrators:
            for row in read(args.concentrators):
                serial = pick(row, "serial")
                if not serial:
                    continue
                code = pick(row, "site_code") or None
                status = pick(row, "status") or "ACTIVE"
                if code is None:
                    status = "MISSING_LOCATION"
                elif code not in known:
                    status, code = "REVIEW", None
                if status in ("REVIEW", "MISSING_LOCATION"):
                    review += 1
                    print(f"  concentrator {serial}: no trusted site mapping -> {status}")
                active = pick(row, "active").lower() not in ("0", "false", "nej", "no")
                c.execute(
                    "INSERT INTO concentrators(serial, site_code, device_type, firmware, status, active) "
                    "VALUES (?,?,?,?,?,?) ON CONFLICT(serial) DO UPDATE SET site_code=excluded.site_code, "
                    "device_type=excluded.device_type, firmware=excluded.firmware, status=excluded.status, "
                    "active=excluded.active",
                    (serial, code, pick(row, "device_type"), pick(row, "firmware"), status, int(active)),
                )
        n_sites = c.execute("SELECT COUNT(*) FROM sites").fetchone()[0]
        n_conc = c.execute("SELECT COUNT(*) FROM concentrators").fetchone()[0]
    print(f"Registry now holds {n_sites} sites and {n_conc} concentrators ({review} need review).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
