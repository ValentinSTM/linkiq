"""Kamstrup Device Monitor source adapters.

The rest of the application only sees normalised ``Link`` objects, so the
source can be replaced (live endpoint, simulator, a future authenticated API)
without touching the workflow or the UI.

Fields used from each element of ``Links[]``: ``SerialNumber`` (the receiver),
``TimestampUtcToDevice``, ``RssiToDevice`` and ``LQI``. A real response also
carries ``Manufacturer``, ``Class``, ``TimestampUtcFromDevice`` and
``RssiFromDevice``; they are ignored. The serial key can be overridden with
``KAMSTRUP_SERIAL_FIELDS`` should the source change.
"""
from __future__ import annotations

import math
import os
import random
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Protocol

import httpx

Clock = Callable[[], datetime]

SERIAL_FIELDS = [
    f.strip()
    for f in os.environ.get(
        "KAMSTRUP_SERIAL_FIELDS",
        "SerialNumber,ConcentratorSerial,ConcentratorSerialNumber,ReceiverSerial,Serial",
    ).split(",")
    if f.strip()
]
_DOTNET_DATE = re.compile(r"/Date\((-?\d+)(?:[+-]\d{4})?\)/")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_ts(value: Any) -> datetime | None:
    """Parse a source timestamp. Returns None for missing/undefined/unparseable values."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return None
    text = str(value).strip()
    if not text or text.lower() in ("null", "undefined", "none"):
        return None
    m = _DOTNET_DATE.fullmatch(text)
    if m:  # WCF-style "/Date(1731400000000)/"
        return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc)
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:  # field name says UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@dataclass(frozen=True)
class Link:
    concentrator_serial: str
    timestamp_raw: str  # exactly as received ("" when missing)
    observed_utc: datetime | None
    rssi_dbm: int
    lqi: int | None

    @property
    def fingerprint(self) -> str:
        # EventKey = ConcentratorSerial | TimestampUtcToDevice | RssiToDevice
        return f"{self.concentrator_serial}|{self.timestamp_raw}|{self.rssi_dbm}"


def normalise(payload: Any) -> list[Link]:
    """Turn a raw Device Monitor response into Link objects. Skips malformed links."""
    if not isinstance(payload, dict):
        return []
    raw_links = payload.get("Links") or payload.get("links") or []
    links: list[Link] = []
    for item in raw_links:
        if not isinstance(item, dict):
            continue
        serial = next((item[k] for k in SERIAL_FIELDS if item.get(k) not in (None, "")), None)
        rssi = item.get("RssiToDevice")
        if serial is None or rssi is None:
            continue
        try:
            rssi_i = int(round(float(rssi)))
        except (TypeError, ValueError):
            continue
        ts = item.get("TimestampUtcToDevice")
        lqi = item.get("LQI", item.get("Lqi"))
        try:
            lqi_i = int(lqi) if lqi is not None else None
        except (TypeError, ValueError):
            lqi_i = None
        links.append(
            Link(
                concentrator_serial=str(serial).strip(),
                timestamp_raw="" if ts is None else str(ts),
                observed_utc=parse_ts(ts),
                rssi_dbm=rssi_i,
                lqi=lqi_i,
            )
        )
    return links


class UpstreamError(Exception):
    pass


class Adapter(Protocol):
    def fetch(self, meter_serial: str) -> Any: ...
    def notify_call(self, meter_serial: str) -> None: ...
    def notify_orientation(self, meter_serial: str, degrees: float) -> None: ...


class LiveKamstrup:
    """Read-only GET against the real endpoint."""

    def __init__(self, base_url: str, timeout_s: float = 10):
        self.base_url = base_url.rstrip("/")
        self.client = httpx.Client(timeout=timeout_s, headers={"Accept": "application/json"})

    def fetch(self, meter_serial: str) -> Any:
        try:
            r = self.client.get(f"{self.base_url}/{meter_serial}")
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise UpstreamError(f"{type(exc).__name__}: {exc}") from exc

    def notify_call(self, meter_serial: str) -> None:  # physical action on the meter
        pass

    def notify_orientation(self, meter_serial: str, degrees: float) -> None:
        pass


class SimulatedKamstrup:
    """Rolling-snapshot simulator reproducing the behaviour measured in the handoff:
    after CALL each receiver reports on its own 20-30 s cycle; no CALL per position.

    All serials below are invented. The payload has the same shape as a real
    Device Monitor response (checked against one on 2026-11-12).
    """

    #          serial      best bearing  peak dBm  off-axis loss dB  hear probability
    RECEIVERS = [
        ("70000001", 200.0, -66.0, 22.0, 1.0),
        ("70000002", 215.0, -92.0, 14.0, 0.9),   # same site -> equipment redundancy
        ("70000003", 40.0, -101.0, 18.0, 0.8),   # other site -> site redundancy
        ("70000099", 300.0, -118.0, 8.0, 0.6),   # not in registry -> external
    ]

    def __init__(self, clock: Clock = utcnow, speed: float = 1.0, seed: int | None = None):
        self.clock = clock
        self.speed = max(speed, 0.01)
        self.rng = random.Random(seed)
        self.lock = threading.Lock()
        self.meters: dict[str, dict[str, Any]] = {}

    def _meter(self, serial: str) -> dict[str, Any]:
        m = self.meters.get(serial)
        if m is None:
            old = self.clock() - timedelta(hours=1)
            m = {
                "orientation": 0.0,
                "next": {},  # receiver serial -> next report time; empty until CALL
                "links": {
                    s: self._link(s, bearing, peak, loss, 0.0, old)
                    for s, bearing, peak, loss, _ in self.RECEIVERS[:2]
                },
            }
            self.meters[serial] = m
        return m

    def _link(self, serial, bearing, peak, loss, orientation, when) -> dict[str, Any]:
        off = (1 - math.cos(math.radians(orientation - bearing))) / 2  # 0 on-axis, 1 opposite
        rssi = round(peak - loss * off + self.rng.uniform(-1.5, 1.5))
        return {
            "SerialNumber": serial,
            "Manufacturer": "KAM",
            "Class": "Concentrator",
            "TimestampUtcToDevice": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "RssiToDevice": rssi,
            "TimestampUtcFromDevice": None,
            "RssiFromDevice": 0,
            "LQI": 0,
        }

    def notify_call(self, meter_serial: str) -> None:
        with self.lock:
            m = self._meter(meter_serial)
            now = self.clock()
            for serial, *_ in self.RECEIVERS:  # each receiver starts its own cycle
                m["next"][serial] = now + timedelta(seconds=self.rng.uniform(20, 40) / self.speed)

    def silence(self, meter_serial: str) -> None:
        """Test helper: the meter stops being heard."""
        with self.lock:
            self._meter(meter_serial)["next"] = {}

    def notify_orientation(self, meter_serial: str, degrees: float) -> None:
        with self.lock:
            self._advance(meter_serial)  # readings before the move keep the old orientation
            self._meter(meter_serial)["orientation"] = degrees % 360

    def _advance(self, meter_serial: str) -> None:
        m = self._meter(meter_serial)
        now = self.clock()
        for serial, bearing, peak, loss, prob in self.RECEIVERS:
            while m["next"].get(serial) is not None and m["next"][serial] <= now:
                when = m["next"][serial]
                if self.rng.random() <= prob:
                    m["links"][serial] = self._link(serial, bearing, peak, loss, m["orientation"], when)
                m["next"][serial] = when + timedelta(seconds=self.rng.uniform(20, 30) / self.speed)

    def fetch(self, meter_serial: str) -> Any:
        with self.lock:
            self._advance(meter_serial)
            m = self._meter(meter_serial)
            return {
                "SerialNumber": meter_serial, "Manufacturer": "KAM", "Class": "Meter",
                "Links": [dict(v) for v in m["links"].values()],
            }


@dataclass
class Snapshot:
    links: list[Link]
    fetched_utc: datetime
    from_cache: bool


class KamstrupGateway:
    """Single choke point for upstream calls.

    Enforces the approved minimum interval PER METER regardless of how many
    phones are polling, by serving the cached snapshot in between.
    """

    def __init__(self, adapter: Adapter, min_interval_s: float, clock: Clock = utcnow):
        self.adapter = adapter
        self.min_interval_s = min_interval_s
        self.clock = clock
        self._guard = threading.Lock()
        self._locks: dict[str, threading.Lock] = {}
        self._cache: dict[str, Snapshot] = {}
        self.upstream_calls = 0

    def snapshot(self, meter_serial: str) -> Snapshot:
        with self._guard:
            lock = self._locks.setdefault(meter_serial, threading.Lock())
        with lock:
            now = self.clock()
            cached = self._cache.get(meter_serial)
            if cached and (now - cached.fetched_utc).total_seconds() < self.min_interval_s:
                return Snapshot(cached.links, cached.fetched_utc, True)
            self.upstream_calls += 1
            links = normalise(self.adapter.fetch(meter_serial))
            snap = Snapshot(links, now, False)
            self._cache[meter_serial] = snap
            return snap
