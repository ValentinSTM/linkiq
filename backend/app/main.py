"""LinkIQ Field Assistant - HTTP API and static PWA host (one process, one port)."""
from __future__ import annotations

import csv
import io
import logging
import os
from pathlib import Path

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import Settings
from .db import Database
from .kamstrup import KamstrupGateway, LiveKamstrup, SimulatedKamstrup
from .service import LinkIQError, Service

log = logging.getLogger("linkiq")
FRONTEND_DIR = Path(os.environ.get("LINKIQ_FRONTEND_DIR", Path(__file__).resolve().parents[2] / "frontend"))


class GpsIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracyM: float | None = None


class SessionIn(BaseModel):
    meterSerial: str
    technician: str | None = None
    gps: GpsIn | None = None


class CallIn(BaseModel):
    phase: str = "initial"


class PositionIn(BaseModel):
    phase: str
    step: int
    headingDeg: float | None = None


class CompleteIn(BaseModel):
    outcome: str | None = None
    note: str | None = Field(default=None, max_length=1000)


def build_service(settings: Settings | None = None, clock=None) -> Service:
    settings = settings or Settings()
    kwargs = {"clock": clock} if clock else {}
    if settings.kamstrup_mode == "live":
        adapter = LiveKamstrup(settings.kamstrup_base_url, settings.kamstrup_timeout_s)
    else:
        adapter = SimulatedKamstrup(speed=settings.sim_speed, **kwargs)
    gateway = KamstrupGateway(adapter, settings.poll_min_interval_s, **kwargs)
    return Service(settings, Database(settings.db_path), gateway, **kwargs)


def create_app(service: Service | None = None) -> FastAPI:
    svc = service or build_service()
    cfg = svc.cfg
    app = FastAPI(title="LinkIQ Field Assistant", version="0.1.0")
    app.state.service = svc

    if cfg.auth_mode == "none":
        log.warning("AUTH_MODE=none: API is unauthenticated. Use only for local development.")
        if cfg.kamstrup_mode == "live":
            log.warning("Live Kamstrup access WITHOUT pairing: do not expose this instance to the internet.")

    def user(authorization: str | None = Header(default=None)) -> str | None:
        """Returns the installer name bound to the token, or None when auth is off."""
        if cfg.auth_mode == "none":
            return None
        name = svc.check_access_code((authorization or "").removeprefix("Bearer ").strip())
        if name is None:
            raise LinkIQError(401, "UNAUTHORIZED", "Cod de cuplare invalid sau retras")
        return name

    @app.exception_handler(LinkIQError)
    async def _err(_: Request, exc: LinkIQError):
        return JSONResponse(status_code=exc.status, content={"code": exc.code, "message": exc.message})

    @app.get("/api/health")
    def health():
        return {"status": "ok", "kamstrupMode": cfg.kamstrup_mode, "registryEmpty": svc.registry_empty()}

    @app.get("/api/config")
    def config():
        return {
            "authMode": cfg.auth_mode, "kamstrupMode": cfg.kamstrup_mode,
            "pollIntervalS": cfg.poll_min_interval_s, "warnAfterS": cfg.warn_after_s,
            "coarseSteps": cfg.coarse_steps, "fineSteps": cfg.fine_steps,
            "thresholds": {
                "quickConfirmDbm": cfg.rssi_quick_confirm_dbm, "goodDbm": cfg.rssi_good_dbm,
                "marginalDbm": cfg.rssi_marginal_dbm, "provisional": True,
            },
        }

    @app.get("/api/me")
    def me(name: str | None = Depends(user)):
        return {"technician": name}

    @app.get("/api/sites")
    def sites(lat: float | None = None, lon: float | None = None, _: str | None = Depends(user)):
        return svc.sites(lat, lon)

    @app.get("/api/concentrators/{serial}")
    def concentrator(serial: str, _: str | None = Depends(user)):
        return svc.concentrator(serial)

    @app.post("/api/sessions", status_code=201)
    def create_session(body: SessionIn, name: str | None = Depends(user)):
        g = body.gps
        return svc.create_session(
            body.meterSerial, name or body.technician or "",
            g.lat if g else None, g.lon if g else None, g.accuracyM if g else None,
        )

    @app.get("/api/sessions/{sid}")
    def get_session(sid: str, _: str | None = Depends(user)):
        return svc.summary(sid)

    @app.post("/api/sessions/{sid}/call-confirmed")
    def call_confirmed(sid: str, body: CallIn, _: str | None = Depends(user)):
        return svc.call_confirmed(sid, body.phase)

    @app.post("/api/sessions/{sid}/position-marked")
    def position_marked(sid: str, body: PositionIn, _: str | None = Depends(user)):
        return svc.position_marked(sid, body.phase, body.step, body.headingDeg)

    @app.post("/api/sessions/{sid}/skip")
    def skip(sid: str, _: str | None = Depends(user)):
        return svc.skip(sid)

    @app.get("/api/sessions/{sid}/poll")
    def poll(sid: str, _: str | None = Depends(user)):
        return svc.poll(sid)

    @app.post("/api/sessions/{sid}/complete")
    def complete(sid: str, body: CompleteIn, _: str | None = Depends(user)):
        return svc.complete(sid, body.outcome, body.note)

    @app.get("/api/sessions/{sid}/export")
    def export(sid: str, _: str | None = Depends(user)):
        return svc.export(sid)

    @app.get("/api/export/observations.csv", response_class=PlainTextResponse)
    def export_csv(_: str | None = Depends(user)):
        rows = svc.export_rows()
        buf = io.StringIO()
        if rows:
            w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        return PlainTextResponse(buf.getvalue(), media_type="text/csv")

    if FRONTEND_DIR.is_dir():
        app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="pwa")
    return app


app = create_app()
