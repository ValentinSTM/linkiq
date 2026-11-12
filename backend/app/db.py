"""SQLite persistence (Python standard library, no licence, no separate server)."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS sites (
    site_code        TEXT PRIMARY KEY,
    name             TEXT,
    address          TEXT,
    latitude         REAL,
    longitude        REAL,
    status           TEXT NOT NULL DEFAULT 'ACTIVE',
    ranking_eligible INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS concentrators (
    serial      TEXT PRIMARY KEY,
    site_code   TEXT,
    device_type TEXT,
    firmware    TEXT,
    status      TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | REVIEW | MISSING_LOCATION | ...
    active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
    id               TEXT PRIMARY KEY,
    meter_serial     TEXT NOT NULL,
    technician       TEXT NOT NULL,
    gps_lat          REAL,
    gps_lon          REAL,
    gps_accuracy_m   REAL,
    started_utc      TEXT NOT NULL,
    finished_utc     TEXT,
    heartbeat_utc    TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | COMPLETED | ABORTED
    state            TEXT NOT NULL DEFAULT 'READY',    -- READY | WAIT_RF | MEASURED | COMPLETE
    initial_call_utc TEXT,
    final_call_utc   TEXT,
    outcome          TEXT,
    note             TEXT,
    decision_json    TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_meter ON sessions(meter_serial, status);

CREATE TABLE IF NOT EXISTS samples (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id             TEXT NOT NULL REFERENCES sessions(id),
    phase                  TEXT NOT NULL,              -- coarse | fine | final
    step                   INTEGER NOT NULL,
    heading_deg            REAL,
    movement_completed_utc TEXT NOT NULL,
    skipped                INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_samples_session ON samples(session_id);

CREATE TABLE IF NOT EXISTS observations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id          TEXT NOT NULL REFERENCES sessions(id),
    sample_id           INTEGER REFERENCES samples(id),
    meter_serial        TEXT NOT NULL,
    concentrator_serial TEXT NOT NULL,
    site_code           TEXT,
    observed_utc        TEXT,                          -- source timestamp, may be NULL
    received_utc        TEXT NOT NULL,                 -- when this server saw it
    rssi_dbm            INTEGER NOT NULL,
    lqi                 INTEGER,
    fingerprint         TEXT NOT NULL,
    owned               INTEGER NOT NULL,
    kind                TEXT NOT NULL,                 -- baseline | fresh | stale
    UNIQUE(session_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS ix_obs_session ON observations(session_id, kind);

-- Pairing codes. Only the SHA-256 of a code is stored.
CREATE TABLE IF NOT EXISTS access_codes (
    code_hash   TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_utc TEXT NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0
);
"""


class Database:
    def __init__(self, path: str):
        self.path = path
        with self.tx() as c:
            c.executescript(SCHEMA)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
