import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.db import Database  # noqa: E402
from app.kamstrup import KamstrupGateway, SimulatedKamstrup  # noqa: E402
from app.service import Service  # noqa: E402


class FakeClock:
    def __init__(self):
        self.now = datetime(2026, 11, 12, 9, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.now

    def tick(self, seconds: float):
        self.now += timedelta(seconds=seconds)


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def svc(tmp_path, clock):
    cfg = Settings(db_path=str(tmp_path / "t.sqlite3"), kamstrup_mode="sim", auth_mode="none", coarse_steps=6)
    db = Database(cfg.db_path)
    with db.tx() as c:
        c.execute("INSERT INTO sites VALUES ('07','Site 07','Strada Exemplu 1',55.676100,12.568300,'ACTIVE',1)")
        c.execute("INSERT INTO sites VALUES ('B','Site B','x',55.690000,12.590000,'ACTIVE',1)")
        c.executemany(
            "INSERT INTO concentrators(serial, site_code) VALUES (?,?)",
            [("70000001", "07"), ("70000002", "07"), ("70000003", "B")],
        )
    sim = SimulatedKamstrup(clock=clock, speed=1, seed=7)
    return Service(cfg, db, KamstrupGateway(sim, cfg.poll_min_interval_s, clock), clock)


def wait_measured(svc, clock, sid, limit=120):
    """Poll every 5 s like the phone does until the position is measured."""
    waited = 0
    while waited <= limit:
        clock.tick(5)
        waited += 5
        r = svc.poll(sid)
        if r["summary"]["session"]["state"] == "MEASURED":
            return r
    raise AssertionError("no fresh observation")
