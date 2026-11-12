import pytest
from conftest import wait_measured

from app.kamstrup import normalise, parse_ts
from app.service import LinkIQError

METER = "12345678"


def start(svc, tech="Ana"):
    return svc.create_session(METER, tech, 55.6770, 12.5670, 8)["session"]["id"]


def test_http_200_is_not_a_measurement(svc, clock):
    """The snapshot that exists before CALL must never count as fresh."""
    sid = start(svc)
    svc.call_confirmed(sid, "initial")
    clock.tick(5)
    r = svc.poll(sid)
    assert r["snapshotCount"] > 0 and r["fresh"] == []
    assert r["summary"]["session"]["state"] == "WAIT_RF"
    exp = svc.export(sid)
    assert {o["kind"] for o in exp["observations"]} == {"baseline"}


def test_first_fresh_arrives_within_expected_window(svc, clock):
    sid = start(svc)
    svc.call_confirmed(sid, "initial")
    r = wait_measured(svc, clock, sid)
    assert 20 <= r["waitSeconds"] or r["summary"]["current"]["measured"]
    assert all(o["fingerprint"].count("|") == 2 for o in r["fresh"])
    # polling again returns nothing new: fingerprints are processed once
    clock.tick(5)
    assert svc.poll(sid)["fresh"] == []


def test_rate_limit_is_enforced_per_meter(svc, clock):
    sid = start(svc)
    svc.call_confirmed(sid, "initial")
    before = svc.gw.upstream_calls
    for _ in range(10):  # ten phones hammering within one second
        clock.tick(0.1)
        svc.poll(sid)
    assert svc.gw.upstream_calls == before
    clock.tick(5)
    svc.poll(sid)
    assert svc.gw.upstream_calls == before + 1


def test_slow_rf_warns_but_does_not_fail(svc, clock):
    sid = start(svc)
    svc.call_confirmed(sid, "initial")
    svc.gw.adapter.silence(METER)
    clock.tick(61)
    r = svc.poll(sid)
    assert r["warning"] == "SLOW_RF" and r["summary"]["session"]["status"] == "ACTIVE"
    s = svc.skip(sid)
    assert s["session"]["state"] == "MEASURED" and s["current"]["skipped"]


def test_cannot_move_while_waiting(svc):
    sid = start(svc)
    svc.call_confirmed(sid, "initial")
    with pytest.raises(LinkIQError) as e:
        svc.position_marked(sid, "coarse", 2)
    assert e.value.code == "BAD_STATE"


def full_sweep(svc, clock, sid):
    svc.call_confirmed(sid, "initial")
    wait_measured(svc, clock, sid)
    for step in range(2, 7):
        svc.position_marked(sid, "coarse", step)
        wait_measured(svc, clock, sid)
    return svc.summary(sid)


def test_six_sector_sweep_picks_winner_and_keeps_weak_receivers(svc, clock):
    sid = start(svc)
    s = full_sweep(svc, clock, sid)
    assert [c["step"] for c in s["coarse"]] == [1, 2, 3, 4, 5, 6]
    assert all(c["measured"] for c in s["coarse"])
    # simulator: strongest receiver peaks at 200 deg -> sector 4 (180 deg)
    assert s["coarseWinner"]["step"] == 4 and s["primary"]["serial"] == "70000001"
    serials = {r["serial"] for r in s["receivers"]}
    assert {"70000001", "70000002", "70000003"} <= serials
    assert "70000099" not in serials  # external receiver: logged, not in the decision
    kinds = {(o["concentrator_serial"], o["owned"]) for o in svc.export(sid)["observations"]}
    assert ("70000099", 0) in kinds


def test_redundancy_prefers_distinct_site(svc, clock):
    sid = start(svc)
    s = full_sweep(svc, clock, sid)
    rel = {r["serial"]: r["relation"] for r in s["receivers"]}
    assert rel["70000001"] == "PRIMARY" and rel["70000002"] == "SAME_SITE"
    assert rel["70000003"] == "DISTINCT_SITE"
    # 70000002 is stronger, but another physical site is worth more
    assert s["backup"]["serial"] == "70000003" and s["backup"]["redundancy"] == "DISTINCT_SITE"
    assert s["backup"]["positionRecommendable"] is False  # costs the primary too much


