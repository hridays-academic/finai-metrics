"""A8 (Stop 3): importing the backend opens no database connection, even with
no database URL set. The schema check runs on the first database use."""
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent

PROBE = """
import psycopg
def refuse(*a, **k):
    raise RuntimeError("a connection was opened at import")
psycopg.connect = refuse
psycopg.Connection.connect = classmethod(lambda cls, *a, **k: refuse())
from app.config import get_settings
s = get_settings()
assert not any("postgres" in str(v) for v in s.model_dump().values()), "a database URL is set"
import app.main
print("imported", len(app.main.app.routes) > 10)
"""


def test_importing_the_app_needs_no_database(tmp_path):
    env = {k: v for k, v in os.environ.items() if "DATABASE" not in k.upper() and "PG" not in k.upper()}
    env["PYTHONPATH"] = str(BACKEND)
    res = subprocess.run([sys.executable, "-c", PROBE], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=120)
    assert res.returncode == 0, res.stderr[-2000:]
    assert res.stdout.strip().endswith("imported True")
