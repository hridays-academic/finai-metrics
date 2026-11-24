"""The root requirements.txt (what Vercel installs) must list every package in
backend/requirements.txt (the source of truth). On 2026-11-24 openpyxl was
missing from the root copy, so the macro job failed every day with
ModuleNotFoundError and all six macro cards stayed empty (audit T3)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _packages(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        name = re.split(r"[=<>\[ ]", line, maxsplit=1)[0].lower()
        out[name] = line
    return out


def test_root_requirements_match_backend():
    backend = _packages(ROOT / "backend" / "requirements.txt")
    root = _packages(ROOT / "requirements.txt")
    assert root == backend