def test_fine_tune_final_call_and_complete(svc, clock):
    sid = start(svc)
    full_sweep(svc, clock, sid)
    for step in range(1, 6):
        svc.position_marked(sid, "fine", step)
        wait_measured(svc, clock, sid)
    s = svc.summary(sid)
    assert len(s["fine"]) == 5 and s["best"]["rssi"] >= s["coarseWinner"]["rssi"]
    svc.call_confirmed(sid, "final")
    wait_measured(svc, clock, sid)
    s = svc.summary(sid)
    assert s["finalCheck"]["ok"] and s["suggestedOutcome"] == "OPTIMAL_CONFIRMED"
    done = svc.complete(sid)
    assert done["session"]["status"] == "COMPLETED" and done["session"]["outcome"] == "OPTIMAL_CONFIRMED"
    with pytest.raises(LinkIQError):
        svc.poll(sid)


def test_quick_confirm_only_for_strong_first_reading(svc, clock):
    sid = start(svc)
    svc.call_confirmed(sid, "initial")
    svc.gw.adapter.notify_orientation(METER, 200)  # antenna already well aimed
    wait_measured(svc, clock, sid)
    assert svc.summary(sid)["quickConfirmEligible"] is True


def test_session_lock_and_resume(svc, clock):
    sid = start(svc, "Ana")
    with pytest.raises(LinkIQError) as e:
        start(svc, "Mihai")
    assert e.value.code == "METER_LOCKED" and e.value.status == 409
    assert start(svc, "Ana") == sid  # same installer resumes
    clock.tick(121)  # heartbeat expired
    other = start(svc, "Mihai")
    assert other != sid and svc.summary(sid)["session"]["status"] == "ABORTED"


def test_late_reading_goes_to_the_position_it_was_taken_at(svc, clock):
    """Receivers report with a delay: a reading taken on sector 1 but first seen
    after the installer moved must count for sector 1, not sector 2."""
    sid = start(svc)
    svc.call_confirmed(sid, "initial")
    wait_measured(svc, clock, sid)
    before = svc.summary(sid)["coarse"][0]["nObs"]
    clock.tick(31)                 # more reports are generated on sector 1 ...
    svc.gw.adapter.fetch(METER)
    svc.gw.adapter.silence(METER)
    svc.gw._cache.clear()
    clock.tick(10)
    svc._new_sample(sid, "coarse", 2, None)   # ... but only read after the move
    clock.tick(5)
    r = svc.poll(sid)
    assert r["fresh"] == [] and r["summary"]["session"]["state"] == "WAIT_RF"
    coarse = r["summary"]["coarse"]
    assert coarse[0]["nObs"] > before and coarse[1]["nObs"] == 0


def test_weak_receiver_alone_does_not_complete_a_position(svc, clock):
    """Sector 2: a weak receiver reports first; the position stays open until the
    reference receiver reports or a full cycle has passed."""
    sid = start(svc)
    svc.call_confirmed(sid, "initial")
    wait_measured(svc, clock, sid)
    sim = svc.gw.adapter
    svc.position_marked(sid, "coarse", 2)
    sim.rng.random = lambda: 0.0   # every report is heard
    with sim.lock:
        sim._meter(METER)["next"] = {"70000003": clock.now + __import__("datetime").timedelta(seconds=3)}
    clock.tick(5)
    r = svc.poll(sid)
    assert [o["concentratorSerial"] for o in r["fresh"]] == ["70000003"]
    assert r["summary"]["session"]["state"] == "WAIT_RF"
    clock.tick(36)                 # full cycle elapsed without the reference receiver
    assert svc.poll(sid)["summary"]["session"]["state"] == "MEASURED"


