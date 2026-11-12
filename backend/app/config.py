"""Runtime configuration. Every value can be overridden with an environment variable."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _s(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _f(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def _i(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _tokens(raw: str) -> dict[str, str]:
    """LINKIQ_TOKENS="Ana:secret1,Mihai:secret2" -> {secret1: Ana, secret2: Mihai}"""
    out: dict[str, str] = {}
    for part in raw.split(","):
        if ":" in part:
            name, token = part.split(":", 1)
            if name.strip() and token.strip():
                out[token.strip()] = name.strip()
    return out


@dataclass
class Settings:
    db_path: str = field(default_factory=lambda: _s("LINKIQ_DB_PATH", "linkiq.sqlite3"))

    # --- Kamstrup source -------------------------------------------------
    # "sim"  = built-in simulator (no network, for development and training)
    # "live" = real Device Monitor endpoint
    kamstrup_mode: str = field(default_factory=lambda: _s("KAMSTRUP_MODE", "sim"))
    kamstrup_base_url: str = field(
        default_factory=lambda: _s(
            "KAMSTRUP_BASE_URL",
            "https://check.kamstrup.com/DeviceMonitorService/rest/devicedata",
        )
    )
    kamstrup_timeout_s: float = field(default_factory=lambda: _f("KAMSTRUP_TIMEOUT_S", 10))
    # Approved minimum interval between upstream requests for the same meter.
    poll_min_interval_s: float = field(default_factory=lambda: _f("POLL_MIN_INTERVAL_S", 5))
    # Simulator speed-up (1 = realistic 20-40 s latency, 4 = four times faster).
    sim_speed: float = field(default_factory=lambda: _f("SIM_SPEED", 4))

    # --- Workflow --------------------------------------------------------
    coarse_steps: int = field(default_factory=lambda: _i("COARSE_STEPS", 4))
    fine_steps: int = 5
    warn_after_s: float = field(default_factory=lambda: _f("WARN_AFTER_S", 60))
    # Live test 2026-11-12: after CALL every receiver reports on its own 20-30 s
    # cycle, out of phase with the others. A position therefore counts as measured
    # once the reference (strongest) receiver has reported there, or after one
    # full reporting cycle, never on the first weak receiver that happens to report.
    measure_window_s: float = field(default_factory=lambda: _f("MEASURE_WINDOW_S", 35))
    lock_ttl_s: float = field(default_factory=lambda: _f("LOCK_TTL_S", 120))
    # Allowed clock difference between this server and the Kamstrup timestamps.
    ts_skew_tolerance_s: float = field(default_factory=lambda: _f("TS_SKEW_TOLERANCE_S", 5))

    # --- PROVISIONAL thresholds (dBm) -------------------------------------
    # The handoff forbids hard-coding production thresholds before field
    # outcomes are correlated with hourly-read delivery. These are pilot
    # defaults, derived only from the desk tests, and are meant to be tuned.
    rssi_quick_confirm_dbm: float = field(default_factory=lambda: _f("RSSI_QUICK_CONFIRM_DBM", -80))
    rssi_good_dbm: float = field(default_factory=lambda: _f("RSSI_GOOD_DBM", -95))
    rssi_marginal_dbm: float = field(default_factory=lambda: _f("RSSI_MARGINAL_DBM", -110))
    # Max loss on the primary link accepted for a backup position / final check.
    primary_degradation_max_db: float = field(
        default_factory=lambda: _f("PRIMARY_DEGRADATION_MAX_DB", 6)
    )

    # --- Access ----------------------------------------------------------
    # "none"  = no authentication (simulator / local development only)
    # "token" = every phone must be paired with a personal code
    #           (scripts/pairing.py, or LINKIQ_TOKENS for fixed codes)
    # Default: "token" as soon as the real Kamstrup endpoint is used, so a hosted
    # instance is never an open proxy and never serves the registry to strangers.
    auth_mode: str = field(
        default_factory=lambda: _s(
            "AUTH_MODE", "token" if _s("KAMSTRUP_MODE", "sim") == "live" else "none"
        )
    )
    tokens: dict[str, str] = field(default_factory=lambda: _tokens(_s("LINKIQ_TOKENS", "")))
