"""Vercel entrypoint for the GDELT news job (see backend/app/gdelt_app.py
for why it runs as its own function in Singapore)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.gdelt_app import app  # noqa: E402