def test_bad_meter_serial_rejected(svc):
    with pytest.raises(LinkIQError):
        svc.create_session("../../etc", "Ana")


def test_normalise_handles_missing_and_odd_timestamps():
    links = normalise({"Links": [
        {"ConcentratorSerial": 1, "TimestampUtcToDevice": None, "RssiToDevice": -70, "LQI": 9},
        {"ConcentratorSerial": "2", "TimestampUtcToDevice": "undefined", "RssiToDevice": "-80"},
        {"ConcentratorSerial": "3", "TimestampUtcToDevice": "/Date(1794474000000)/", "RssiToDevice": -90},
        {"ConcentratorSerial": "4", "RssiToDevice": None},
        "garbage",
    ]})
    assert [l.concentrator_serial for l in links] == ["1", "2", "3"]
    assert links[0].observed_utc is None and links[0].fingerprint == "1||-70"
    assert links[1].observed_utc is None and links[2].observed_utc.year == 2026
    assert parse_ts("2026-11-12T09:00:00") == parse_ts("2026-11-12T09:00:00Z")


def test_real_response_shape_is_parsed():
    """Shape of a real Device Monitor response (values replaced)."""
    links = normalise({
        "SerialNumber": "12345678", "Manufacturer": "KAM", "Class": "Meter",
        "LastSeenTimestampUtc": "2026-11-12T08:08:45Z", "HoursSinceLastSeen": 0,
        "Links": [{
            "SerialNumber": "70000001", "Manufacturer": "KAM", "Class": "Concentrator",
            "TimestampUtcToDevice": "2026-11-12T05:04:58Z", "RssiToDevice": -123,
            "TimestampUtcFromDevice": None, "RssiFromDevice": 0, "LQI": 0,
        }],
        "Source": "RS", "IsDeviceNotUnique": False, "DeviceLinkStatusCode": 0, "ManufacturerIdList": None,
    })
    assert len(links) == 1 and links[0].concentrator_serial == "70000001"
    assert links[0].rssi_dbm == -123 and links[0].fingerprint == "70000001|2026-11-12T05:04:58Z|-123"


def test_works_without_gps(svc, clock):
    """GPS is optional: laptops and locked-down phones have none."""
    sid = svc.create_session(METER, "Ana")["session"]["id"]
    s = full_sweep(svc, clock, sid)
    assert s["coarseWinner"]["step"] == 4 and "NO_GPS" in s["warnings"]
    assert all(r["distanceM"] is None for r in s["receivers"])
    assert svc.complete(sid)["session"]["status"] == "COMPLETED"


def test_live_fine_tune_collects_reference_readings(svc, clock):
    sid = start(svc)
    full_sweep(svc, clock, sid)
    svc.position_marked(sid, "live", 1)
    for _ in range(18):            # 90 s of nudging the antenna, no button presses
        clock.tick(5)
        s = svc.poll(sid)["summary"]
    live = s["live"]
    assert live["serial"] == "70000001" and len(live["readings"]) >= 3
    assert live["lastRssi"] == live["readings"][-1]["rssi"] and live["bestRssi"] >= live["lastRssi"]
    assert 20 <= live["intervalS"] <= 30 and live["ageSeconds"] < 35
    svc.call_confirmed(sid, "final")
    wait_measured(svc, clock, sid)
    assert svc.summary(sid)["finalCheck"]["ok"]


def test_four_quadrants(svc, clock):
    svc.cfg.coarse_steps = 4
    sid = start(svc)
    svc.call_confirmed(sid, "initial")
    wait_measured(svc, clock, sid)
    for step in (2, 3, 4):
        svc.position_marked(sid, "coarse", step)
        wait_measured(svc, clock, sid)
    assert svc.summary(sid)["coarseWinner"]["step"] == 3   # 180 deg is nearest to the 200 deg peak
    with pytest.raises(LinkIQError):
        svc.position_marked(sid, "coarse", 5)
