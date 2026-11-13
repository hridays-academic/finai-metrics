"""The research workspace's ten steps: titles, why each matters, and the
guiding questions per sector. Copied word for word from Areas/Research
workspace wording (for approval).md, approved by Hriday on 2026-11-13 with
his changes. Change wording only with approval.

Lines marked approved=True in the source doc were already approved earlier
(sector explainers 2026-10-19, Why it matters 2026-11-11) and are reused
verbatim; test_workspace.py checks they still match their originals."""
from dataclasses import dataclass, field
from typing import Optional

ALL = None  # an item shown for every sector


@dataclass(frozen=True)
class StepItem:
    text: str
    kind: str = "question"  # question | note
    sectors: Optional[tuple[str, ...]] = ALL


@dataclass(frozen=True)
class WorkspaceStep:
    key: str
    title: str
    why: str
    items: tuple[StepItem, ...] = field(default_factory=tuple)


def _q(text: str, *sectors: str) -> StepItem:
    return StepItem(text, "question", sectors or ALL)


def _note(text: str, *sectors: str) -> StepItem:
    return StepItem(text, "note", sectors or ALL)


_NO_FREE_SOURCE = "Stackly has no free source it may republish. Look for the company's own comments in its results presentation."

STEPS: tuple[WorkspaceStep, ...] = (
    WorkspaceStep(
        "business",
        "The business and the three numbers",
        "You can't forecast a number until you know what makes it move.",
        (
            _q("In one sentence, how does this company make money?"),
            _q("Which segment brings in the most revenue?"),
            _q("Read the three definitions. Which one do you understand least? Look it up in the glossary before you go on."),
        ),
    ),
    WorkspaceStep(
        "base",
        "Last year's same quarter (the base)",
        "Growth is measured against the same quarter last year, so an unusually strong or weak quarter last year "
        "changes this year's growth.",
        (
            _q("Was last year's quarter unusually strong or weak compared with the quarters around it?"),
            _q("Did anything one-off happen in it, such as a strike, a plant shutdown or an accounting change? "
               "The results filing's notes say so."),
            _q("The lazy guess is simply last year's number again. Do you expect this year to be higher or lower "
               "than that, and why?"),
        ),
    ),
    WorkspaceStep(
        "trend",
        "The recent trend",
        "The last four to eight quarters show which way revenue and margin have been moving and how much they swing.",
        (
            _q("Has revenue growth been speeding up, slowing down or steady?"),
            _q("Has the margin been rising, falling or steady? By how many percentage points?"),
            _q("Is there a pattern by season (one quarter always stronger or weaker)?"),
            _note("Building slows in the monsoon (July to September), so that quarter is usually weaker than the "
                  "ones around it.", "cement"),
        ),
    ),
    WorkspaceStep(
        "said",
        "What the company said",
        "In results and presentations, managers explain what drove the last quarter and what they're seeing now.",
        (
            _q("What did the company say about demand at its last results?"),
            _q("Did it mention price increases, cost pressure or new capacity?"),
            _q("Did it give any guidance for the year? Has it changed it since?"),
            _q("Did the company give revenue guidance for the year, and did it change it last quarter?", "it"),
            _note("It depends on the speaker: managers tend to sound hopeful, so compare their words with the "
                  "reported figures."),
        ),
    ),
    WorkspaceStep(
        "clues",
        "Clues already public",
        "Some of the quarter's numbers come out before results day.",
        (
            _q("Add up the company's three monthly sales releases for the quarter. That's the units KPI, and a big "
               "clue for revenue.", "autos"),
            _note("The units helper in the worksheet does the adding for you. Type the numbers from the releases.", "autos"),
            _note("These releases count vehicles sent to dealers, which can differ from what customers bought.", "autos"),
            _q("Has the company opened new plants in the past year? More capacity usually means more tonnes sold.", "cement"),
            _note("The volume KPI only appears if the company discloses it. If it doesn't, this event has no sector KPI.", "fmcg"),
            _q("Has it announced any big deal wins recently?", "it"),
        ),
    ),
    WorkspaceStep(
        "prices",
        "Prices and mix",
        "Revenue is volume times price, and price also moves when customers buy more of the expensive products or "
        "more of the cheap ones (the mix).",
        (
            _q("Were cement prices higher or lower this quarter than a year ago?", "cement"),
            _q("Did it sell more of its expensive models, or more of its cheap ones?", "autos"),
            _q("Revenue growth is roughly volume growth plus price increases. Did the company raise prices in the "
               "past year?", "fmcg"),
            _q("Is the company winning more work or charging more for it? Remember that a weaker rupee lifts revenue "
               "in rupees with no extra work.", "it"),
        ),
    ),
    WorkspaceStep(
        "costs",
        "Costs and inputs",
        "The margin depends on whether costs rise faster or slower than prices.",
        (
            _q("Are coal and petcoke prices up or down? That's the biggest swing in margin.", "cement"),
            _q("Are steel and aluminium prices up or down since last year?", "autos"),
            _q("Are palm oil and packaging costs up or down?", "fmcg"),
            _q("Is this the quarter it usually gives pay rises? That pulls the margin down.", "it"),
            _q("Costs bought earlier at old prices can delay the effect by a quarter or more. Which way would that "
               "push this quarter?"),
            _note(f"Steel and petcoke: {_NO_FREE_SOURCE}", "cement", "autos"),
            _note(f"Milk, wheat, sugar, tea: {_NO_FREE_SOURCE}", "fmcg"),
            _note("Salaries: the company's results say when pay rises take effect.", "it"),
        ),
    ),
    WorkspaceStep(
        "news",
        "News and events since the last results",
        "Anything that changed since the last results may change this quarter's numbers.",
        (
            _q("Which one or two items could matter most for revenue? For the margin?"),
            _q("For each, which way would it push, and what does it depend on?"),
            _q("Have any peers already reported? What happened to their revenue and margin?"),
        ),
    ),
    WorkspaceStep(
        "worksheet",
        "Your driver worksheet",
        "Turning your assumptions into numbers shows whether they fit together.",
        (_note("Every number here is your own. Stackly does the arithmetic and shows the formula."),),
    ),
    WorkspaceStep(
        "range",
        "Your range",
        "A range is how sure you are. Too narrow and you may miss; too wide and you lose points for width.",
        (
            _note("Each forecast is an 80% range: you should expect the real number to land inside it about 8 times "
                  "in 10. Your score starts at 100. Every percentage point of width costs 2 points. Every percentage "
                  "point you miss by costs 20 more. If the middle of your range is closer to the result than last "
                  "year's number (the lazy guess), you get 10 bonus points. Scores can't go below 0."),
            _q("Which of your assumptions are you least sure about? That's where your range should be widest."),
            _q("If the result landed at the edge of your range, would that surprise you? If not, your range may be "
               "too narrow."),
        ),
    ),
)

