<!-- Moved word for word from CLAUDE.md on 2026-11-25 (master plan Z1). The index is CLAUDE.md. -->
# Guide and Practice

## First-visit guide and Practice (2026-11-18, phases A and B built, not deployed)

Plan, decisions and wording approved by Hriday (vault: `Areas/First-visit
guide and Practice (plan and wording, for approval)`). Phases: A spotlight +
guide (built), B practice on the 7 scored Q2 FY27 events, C extra quarters
after he approves a proposal file. Each phase stops for screenshots and
approval; no deploy without it.

- **Spotlight** (`SpotlightIntro.tsx`, rule in `lib/guideSeen.ts`
  `spotlightDecision`): once per browser (`stackly_guide_seen`, unreadable
  storage counts as seen) and once per account (`users.guide_seen_at`,
  schema v16, `POST /api/league/me/guide-seen`, `UserPublic.guide_seen`,
  cleared by delete_account). Only when the page load started on Home (a
  shared link first = never that visit), never over the reset or terms
  prompts. The app behind is `inert`, focus starts on "Show me", Escape skips.
- **Home**: the "How to play" band is gone (CSS too); a slim guide strip
  (`GuideStrip`, `#guide-entry`) sits under the headline.
- **Guide v2** `#/learn` (2026-11-19, rebuilding; the v1 accordion guide,
  pinned object and gold cord were deleted at Hriday's request). Ten
  full-screen pages (`GuidePage.tsx`) that stack like kigo.studio's services
  pages (motion only; reference GIFs in 03_logs/screenshots/2026-11-19-guide-v2):
  every page is sticky in ONE container with a one-screen spacer after it;
  the next page rises with the scroll tilted -7deg (pivot 50% 90%, eased
  (1-p)^1.5, measured from kigo) and the one beneath shrinks to 0.96 and
  darkens to 35% (`guideMotion.ts`, pure, tested). One rAF scroll listener on
  `.app-shell-content`; transform/opacity only; reduced motion = plain pages.
  The slider (2026-11-19 redraw, "smooth and precise"): `GuideSvg.tsx` +
  `GuideRail.tsx` draw track, gold capsule, knobs, segment pills, bars and
  the margin split as ONE inline SVG in CSS px (track 12/8px, capsule 16/12,
  knobs 22/20, vector steel ball 40/28, desktop/phone); transparent 44px hit
  areas are the keyboard sliders. Equal results stack like a dot plot
  (`restingPlaces`). Phone layout v2 (`.g2-ph`, all ten pages;
  `.g2-flip` mirrors even pages): big first fact, two small facts stacked
  right (number and line on one line), word up to 104px and never under
  64 (a long two-word title goes on two lines), indented text behind a rule,
  readout indented further, slider at the bottom bleeding off the screen.
  When a phone page doesn't fit, `fitOne` (always from scratch) hides the
  prompt (`is-tight-a`), then moves the made-up note under the scale
  (`is-tight-b`), then shrinks the word. Phones have no "3 / 10" pill: a 2px
  hairline at each page's share, plus "Page n of 10" for screen readers.
  Phone scale: at most 4 labels, 48px apart, 12px from the screen edge
  (`thinTicks`); pill names sit in a grid row under the pills. Sums never
  break inside (`keepSums`). Measure overflow with offsets against the
  bottom padding: Chrome's scrollHeight ignores a flex child running into it. Layout per page:
  facts, the big word fitted to the full content width (capitals at most
  260px, shrunk to the page's free height, refitted when a readout grows),
  text left with the object's readout right, the slab along the bottom.
  Plain graphite + grain, light mode via `--g2-*` variables. All ten pages
  built (`guideObjects.tsx`; quiz answers and score sums from
  `lib/scoring.ts`, tested). Wording approved 2026-11-19 (vault:
  `Areas/Guide v2 wording (for approval)`).
- **Guide v3** (2026-11-19; approved 2026-11-24, committed, not deployed). Replaces
  v2's look (the v2 bullet above is history for the look; the stack motion
  is unchanged). Hriday: the guide must look like Home. Every page reuses
  Home's parts: page colour + `HeroWaves`, `.hero-title` (gold last word) as
  the title, facts in `.strip-panel` (shared with Home's guide strip), Home's
  body text, site buttons (no arrow chips), Home's slider object via shared
  classes `.slab`, `.slab-range`, `.slab-shadow` + `.ball-skin` (HeroObject
  uses the same classes; change the material once). Bars and the picked
  segment are steel capsules (`.is-steel`, tones), never gold. Knobs show
  only on hover, focus or drag; touch uses the capsule ends. Sizes in
  `GuideSvg.tsx` (TALL/DESKTOP/PHONE). `GuideCompanyCard.tsx` = a small Home
  tile beside real numbers (pages 2, 3, 6, 7). Page 10 shows three
  PracticeTiles (`scrub={false}`, no badge) and is not sticky (`.is-last`).
  Spare height is shared between gaps (rule: no blank band over a quarter of
  the page). Wording approved 2026-11-19 (vault note, "v3 restyle").
  Decisions 2026-11-24: page 4 is "Sector number" with the pill "Everyday
  goods"; page 10's tiles keep Home's "Forecast" button and arrow. **Page 5
  has no balls and no test button** (Hriday 2026-11-24): ten thin marks
  (`GuideRail` `marks`, `.g2-mark`) at the made-up results, gold inside the
  range, dim steel outside, live while dragging; readout "Caught n of 10",
  "Width cost: n points" (`widthCost` in `lib/scoring.ts`) and the 80% line.
  Marks are 2px (phone) / 3px wide and never overlap: `markPlaces` spreads
  equal values 4px apart. Its prompt line ("Drag your range to see how many
  of the 10 results fall inside it.") is a draft awaiting approval (vault
  note, "24 Nov" section).
- **Guide layout pass** (2026-11-24, branch `guide-layout`, pages 1, 5 and 6
  only; the rest wait for Hriday's approval). A page with `layout` in
  `GuidePage.tsx` (`split` / `picker` / `stage`, `guideLayout.ts`) uses Home's
  hero composition (`LayoutSection`, `.g3-*` at the end of app.css): two-line
  title, 60ch paragraph with the first sentence in `--text`, facts panel, and
  on the right the object at Home's scale (`useSliderSizes(true)`) with its
  readout as a `.strip-panel`; centred vertically. Phones: title, company
  label, object, readout, paragraph, facts; the facts panel is hidden
  (screen readers keep it) when a page doesn't fit (`is-tight-facts`: pages
  1 and 6). Split slabs rest at Home's -6deg and flatten while held or
  keyboard-focused; touch screens and reduced motion keep them flat. Pointer
  maths reads the unrotated `.g2-rail-wrap` (`flatLeft`; the wrap must stay
  positioned). Picker = four graphite card tiles (`.g3-tile`), same toggle
  buttons. `.g3-sheet` isolates so HeroWaves show (they were painted under
  the opaque sheet). Plan: vault `Areas/Guide layout pass (24 Nov)`.
- **Practice** (phase B, `routes/practice.py`, `services/practice.py`,
  `components/practice/`, schema v17): scored, complete, non-demo league
  events; address `#/practice/<code>` (6-char code from the event id).
  Everything is cut on the server to the lock (quarters before the period,
  prices to min(lock, today-30) with the weekly rule). Mystery mode (default,
  `stackly_practice_mystery` in localStorage): no name/ticker/season/results
  date/source links/tip/fetch date, and dates on a relative calendar (the
  forecast quarter sits in year 100; months kept). Revenue and share price are
  always indexed (first = 100); no profit. The page reuses `CompanyStory`
  and `QuartersTable` via a `practice` prop (`lib/practice.ts` adapts the
  case). Attempts: `practice_attempts` (old Time Machine tables dropped only
  if empty, else the migration stops); first try per user+event enforced by a
  partial unique index, later ones `is_replay`; signed out / consent pending
  / no profile = scored, not saved. Never touches forecasts or scores. Home
  always shows "Practice while you wait" (below the open companies, or above
  "No companies are open" between seasons); the "Practice" badge is on
  Home's tiles only. The practice research table hides all-N/A quarters and
  has one "Sources and notes". Results tag (league and practice): green dot
  "Beat the lazy guess", grey "Lazy guess was closer", a tie keeps "Didn't
  beat the lazy guess". The prices route is in `main.py` (next to the price
  cache). Phase B wording approved 2026-11-18.
- `TERMS_VERSION` is 2026-11-18 (guide line added to the Privacy Policy).
  `LEGAL_UPDATED` moves to the deploy date. The "Your browser" line lacks
  "and your Mystery mode setting" until phase B adds that setting.
