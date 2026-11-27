"""Z4 (master plan): the core loop end to end, in a real browser. Opt-in, so
the normal suite stays fast:  E2E=1 scripts/test_local.sh tests/test_e2e_core_loop.py

It seeds a scored practice event (the test_practice fixture), starts this
backend with uvicorn and the built site with `vite preview` on spare ports,
plays one round (opens it, sets three ranges, submits) and checks the score
on the page equals lib's scoring for the same ranges. Run before every deploy.
"""
import json
import os
import socket
import subprocess
import time
from pathlib import Path

import pytest
import requests

from app.league_config import market_config
from app.services import scoring
from tests.test_practice import admin_env, scored  # noqa: F401 -- fixtures

pytestmark = pytest.mark.skipif(os.environ.get("E2E") != "1", reason="end-to-end: set E2E=1")

ROOT = Path(__file__).resolve().parents[2]
RANGES = [(10.0, 14.0), (13.0, 15.0), (7.0, 9.0)]  # revenue growth, margin, KPI
ACTUALS = [12.0, 14.0, 8.0]
LAZY = [10.0, 15.0, 5.0]


def _port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _wait(url: str, seconds: float = 60) -> None:
    end = time.time() + seconds
    while time.time() < end:
        try:
            if requests.get(url, timeout=2).status_code < 500:
                return
        except requests.RequestException:
            pass
        time.sleep(0.5)
    raise RuntimeError(f"{url} didn't come up")


def test_practice_round_end_to_end(conn, client, scored, db_url):  # noqa: F811
    # Practice offers scored events only.
    assert client.post(f"/api/admin/events/{scored['event']}/score", headers=scored["admin"]).status_code == 200
    api_port, site_port = _port(), _port()
    env = {**os.environ, "DATABASE_URL": db_url, "STACKLY_DATABASE_URL": "", "AUTH_RATE_LIMITS_ENABLED": "false"}
    procs = []
    try:
        procs.append(subprocess.Popen(
            [str(ROOT / "backend/.venv/bin/python"), "-m", "uvicorn", "app.main:app", "--port", str(api_port)],
            cwd=ROOT / "backend", env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        _wait(f"http://127.0.0.1:{api_port}/api/health")
        subprocess.run(["npx", "vite", "build"], cwd=ROOT / "frontend", check=True, capture_output=True)
        procs.append(subprocess.Popen(
            ["npx", "vite", "preview", "--host", "127.0.0.1", "--port", str(site_port), "--strictPort"], cwd=ROOT / "frontend",
            env={**os.environ, "E2E_API": f"http://127.0.0.1:{api_port}"},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        _wait(f"http://127.0.0.1:{site_port}/")
        flat = ",".join(str(v) for lo_hi in RANGES for v in lo_hi)
        out = subprocess.run(["node", "e2e/core-loop.mjs", f"http://127.0.0.1:{site_port}", scored["code"], flat],
                             cwd=ROOT / "frontend", capture_output=True, text=True, timeout=120)
        assert out.returncode == 0, out.stderr[-2000:]
        shown = json.loads(out.stdout.strip().splitlines()[-1])
    finally:
        for p in procs:
            p.terminate()
        for p in procs:
            p.wait(timeout=20)
    cfg = market_config("IN").scoring
    keys = ["revenue_growth_yoy", "operating_margin", "sector_kpi"]
    metric_scores = [scoring.score_metric(k, lo, hi, actual, lazy, cfg)
                     for k, (lo, hi), actual, lazy in zip(keys, RANGES, ACTUALS, LAZY)]
    expected = scoring.event_score(metric_scores)
    assert shown["inputs"] == 6 and shown["errors"] == []
    assert float(shown["score"]) == pytest.approx(round(expected, 1), abs=0.05)