STEP_KEYS = tuple(s.key for s in STEPS)
NOTE_MAX_CHARS = 2000

# Text reused from earlier approvals; the test checks each still appears in
# its source (league_config explainers or news_explanations).
REUSED_FROM_EXPLAINERS = (
    "Building slows in the monsoon (July to September), so that quarter is usually weaker than the ones around it.",
    "Did the company give revenue guidance for the year, and did it change it last quarter?",
    "Add up the company's three monthly sales releases for the quarter. That's the units KPI, and a big clue for revenue.",
    "Has the company opened new plants in the past year? More capacity usually means more tonnes sold.",
    "The volume KPI only appears if the company discloses it. If it doesn't, this event has no sector KPI.",
    "Has it announced any big deal wins recently?",
    "Were cement prices higher or lower this quarter than a year ago?",
    "Did it sell more of its expensive models, or more of its cheap ones?",
    "Revenue growth is roughly volume growth plus price increases. Did the company raise prices in the past year?",
    "Are coal and petcoke prices up or down? That's the biggest swing in margin.",
    "Are steel and aluminium prices up or down since last year?",
    "Are palm oil and packaging costs up or down?",
    "Is this the quarter it usually gives pay rises? That pulls the margin down.",
)
REUSED_FROM_NEWS = (
    "It depends on the speaker: managers tend to sound hopeful, so compare their words with the reported figures.",
)


def steps_for(sector: Optional[str]) -> list[dict]:
    return [
        {
            "key": s.key,
            "title": s.title,
            "why": s.why,
            "items": [{"text": i.text, "kind": i.kind} for i in s.items if i.sectors is ALL or sector in i.sectors],
        }
        for s in STEPS
    ]
