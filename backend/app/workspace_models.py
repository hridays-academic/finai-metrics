"""Request/response shapes for the research workspace (routes/workspace.py)."""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.workspace_config import NOTE_MAX_CHARS, STEP_KEYS

# Worksheet inputs, all the student's own numbers (percent, or percentage
# points for the IT margin adjustments). Which ones a sector uses is the
# frontend's business; the server only checks they're sane.
INPUT_KEYS = ("volume", "price", "cost", "cc", "fx", "pay", "fx_margin", "other")
METRIC_KEYS = ("revenue_growth_yoy", "operating_margin", "sector_kpi")


def _finite(v: Optional[float], lo: float, hi: float, what: str) -> Optional[float]:
    if v is None:
        return None
    if not math.isfinite(v) or not lo <= v <= hi:
        raise ValueError(f"{what} must be between {lo:g} and {hi:g}.")
    return v


class UnitsHelper(BaseModel):
    this_year: list[Optional[int]] = Field(default_factory=lambda: [None, None, None], min_length=3, max_length=3)
    last_year: list[Optional[int]] = Field(default_factory=lambda: [None, None, None], min_length=3, max_length=3)

    @field_validator("this_year", "last_year")
    @classmethod
    def _units(cls, v: list[Optional[int]]) -> list[Optional[int]]:
        for n in v:
            if n is not None and not 0 <= n <= 10_000_000:
                raise ValueError("Units must be between 0 and 10,000,000.")
        return v


class Worksheet(BaseModel):
    inputs: dict[str, Optional[float]] = Field(default_factory=dict)
    units: Optional[UnitsHelper] = None
    base: Optional[Literal["last_year", "last_quarter", "own"]] = None
    own_base: Optional[float] = None
    unsure: dict[str, Optional[float]] = Field(default_factory=dict)

    @field_validator("inputs")
    @classmethod
    def _inputs(cls, v: dict[str, Optional[float]]) -> dict[str, Optional[float]]:
        unknown = set(v) - set(INPUT_KEYS)
        if unknown:
            raise ValueError(f"Unknown worksheet input: {', '.join(sorted(unknown))}.")
        return {k: _finite(x, -100.0, 500.0, "Each assumption") for k, x in v.items()}

    @field_validator("own_base")
    @classmethod
    def _own_base(cls, v: Optional[float]) -> Optional[float]:
        return _finite(v, -100.0, 100.0, "The starting margin")

    @field_validator("unsure")
    @classmethod
    def _unsure(cls, v: dict[str, Optional[float]]) -> dict[str, Optional[float]]:
        unknown = set(v) - set(METRIC_KEYS)
        if unknown:
            raise ValueError(f"Unknown metric: {', '.join(sorted(unknown))}.")
        return {k: _finite(x, 0.0, 100.0, "How unsure you are") for k, x in v.items()}


class WorkspaceIn(BaseModel):
    """Every field is optional; only the fields sent are changed. Notes
    merge per step (so two devices editing different steps don't clash);
    `done` replaces the list; `worksheet: null` clears the worksheet."""

    notes: Optional[dict[str, str]] = None
    done: Optional[list[str]] = None
    worksheet: Optional[Worksheet] = None

    @field_validator("notes")
    @classmethod
    def _notes(cls, v: Optional[dict[str, str]]) -> Optional[dict[str, str]]:
        if v is None:
            return v
        unknown = set(v) - set(STEP_KEYS)
        if unknown:
            raise ValueError(f"Unknown step: {', '.join(sorted(unknown))}.")
        for text in v.values():
            if len(text) > NOTE_MAX_CHARS:
                raise ValueError(f"Notes can be up to {NOTE_MAX_CHARS:,} characters per step.")
        return v

    @field_validator("done")
    @classmethod
    def _done(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        if v is None:
            return v
        unknown = set(v) - set(STEP_KEYS)
        if unknown:
            raise ValueError(f"Unknown step: {', '.join(sorted(unknown))}.")
        return [k for k in STEP_KEYS if k in set(v)]


class WorkspaceState(BaseModel):
    notes: dict[str, str] = Field(default_factory=dict)
    done: list[str] = Field(default_factory=list)
    worksheet: Optional[Worksheet] = None
    updated_at: Optional[datetime] = None


class StepItemOut(BaseModel):
    text: str
    kind: str


class StepOut(BaseModel):
    key: str
    title: str
    why: str
    items: list[StepItemOut]


class GlossaryEntry(BaseModel):
    term: str
    definition: str
    source: str  # league | glossary


class BaseFigure(BaseModel):
    """A league figure (league definitions, from the company's filing)."""

    metric_key: str
    value: float
    source_url: str
    fiscal_year_label: str
    fiscal_quarter: int


class WorkspaceOut(BaseModel):
    event_id: int
    sector: str
    locked: bool  # forecasts locked: the worksheet is hidden and can't be saved
    status: str
    steps: list[StepOut]
    glossary: list[GlossaryEntry]
    last_year: list[BaseFigure]  # the same quarter last year
    last_quarter: list[BaseFigure]  # the quarter before, only where the league has it
    news_since: Optional[date]  # the last results date before this event, if known
    # Why saving is off for this visitor, or None when it's on: sign_in |
    # terms_required | profile_required | guardian_consent_pending.
    save_blocked: Optional[str]
    state: Optional[WorkspaceState]  # None when signed out
