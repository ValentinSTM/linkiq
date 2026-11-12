"""Session workflow, freshness detection and scoring.

Rules implemented from the technical handoff:
  * HTTP 200 is not a measurement. An observation is new only if its fingerprint
    (serial|timestamp|rssi) has never been processed in this session.
  * A baseline is captured when CALL is confirmed.
  * Every fresh observation is persisted immediately (rolling snapshot upstream).
  * An observation belongs to the antenna position that was stable when it was
    generated: source timestamps older than "movement completed" are kept but
    marked stale; missing timestamps are accepted and flagged.
  * All owned receivers are kept, weak ones included. Primary and redundancy are
    scored separately.
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any

from . import geo
from .config import Settings
from .db import Database
from .kamstrup import Clock, KamstrupGateway, Link, UpstreamError, iso, parse_ts, utcnow

OUTCOMES = [
    "OPTIMAL_CONFIRMED",
    "GOOD_WITH_SITE_REDUNDANCY",
    "GOOD_WITH_EQUIPMENT_REDUNDANCY",
    "GOOD_PRIMARY_ONLY",
    "MARGINAL",
    "NO_RELIABLE_LINK",
    "INCONCLUSIVE",
    "ABORTED",
]
_METER_RE = re.compile(r"^[0-9A-Za-z]{4,20}$")
FINE_OFFSETS_DEG = [-24, -12, 0, 12, 24]  # left edge, left half, centre, right half, right edge


class LinkIQError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


class Service:
    def __init__(self, settings: Settings, db: Database, gateway: KamstrupGateway, clock: Clock = utcnow):
        self.cfg, self.db, self.gw, self.clock = settings, db, gateway, clock

    # ------------------------------------------------------------------ pairing
    @staticmethod
    def _hash(code: str) -> str:
        return hashlib.sha256(code.encode()).hexdigest()

    def add_access_code(self, name: str) -> str:
        """Create a pairing code for one installer/phone. Returned once, stored hashed."""
        code = secrets.token_urlsafe(18)
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO access_codes(code_hash, name, created_utc) VALUES (?,?,?)",
                (self._hash(code), name.strip(), iso(self.clock())),
            )
        return code

    def revoke_access_codes(self, name: str) -> int:
        with self.db.tx() as c:
            return c.execute("UPDATE access_codes SET revoked=1 WHERE name=? AND revoked=0", (name,)).rowcount

    def list_access_codes(self) -> list[dict]:
        with self.db.tx() as c:
            return [dict(r) for r in c.execute("SELECT name, created_utc, revoked FROM access_codes ORDER BY created_utc")]

    def check_access_code(self, code: str) -> str | None:
        if not code:
            return None
        for known, name in self.cfg.tokens.items():
            if secrets.compare_digest(code, known):
                return name
        with self.db.tx() as c:
            r = c.execute("SELECT name FROM access_codes WHERE code_hash=? AND revoked=0", (self._hash(code),)).fetchone()
        return r["name"] if r else None

    # ------------------------------------------------------------------ registry
    def registry_empty(self) -> bool:
        with self.db.tx() as c:
            return c.execute("SELECT COUNT(*) FROM concentrators").fetchone()[0] == 0

    def sites(self, lat: float | None = None, lon: float | None = None) -> list[dict[str, Any]]:
        with self.db.tx() as c:
            rows = c.execute("SELECT * FROM sites").fetchall()
            conc = c.execute("SELECT serial, site_code FROM concentrators WHERE active=1").fetchall()
        by_site: dict[str, list[str]] = {}
        for r in conc:
            by_site.setdefault(r["site_code"], []).append(r["serial"])
        out = []
        for r in rows:
            d = {
                "siteCode": r["site_code"], "name": r["name"], "address": r["address"],
                "latitude": r["latitude"], "longitude": r["longitude"], "status": r["status"],
                "rankingEligible": bool(r["ranking_eligible"]),
                "concentrators": by_site.get(r["site_code"], []),
                "distanceM": None, "bearingDeg": None, "compass": None,
            }
            if None not in (lat, lon, r["latitude"], r["longitude"]):
                d["distanceM"] = round(geo.distance_m(lat, lon, r["latitude"], r["longitude"]))
                b = geo.bearing_deg(lat, lon, r["latitude"], r["longitude"])
                d["bearingDeg"], d["compass"] = round(b), geo.compass_ro(b)
            out.append(d)
        out.sort(key=lambda d: (d["distanceM"] is None, d["distanceM"] or 0, d["siteCode"]))
        return out

    def concentrator(self, serial: str) -> dict[str, Any]:
        with self.db.tx() as c:
            r = c.execute(
                "SELECT k.*, s.name, s.address, s.latitude, s.longitude FROM concentrators k "
                "LEFT JOIN sites s ON s.site_code = k.site_code WHERE k.serial=?", (serial,)
            ).fetchone()
        if r is None:
            raise LinkIQError(404, "UNKNOWN_CONCENTRATOR", "Concentrator not in registry")
        return {
            "serialNumber": r["serial"], "siteCode": r["site_code"], "deviceType": r["device_type"],
            "firmware": r["firmware"], "status": r["status"], "active": bool(r["active"]),
            "siteName": r["name"], "address": r["address"],
            "latitude": r["latitude"], "longitude": r["longitude"],
        }

    # ------------------------------------------------------------------ sessions
    def _session(self, c, sid: str, active: bool = True):
        s = c.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
        if s is None:
            raise LinkIQError(404, "UNKNOWN_SESSION", "Session not found")
        if active and s["status"] != "ACTIVE":
            raise LinkIQError(409, "SESSION_CLOSED", "Session is already closed")
        return s

    def create_session(self, meter_serial: str, technician: str, lat=None, lon=None, accuracy=None) -> dict:
        meter_serial = (meter_serial or "").strip()
        technician = (technician or "").strip() or "necunoscut"
        if not _METER_RE.match(meter_serial):
            raise LinkIQError(422, "BAD_METER_SERIAL", "Meter serial must be 4-20 letters/digits")
        now = self.clock()
        with self.db.tx() as c:
            c.execute("BEGIN IMMEDIATE")
            cur = c.execute(
                "SELECT * FROM sessions WHERE meter_serial=? AND status='ACTIVE'", (meter_serial,)
            ).fetchall()
            for s in cur:
                alive = (now - parse_ts(s["heartbeat_utc"])).total_seconds() < self.cfg.lock_ttl_s
                if s["technician"] == technician:
                    # Same installer coming back (e.g. after losing connection): resume.
                    c.execute("UPDATE sessions SET heartbeat_utc=? WHERE id=?", (iso(now), s["id"]))
                    sid = s["id"]
                    break
                if alive:
                    raise LinkIQError(
                        409, "METER_LOCKED",
                        f"Contorul {meter_serial} este testat acum de {s['technician']}.",
                    )
                c.execute(
                    "UPDATE sessions SET status='ABORTED', outcome='ABORTED', finished_utc=?, "
                    "note='lock expired' WHERE id=?", (iso(now), s["id"]),
                )
            else:
                sid = uuid.uuid4().hex
                c.execute(
                    "INSERT INTO sessions(id, meter_serial, technician, gps_lat, gps_lon, "
                    "gps_accuracy_m, started_utc, heartbeat_utc) VALUES (?,?,?,?,?,?,?,?)",
                    (sid, meter_serial, technician, lat, lon, accuracy, iso(now), iso(now)),
                )
        return self.summary(sid)

    def call_confirmed(self, sid: str, phase: str = "initial") -> dict:
        if phase not in ("initial", "final"):
            raise LinkIQError(422, "BAD_PHASE", "phase must be initial or final")
        with self.db.tx() as c:
            s = self._session(c, sid)
        if phase == "initial":
            if s["state"] != "READY":
                raise LinkIQError(409, "BAD_STATE", "Initial CALL already confirmed")
            self._ingest(sid, as_baseline=True)  # baseline: nothing seen so far may be reused
            self.gw.adapter.notify_call(s["meter_serial"])
            self._new_sample(sid, "coarse", 1, None, call_field="initial_call_utc")
        else:
            if s["state"] == "READY":
                raise LinkIQError(409, "BAD_STATE", "Confirm the initial CALL first")
            self._ingest(sid)  # anything pending belongs to the previous position
            self.gw.adapter.notify_call(s["meter_serial"])
            self._new_sample(sid, "final", 1, None, call_field="final_call_utc")
        return self.summary(sid)

    def position_marked(self, sid: str, phase: str, step: int, heading: float | None = None) -> dict:
        limit = {"coarse": self.cfg.coarse_steps, "fine": self.cfg.fine_steps, "live": 1}.get(phase)
        if limit is None or not 1 <= step <= limit:
            raise LinkIQError(422, "BAD_POSITION", "Unknown phase/step")
        with self.db.tx() as c:
            s = self._session(c, sid)
        if s["state"] != "MEASURED":
            raise LinkIQError(409, "BAD_STATE", "Wait for the measurement (or skip) before moving")
        self._ingest(sid)
        self._new_sample(sid, phase, step, heading)
        return self.summary(sid)

    def skip(self, sid: str) -> dict:
        """Give up waiting on the current position. The empty sample is kept for analysis."""
        with self.db.tx() as c:
            s = self._session(c, sid)
            if s["state"] != "WAIT_RF":
                raise LinkIQError(409, "BAD_STATE", "Nothing to skip")
            c.execute(
                "UPDATE samples SET skipped=1 WHERE id=(SELECT MAX(id) FROM samples WHERE session_id=?)",
                (sid,),
            )
            c.execute("UPDATE sessions SET state='MEASURED' WHERE id=?", (sid,))
        return self.summary(sid)

    def _new_sample(self, sid, phase, step, heading, call_field: str | None = None) -> None:
        now = iso(self.clock())
        with self.db.tx() as c:
            s = self._session(c, sid)
            c.execute(
                "INSERT INTO samples(session_id, phase, step, heading_deg, movement_completed_utc) "
                "VALUES (?,?,?,?,?)", (sid, phase, step, heading, now),
            )
            extra = f", {call_field}=?" if call_field else ""
            args = ["WAIT_RF", now] + ([now] if call_field else []) + [sid]
            c.execute(f"UPDATE sessions SET state=?, heartbeat_utc=?{extra} WHERE id=?", args)
        # Only meaningful for the simulator; no-op for the live adapter.
        self.gw.adapter.notify_orientation(s["meter_serial"], self._sim_degrees(sid, phase, step))

    def _sim_degrees(self, sid: str, phase: str, step: int) -> float:
        sector = 360 / self.cfg.coarse_steps
        if phase == "coarse":
            return (step - 1) * sector
        summ = self.summary(sid)
        cw = summ["coarseWinner"]
        base = (cw["step"] - 1) * sector if cw else 0.0
        if phase == "fine":
            return base + FINE_OFFSETS_DEG[step - 1]
        best = summ["best"]
        if best and best["phase"] == "fine":
            return base + FINE_OFFSETS_DEG[best["step"] - 1]
        return base

    # ------------------------------------------------------------------ polling
    def _ingest(self, sid: str, as_baseline: bool = False) -> tuple[list[dict], int, str | None]:
        """Fetch the (rate-limited) snapshot and persist everything not seen before."""
        with self.db.tx() as c:
            s = self._session(c, sid)
        try:
            snap = self.gw.snapshot(s["meter_serial"])
        except UpstreamError as exc:
            return [], 0, f"UPSTREAM_ERROR: {exc}"
        now = self.clock()
        fresh: list[dict] = []
        with self.db.tx() as c:
            c.execute("BEGIN IMMEDIATE")
            seen = {r[0] for r in c.execute("SELECT fingerprint FROM observations WHERE session_id=?", (sid,))}
            owned_map = {r["serial"]: r["site_code"] for r in c.execute("SELECT serial, site_code FROM concentrators")}
            registry_empty = not owned_map
            samples = c.execute("SELECT * FROM samples WHERE session_id=? ORDER BY id", (sid,)).fetchall()
            sample = samples[-1] if samples else None
            tol = timedelta(seconds=self.cfg.ts_skew_tolerance_s)
            starts = [(parse_ts(x["movement_completed_utc"]), x["id"]) for x in samples]
            for link in snap.links:
                if link.fingerprint in seen:
                    continue
                seen.add(link.fingerprint)
                owned = registry_empty or link.concentrator_serial in owned_map
                if as_baseline or sample is None:
                    kind, sample_id = "baseline", None
                elif link.observed_utc is None:
                    kind, sample_id = "fresh", sample["id"]  # no source time: trust arrival order
                else:
                    # The reading belongs to the position that was stable when it was taken,
                    # which is not always the current one (receivers report with a delay).
                    home = next((i for t, i in reversed(starts) if link.observed_utc >= t - tol), None)
                    kind, sample_id = ("fresh", home) if home is not None else ("stale", None)
                c.execute(
                    "INSERT INTO observations(session_id, sample_id, meter_serial, concentrator_serial, "
                    "site_code, observed_utc, received_utc, rssi_dbm, lqi, fingerprint, owned, kind) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (sid, sample_id, s["meter_serial"], link.concentrator_serial,
                     owned_map.get(link.concentrator_serial), iso(link.observed_utc), iso(now),
                     link.rssi_dbm, link.lqi, link.fingerprint, int(owned), kind),
                )
                if kind == "fresh" and sample_id == sample["id"]:
                    fresh.append(self._obs_json(link, owned, owned_map.get(link.concentrator_serial)))
            if s["state"] == "WAIT_RF" and sample is not None and self._position_measured(c, sid, sample, now):
                c.execute("UPDATE sessions SET state='MEASURED' WHERE id=?", (sid,))
            c.execute("UPDATE sessions SET heartbeat_utc=? WHERE id=?", (iso(now), sid))
        return fresh, len(snap.links), None

    def _position_measured(self, c, sid: str, sample, now: datetime) -> bool:
        """A position is measured when the reference receiver has reported there, or
        after one full reporting cycle. See Settings.measure_window_s."""
        rows = c.execute(
            "SELECT concentrator_serial, MIN(received_utc) AS first FROM observations "
            "WHERE sample_id=? AND kind='fresh' AND owned=1 GROUP BY concentrator_serial", (sample["id"],),
        ).fetchall()
        if not rows:
            return False
        ref = c.execute(
            "SELECT concentrator_serial FROM observations WHERE session_id=? AND kind='fresh' AND owned=1 "
            "AND sample_id<? GROUP BY sample_id, concentrator_serial ORDER BY AVG(rssi_dbm) DESC LIMIT 1",
            (sid, sample["id"]),
        ).fetchone()
        if ref is not None and any(r["concentrator_serial"] == ref["concentrator_serial"] for r in rows):
            return True
        # Reference not heard here (or first position, where it is not known yet):
        # give every receiver one full cycle, counted from the first report.
        window = timedelta(seconds=self.cfg.measure_window_s)
        return now - min(parse_ts(r["first"]) for r in rows) >= window

    @staticmethod
    def _obs_json(link: Link, owned: bool, site_code: str | None) -> dict:
        return {
            "concentratorSerial": link.concentrator_serial,
            "observedAtUtc": iso(link.observed_utc),
            "rssiDbm": link.rssi_dbm,
            "lqi": link.lqi,
            "fingerprint": link.fingerprint,
            "owned": owned,
            "siteId": site_code,
        }

    def poll(self, sid: str) -> dict:
        with self.db.tx() as c:
            s = self._session(c, sid)
        if s["state"] == "READY":
            raise LinkIQError(409, "BAD_STATE", "Confirm CALL before polling")
        fresh, count, warning = self._ingest(sid)
        summ = self.summary(sid)
        wait = summ["current"]["waitSeconds"] if summ["current"] else 0
        if warning is None and summ["session"]["state"] == "WAIT_RF" and wait >= self.cfg.warn_after_s:
            warning = "SLOW_RF"
        return {
            "meterSerial": s["meter_serial"],
            "receivedAtUtc": iso(self.clock()),
            "fresh": fresh,
            "snapshotCount": count,
            "waitSeconds": wait,
            "warning": warning,
            "summary": summ,
        }

    # ------------------------------------------------------------------ closing
    def complete(self, sid: str, outcome: str | None = None, note: str | None = None) -> dict:
        summ = self.summary(sid)
        outcome = outcome or summ["suggestedOutcome"]
        if outcome not in OUTCOMES:
            raise LinkIQError(422, "BAD_OUTCOME", "Unknown outcome")
        decision = {k: summ[k] for k in ("best", "primary", "backup", "finalCheck", "suggestedOutcome")}
        with self.db.tx() as c:
            self._session(c, sid)
            c.execute(
                "UPDATE sessions SET status=?, state='COMPLETE', outcome=?, note=?, finished_utc=?, "
                "decision_json=? WHERE id=?",
                ("ABORTED" if outcome == "ABORTED" else "COMPLETED", outcome, note,
                 iso(self.clock()), json.dumps(decision), sid),
            )
        return self.summary(sid)

    def export(self, sid: str) -> dict:
        with self.db.tx() as c:
            self._session(c, sid, active=False)
            samples = [dict(r) for r in c.execute("SELECT * FROM samples WHERE session_id=? ORDER BY id", (sid,))]
            obs = [dict(r) for r in c.execute("SELECT * FROM observations WHERE session_id=? ORDER BY id", (sid,))]
        return {"summary": self.summary(sid), "samples": samples, "observations": obs}

    def export_rows(self) -> list[dict]:
        """Flat rows for Network Intelligence / coverage analysis."""
        with self.db.tx() as c:
            rows = c.execute(
                "SELECT o.session_id, s.meter_serial, s.technician, s.gps_lat, s.gps_lon, s.outcome, "
                "p.phase, p.step, p.heading_deg, o.kind, o.concentrator_serial, o.site_code, o.owned, "
                "o.rssi_dbm, o.lqi, o.observed_utc, o.received_utc "
                "FROM observations o JOIN sessions s ON s.id=o.session_id "
                "LEFT JOIN samples p ON p.id=o.sample_id ORDER BY o.id"
            ).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------ summary
    def summary(self, sid: str) -> dict:
        cfg = self.cfg
        with self.db.tx() as c:
            s = self._session(c, sid, active=False)
            samples = c.execute("SELECT * FROM samples WHERE session_id=? ORDER BY id", (sid,)).fetchall()
            obs = c.execute(
                "SELECT sample_id, concentrator_serial, rssi_dbm, observed_utc FROM observations "
                "WHERE session_id=? AND kind='fresh' AND owned=1 ORDER BY id", (sid,),
            ).fetchall()
            reg = {
                r["serial"]: r for r in c.execute(
                    "SELECT k.serial, k.site_code, k.status, s.name, s.address, s.latitude, s.longitude "
                    "FROM concentrators k LEFT JOIN sites s ON s.site_code=k.site_code"
                )
            }
        now = self.clock()

        # per sample -> per receiver -> readings
        per: dict[int, dict[str, list[int]]] = {}
        missing_ts = False
        for o in obs:
            per.setdefault(o["sample_id"], {}).setdefault(o["concentrator_serial"], []).append(o["rssi_dbm"])
            missing_ts = missing_ts or o["observed_utc"] is None

        def stats(sample) -> dict:
            recv = {k: round(sum(v) / len(v), 1) for k, v in per.get(sample["id"], {}).items()}
            ranked = sorted(recv.items(), key=lambda kv: -kv[1])
            n = sum(len(v) for v in per.get(sample["id"], {}).values())
            return {
                "sampleId": sample["id"], "phase": sample["phase"], "step": sample["step"],
                "headingDeg": sample["heading_deg"],
                "measured": bool(ranked), "skipped": bool(sample["skipped"]),
                "bestRssi": ranked[0][1] if ranked else None,
                "bestSerial": ranked[0][0] if ranked else None,
                "secondRssi": ranked[1][1] if len(ranked) > 1 else None,
                "nObs": n, "receivers": recv,
            }

        latest: dict[tuple[str, int], dict] = {}
        for smp in samples:  # a repeated position replaces the earlier attempt
            latest[(smp["phase"], smp["step"])] = stats(smp)
        coarse = sorted((v for k, v in latest.items() if k[0] == "coarse"), key=lambda d: d["step"])
        fine = sorted((v for k, v in latest.items() if k[0] == "fine"), key=lambda d: d["step"])
        final = latest.get(("final", 1))

        def winner(group):
            m = [g for g in group if g["measured"]]
            if not m:
                return None
            w = max(m, key=lambda g: g["bestRssi"])
            return {"phase": w["phase"], "step": w["step"], "rssi": w["bestRssi"], "serial": w["bestSerial"]}

        coarse_winner, fine_winner = winner(coarse), winner(fine)
        best = winner(coarse + fine)

        current = None
        if samples:
            cur = stats(samples[-1])
            wait = 0
            if s["state"] == "WAIT_RF":
                wait = int((now - parse_ts(samples[-1]["movement_completed_utc"])).total_seconds())
            current = {**cur, "waitSeconds": max(wait, 0)}

        # --- live fine tune: readings of the reference receiver, no positions marked ---
        live = None
        live_smp = next((x for x in reversed(samples) if x["phase"] == "live"), None)
        if live_smp is not None and coarse_winner:
            with self.db.tx() as c:
                mine = c.execute(
                    "SELECT sample_id, rssi_dbm, observed_utc, received_utc FROM observations WHERE session_id=? "
                    "AND kind='fresh' AND concentrator_serial=?", (sid, coarse_winner["serial"]),
                ).fetchall()
            when = lambda o: parse_ts(o["observed_utc"] or o["received_utc"])  # noqa: E731
            here = sorted((o for o in mine if o["sample_id"] == live_smp["id"]), key=when)
            times = sorted(when(o) for o in mine)
            gaps = sorted(g for g in ((b - a).total_seconds() for a, b in zip(times, times[1:])) if 5 <= g <= 90)
            last = here[-1] if here else None
            live = {
                "serial": coarse_winner["serial"], "referenceRssi": coarse_winner["rssi"],
                "readings": [{"atUtc": iso(when(o)), "rssi": o["rssi_dbm"]} for o in here[-24:]],
                "lastRssi": last["rssi_dbm"] if last else None,
                "previousRssi": here[-2]["rssi_dbm"] if len(here) > 1 else None,
                "bestRssi": max(o["rssi_dbm"] for o in here) if here else None,
                "ageSeconds": max(0, int((now - parse_ts(last["received_utc"])).total_seconds())) if last else None,
                "intervalS": round(gaps[len(gaps) // 2]) if gaps else 30,
            }

        # --- receivers ----------------------------------------------------
        primary_serial = best["serial"] if best else None
        primary_site = reg[primary_serial]["site_code"] if primary_serial in reg else None
        agg: dict[str, dict] = {}
        for st in coarse + fine + ([final] if final else []):
            for serial, rssi in st["receivers"].items():
                a = agg.setdefault(serial, {"best": rssi, "bestPos": st, "sectors": set(), "last": rssi})
                if rssi > a["best"]:
                    a["best"], a["bestPos"] = rssi, st
                a["last"] = rssi
                if st["phase"] == "coarse":
                    a["sectors"].add(st["step"])
        receivers = []
        for serial, a in agg.items():
            r = reg.get(serial)
            site = r["site_code"] if r else None
            if serial == primary_serial:
                relation = "PRIMARY"
            elif site is None or primary_site is None:
                relation = "UNKNOWN_SITE"
            elif site == primary_site:
                relation = "SAME_SITE"
            else:
                relation = "DISTINCT_SITE"
            d = {
                "serial": serial, "siteCode": site,
                "siteName": r["name"] if r else None, "address": r["address"] if r else None,
                "latitude": r["latitude"] if r else None, "longitude": r["longitude"] if r else None,
                "registryStatus": r["status"] if r else None,
                "bestRssi": a["best"], "lastRssi": a["last"],
                "bestPhase": a["bestPos"]["phase"], "bestStep": a["bestPos"]["step"],
                "sectors": sorted(a["sectors"]), "relation": relation,
                "distanceM": None, "bearingDeg": None, "compass": None,
            }
            if r and None not in (s["gps_lat"], s["gps_lon"], r["latitude"], r["longitude"]):
                d["distanceM"] = round(geo.distance_m(s["gps_lat"], s["gps_lon"], r["latitude"], r["longitude"]))
                b = geo.bearing_deg(s["gps_lat"], s["gps_lon"], r["latitude"], r["longitude"])
                d["bearingDeg"], d["compass"] = round(b), geo.compass_ro(b)
            receivers.append(d)
        receivers.sort(key=lambda d: -d["bestRssi"])

        # --- redundancy: best non-primary receiver, distinct site preferred ---
        backup = None
        others = [r for r in receivers if r["relation"] != "PRIMARY"]
        if others:
            pick = next((r for r in others if r["relation"] == "DISTINCT_SITE"), others[0])
            pos = agg[pick["serial"]]["bestPos"]
            primary_there = pos["receivers"].get(primary_serial)
            degradation = round(best["rssi"] - primary_there, 1) if primary_there is not None else None
            backup = {
                "serial": pick["serial"], "siteCode": pick["siteCode"], "siteName": pick["siteName"],
                "redundancy": pick["relation"], "bestRssi": pick["bestRssi"],
                "bestPhase": pos["phase"], "bestStep": pos["step"],
                "usable": pick["bestRssi"] >= cfg.rssi_marginal_dbm,
                "primaryRssiThere": primary_there, "primaryDegradationDb": degradation,
                # Never recommend a backup position that costs the primary link too much.
                "positionRecommendable": degradation is not None
                and degradation <= cfg.primary_degradation_max_db,
            }

        # --- final CALL check ----------------------------------------------
        final_check = None
        if final and final["measured"] and best:
            rssi = final["receivers"].get(primary_serial)  # same receiver, or no verdict
            delta = round(rssi - best["rssi"], 1) if rssi is not None else None
            final_check = {
                "rssi": rssi, "winnerRssi": best["rssi"], "deltaDb": delta,
                "ok": delta is not None and delta >= -cfg.primary_degradation_max_db,
            }

        # --- suggested outcome (PROVISIONAL thresholds, installer can override) ---
        if final_check:  # primary silent at the final CALL counts as no reliable link
            ref = final_check["rssi"] if final_check["rssi"] is not None else float("-inf")
        else:
            ref = best["rssi"] if best else None
        if ref is None:
            outcome = "INCONCLUSIVE"
        elif ref < cfg.rssi_marginal_dbm:
            outcome = "NO_RELIABLE_LINK"
        elif ref < cfg.rssi_good_dbm:
            outcome = "MARGINAL"
        elif final_check and final_check["ok"] and ref >= cfg.rssi_quick_confirm_dbm:
            outcome = "OPTIMAL_CONFIRMED"
        elif backup and backup["usable"] and backup["redundancy"] == "DISTINCT_SITE":
            outcome = "GOOD_WITH_SITE_REDUNDANCY"
        elif backup and backup["usable"] and backup["redundancy"] == "SAME_SITE":
            outcome = "GOOD_WITH_EQUIPMENT_REDUNDANCY"
        else:
            outcome = "GOOD_PRIMARY_ONLY"

        warnings = []
        if not reg:
            warnings.append("REGISTRY_EMPTY")  # every receiver is treated as owned
        if missing_ts:
            warnings.append("MISSING_SOURCE_TIMESTAMP")
        if s["gps_lat"] is None:
            warnings.append("NO_GPS")

        quick = (
            len(samples) == 1 and coarse and coarse[0]["measured"]
            and coarse[0]["bestRssi"] >= cfg.rssi_quick_confirm_dbm
        )
        p = reg.get(primary_serial) if primary_serial else None
        return {
            "session": {
                "id": s["id"], "meterSerial": s["meter_serial"], "technician": s["technician"],
                "gps": {"lat": s["gps_lat"], "lon": s["gps_lon"], "accuracyM": s["gps_accuracy_m"]},
                "status": s["status"], "state": s["state"], "startedUtc": s["started_utc"],
                "finishedUtc": s["finished_utc"], "initialCallUtc": s["initial_call_utc"],
                "finalCallUtc": s["final_call_utc"], "outcome": s["outcome"], "note": s["note"],
            },
            "current": current, "coarse": coarse, "fine": fine, "final": final,
            "coarseWinner": coarse_winner, "fineWinner": fine_winner, "best": best,
            "primary": None if not best else {
                "serial": primary_serial, "siteCode": primary_site,
                "siteName": p["name"] if p else None, "address": p["address"] if p else None,
                "rssi": best["rssi"],
            },
            "backup": backup, "receivers": receivers, "finalCheck": final_check, "live": live,
            "quickConfirmEligible": bool(quick),
            "suggestedOutcome": outcome, "outcomes": OUTCOMES, "warnings": warnings,
        }
