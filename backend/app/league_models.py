"""
Pydantic request/response shapes for the Results League API
(routes/league.py, routes/admin.py). Kept apart from models.py, which covers
the original analyzer API.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ---------- Config ----------

class MetricDefinitionOut(BaseModel):
    key: str
    definition_key: str
    label: str
    unit: str
    definition: str
    min_value: float
    max_value: float


class ReasonTagOut(BaseModel):
    key: str
    label: str


class KpiTemplateOut(BaseModel):
    sector: str
    metric: MetricDefinitionOut
    source_hint: str


class LeagueConfigOut(BaseModel):
    market: str
    timezone: str
    confidence: float
    core_metrics: list[MetricDefinitionOut]
    kpi_templates: list[KpiTemplateOut]
    reason_tags: list[ReasonTagOut]
    excluded_sectors: list[str]
    note_max_chars: int


# ---------- Events ----------

class CompanyOut(BaseModel):
    id: int
    market_code: str
    exchange: str
    ticker: str
    name: str
    sector: str
    currency: str
    provider_symbol: Optional[str]


class EventSummary(BaseModel):
    id: int
    company: CompanyOut
    fiscal_year_label: str
    fiscal_quarter: int
    period_end_date: date
    season_label: str
    results_date: date
    lock_at: datetime
    # draft | open | locked | scored -- "locked" is derived from lock_at vs.
    # the database clock, never trusted from the client.
    status: str
    submitted: bool = False  # the requesting user has a forecast here


class EventDetail(EventSummary):
    metrics: list[MetricDefinitionOut]
    research_notes: Optional[str]
    # The database's clock at response time, so the countdown can correct
    # for a wrong device clock.
    server_now: datetime


# ---------- Forecasts ----------

class ForecastValueIn(BaseModel):
    metric_key: str
    low: float
    high: float

    @model_validator(mode="after")
    def _ordered(self) -> "ForecastValueIn":
        if self.low > self.high:
            raise ValueError("low must not be greater than high")
        return self


class ForecastIn(BaseModel):
    values: list[ForecastValueIn] = Field(min_length=1, max_length=5)
    reason_tags: list[str] = Field(default_factory=list, max_length=8)
    note: Optional[str] = Field(default=None, max_length=140)

    @field_validator("note")
    @classmethod
    def _blank_note_is_none(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return v.strip() or None


class ForecastValueOut(BaseModel):
    metric_key: str
    low: float
    high: float
    confidence: float


class ForecastOut(BaseModel):
    event_id: int
    submitted_at: datetime
    updated_at: datetime
    reason_tags: list[str]
    note: Optional[str]
    values: list[ForecastValueOut]
    locked: bool


# ---------- Profile ----------

class ProfileIn(BaseModel):
    handle: str = Field(min_length=3, max_length=20)
    age_band: str
    school_name: Optional[str] = Field(default=None, max_length=80)

    @field_validator("handle")
    @classmethod
    def _handle_chars(cls, v: str) -> str:
        v = v.strip()
        if not v.replace("_", "").isalnum() or not v.isascii():
            raise ValueError("Handles can use letters, numbers and underscores only.")
        return v

    @field_validator("age_band")
    @classmethod
    def _age_band(cls, v: str) -> str:
        if v not in ("under_18", "18_plus"):
            raise ValueError("age_band must be under_18 or 18_plus")
        return v


# ---------- Research panel ----------

class QuarterRow(BaseModel):
    period_end_date: date
    revenue: Optional[float] = None  # in the company's currency, as reported
    operating_margin_pct: Optional[float] = None


class ResearchHistoryOut(BaseModel):
    # yfinance: Total Revenue and Operating Income / Total Revenue -- its own
    # definitions, labelled as such in the UI, never passed off as the
    # event's metric definitions.
    provider_rows: list[QuarterRow]
    provider_source: str
    provider_definition: str
    provider_as_of: Optional[datetime]
    # Admin-entered actuals for this company's past periods, under the
    # league's own versioned definitions.
    actuals: list["ActualOut"]


# ---------- Admin ----------

class QuickEventIn(BaseModel):
    """Everything needed to set up one event in a single form."""

    market_code: str = "IN"
    exchange: str = Field(min_length=2, max_length=10)
    ticker: str = Field(min_length=1, max_length=20)
    company_name: str = Field(min_length=2, max_length=120)
    sector: str = Field(min_length=2, max_length=30)
    provider_symbol: Optional[str] = Field(default=None, max_length=30)
    fiscal_year_end_month: int = Field(default=3, ge=1, le=12)
    fiscal_year_label: str = Field(min_length=3, max_length=10)
    fiscal_quarter: int = Field(ge=1, le=4)
    period_end_date: date
    results_date: date
    lock_at: Optional[datetime] = None  # default: 23:59 local, day before results
    include_kpi: bool = True
    research_notes: Optional[str] = Field(default=None, max_length=2000)
    season_label: str = Field(min_length=2, max_length=20)
    open_now: bool = True


class EventPatch(BaseModel):
    results_date: Optional[date] = None
    lock_at: Optional[datetime] = None
    research_notes: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("draft", "open"):
            raise ValueError("status can only be set to draft or open here (scoring sets 'scored')")
        return v


class PeriodIn(BaseModel):
    company_id: int
    fiscal_year_label: str = Field(min_length=3, max_length=10)
    fiscal_quarter: int = Field(ge=1, le=4)
    period_end_date: date


class ActualIn(BaseModel):
    metric_key: str
    definition_key: str
    value: float
    source_url: str = Field(min_length=10, max_length=500)

    @field_validator("source_url")
    @classmethod
    def _http_url(cls, v: str) -> str:
        v = v.strip()
        if not (v.startswith("https://") or v.startswith("http://")) or " " in v:
            raise ValueError("source_url must be a full http(s) link to the source document")
        return v


class ActualOut(BaseModel):
    period_id: int
    fiscal_year_label: str
    fiscal_quarter: int
    period_end_date: date
    metric_key: str
    definition_key: str
    value: float
    source_url: str
    entered_at: datetime


class BaselineIn(BaseModel):
    metric_key: str
    lazy_value: Optional[float] = None
    analyst_value: Optional[float] = None
    ai_value: Optional[float] = None
    source_notes: Optional[str] = Field(default=None, max_length=500)


class ConsentIn(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        if v not in ("pending", "granted"):
            raise ValueError("status must be pending or granted")
        return v


class AdminUserOut(BaseModel):
    id: int
    email: str
    name: str
    handle: Optional[str]
    age_band: Optional[str]
    guardian_consent_status: Optional[str]
    school_name: Optional[str]


class AuditEntryOut(BaseModel):
    id: int
    at: datetime
    actor_user_id: Optional[int]
    action: str
    entity: str
    entity_id: str
    details: Optional[dict]


ResearchHistoryOut.model_rebuild()
