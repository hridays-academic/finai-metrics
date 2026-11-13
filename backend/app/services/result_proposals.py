"""
Proposed results ("actuals") waiting for an admin's approval (2026-11).

Proposals are researched from each company's filings and committed as JSON in
backend/data/proposed_results/<FY>-Q<n>.json, one file per quarter, shipped
with a deploy. They are never written to the database by whoever prepares
them: an admin reviews them on the Companies board and approves, which saves
through the normal results endpoint and its checks (league_admin.put_results).

Matched to events by (ticker, fiscal year label, fiscal quarter) rather than
event id, because the file is prepared without access to production ids. A
proposal is only offered when its metrics and definition keys match the
event's own exactly; anything else is ignored with a warning in the log.
"""
import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field, ValidationError, field_validator

log = logging.getLogger(__name__)

PROPOSALS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "proposed_results"


class ProposedMetric(BaseModel):
    metric_key: str
    definition_key: str
    value: float
    source_url: str = Field(min_length=10, max_length=500)
    page: str = Field(min_length=1, max_length=200)
    working: str = Field(min_length=1, max_length=1000)
    flag: Optional[str] = Field(default=None, max_length=400)
    note: Optional[str] = Field(default=None, max_length=200)
    # Shown to students on the results and company pages (approved wording);
    # `note` is for the admin reviewing the proposal.
    student_note: Optional[str] = Field(default=None, max_length=300)

    @field_validator("source_url")
    @classmethod
    def _https(cls, v: str) -> str:
        if not v.startswith("https://") or " " in v:
            raise ValueError("source_url must be a full https link")
        return v


class ProposedEvent(BaseModel):
    ticker: str
    company: str
    metrics: list[ProposedMetric] = Field(min_length=1)


class ProposalFile(BaseModel):
    fiscal_year_label: str
    fiscal_quarter: int = Field(ge=1, le=4)
    prepared_on: str
    prepared_by: str
    approval_doc: Optional[str] = None
    events: list[ProposedEvent]


class Proposal(BaseModel):
    """One event's proposal, with the file it came from."""

    file: str
    prepared_on: str
    event: ProposedEvent


def load_dir(directory: Path) -> dict[tuple[str, str, int], Proposal]:
    """Every valid proposal in `directory`, keyed by (TICKER, FY label, quarter).
    A malformed file is skipped (and logged) so it can't take the admin page down."""
    out: dict[tuple[str, str, int], Proposal] = {}
    if not directory.is_dir():
        log.warning("Result proposals folder missing: %s", directory)
        return out
    for path in sorted(directory.glob("*.json")):
        try:
            parsed = ProposalFile.model_validate(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, ValidationError) as exc:
            log.error("Skipping result proposals file %s: %s", path.name, exc)
            continue
        for event in parsed.events:
            key = (event.ticker.upper(), parsed.fiscal_year_label.upper(), parsed.fiscal_quarter)
            if key in out:
                log.error("Duplicate result proposal for %s in %s; keeping the first", key, path.name)
                continue
            out[key] = Proposal(file=path.name, prepared_on=parsed.prepared_on, event=event)
    return out


@lru_cache(maxsize=1)
def all_proposals() -> dict[tuple[str, str, int], Proposal]:
    return load_dir(PROPOSALS_DIR)


def find(ticker: str, fiscal_year_label: str, fiscal_quarter: int, metric_definitions: list[dict],
         proposals: Optional[dict] = None) -> Optional[Proposal]:
    """The proposal for an event, if one exists and covers exactly the event's
    metrics under the event's own definitions."""
    proposals = all_proposals() if proposals is None else proposals
    proposal = proposals.get((ticker.upper(), fiscal_year_label.upper(), fiscal_quarter))
    if proposal is None:
        return None
    wanted = {(m["key"], m["definition_key"]) for m in metric_definitions}
    offered = {(m.metric_key, m.definition_key) for m in proposal.event.metrics}
    if wanted != offered:
        log.warning("Result proposal for %s %s Q%s doesn't match the event's metrics; ignored",
                    ticker, fiscal_year_label, fiscal_quarter)
        return None
    return proposal
