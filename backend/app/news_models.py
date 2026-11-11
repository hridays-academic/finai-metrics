"""Request/response shapes for the news, world events and macro endpoints."""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.news_config import NEWS_SECTORS

WorldEventSector = Literal["economy", "cement", "autos", "fmcg", "it"]


class NewsItem(BaseModel):
    title: str
    url: str
    publisher: str
    published_at: str
    theme: str
    theme_label: str
    why: str
    publisher_domain: Optional[str] = None
    sectors: list[str] = []
    chain: Optional[str] = None
    explanation: Optional[str] = None
    # Set in the "All" view when the line is a sector's (not the economy's).
    sector_label: Optional[str] = None


class NewsList(BaseModel):
    items: list[NewsItem]
    has_more: bool
    updated_at: Optional[str] = None


class WorldEvent(BaseModel):
    id: int
    title: str
    event_date: str
    sectors: list[str]
    sector_labels: list[str]
    why: str
    why_long: Optional[str] = None
    chain: Optional[str] = None
    source_url: Optional[str] = None
    pinned: bool
    show_until: Optional[str] = None


class WorldEventIn(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    event_date: date
    sectors: list[WorldEventSector] = Field(min_length=1)
    why: str = Field(min_length=10, max_length=200)
    # The longer explanation shown in the "Why it matters" popover.
    why_long: Optional[str] = Field(default=None, max_length=800)
    chain: Optional[str] = Field(default=None, max_length=200)
    source_url: Optional[str] = Field(default=None, max_length=500)
    pinned: bool = False
    show_until: Optional[date] = None

    @field_validator("source_url")
    @classmethod
    def _http_only(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip() or None
        if v is not None and not v.startswith(("https://", "http://")):
            raise ValueError("The source link must start with https://")
        return v


class MacroPoint(BaseModel):
    date: str
    value: float


class MacroSeriesOut(BaseModel):
    key: str
    label: str
    unit: str
    source: str
    source_url: str
    frequency: str
    sectors: list[str]
    status: Literal["ok", "coming_soon", "unavailable"]
    points: list[MacroPoint]
    data_to: Optional[str] = None
    fetched_at: Optional[str] = None


class Filing(BaseModel):
    url: str
    subject: str
    filed_at: str
    type_label: Optional[str] = None
    why: Optional[str] = None
    chain: Optional[str] = None
    explanation: Optional[str] = None


class Video(BaseModel):
    video_id: str
    title: str
    channel: str
    published_at: str
    duration_seconds: Optional[int] = None
    theme: str
    theme_label: str
    why: str
    chain: Optional[str] = None
    explanation: Optional[str] = None


class CompanyNews(BaseModel):
    tracked: bool
    company_name: Optional[str] = None
    sector: Optional[str] = None
    sector_label: str
    filings: list[Filing]
    filings_since: Optional[str] = None
    nse_url: str
    company_news: list[NewsItem]
    sector_news: list[NewsItem]
    world_events: list[WorldEvent]
    macro: list[MacroSeriesOut]
    videos: list[Video] = []
    updated_at: Optional[str] = None


NEWS_VIEWS = ("all", "economy", *NEWS_SECTORS)
