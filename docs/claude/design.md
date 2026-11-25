<!-- Moved word for word from CLAUDE.md on 2026-11-25 (master plan Z1). The index is CLAUDE.md. -->
# Design and voice

## Voice and engagement (Hriday, 2026-11-17; applies to every page)

- **Write for a curious 14-year-old**: short sentences, everyday words, one
  idea per line, a light and friendly tone. Explain a finance word the first
  time it appears, or link it to the glossary. Never talk down; no slang
  that will date.
- **Accuracy beats simplicity**: definitions, scoring rules, legal text and
  source notes keep their exact meaning. If a simpler line would change the
  meaning, keep the original and say so.
- **Teach step by step**: big ideas arrive as small numbered steps (as in the
  story, the workspace and the share price chapter), each building on the
  last.
- **Colour with purpose**: highlight key words and numbers in the company's
  own card colour, only for the few things a student must notice, never
  whole paragraphs. Gold stays only for the student's own range and score,
  plus Home's decorative accents (Hriday, 2026-11-17: the headline's
  "results", capsules under Home's titles, "How it works" numerals, a glow
  behind the hero toy).
- **Link the share price briefly and never as a target**: results can move
  the share price over time; prices are at least 30 days old; no
  buy/sell/hold, no predictions.
- **The ball is a Home-only toy**: it lands on tiles and panels, drops into
  the gold range to go back on the slider, and docks when you leave Home. No
  score counter. It must never block a click, cover text or appear on other
  pages, and it is off under reduced motion.
- **Every animation either explains something or answers an action**;
  reveals play once; all motion is off under reduced motion.
- **New wording follows the approved-wording rule**: drafts go in the vault
  for approval before they go live.

## Flat and sharp pass (2026-11-18, Hriday; wins over Redesign v3 below)

- **Corners**: softened twice the same day (Hriday: "a bit more round,
  too blocky", then "slightly rounder"): `--radius-panel` 18px (cards,
  panels, tiles), controls and buttons 12px (`--radius-control`,
  `--radius-pill`), small badges 8px (`--radius-small`); every literal radius in app.css now reads a token.
  Only objects stay fully round: the hero track/range/ball, scrollbars,
  thin value/range bars, dots.
- **Home texture** (2026-11-18): Home tiles carry the 3D card's engraving
  and grain (`.tile-material`), and a faint field of the same engraved
  lines (`HeroWaves` in `CardArt.tsx`, every fifth line gold) sits behind
  the headline and runs down under "Open for forecasts", its edges faded by
  a mask (the page itself stays flat).
- **Less symmetry** (2026-11-18, Hriday: boxes "too symmetrical, in a line
  and grid"): `TileGrid` (`useBalancedGrid.rowShares`) is now a wrapping
  flex row with one wide card per row whose place moves each row (2 across
  58/42 then 42/58; 3 across 42/29/29; 4 across 31/23/23/23; 5+ equal;
  equal for a row where a share would go well under `minTile`); short last
  rows fill the width instead of being centred. Home's tiles pair 7/5 then
  5/7 columns with a shorter second row (a narrow tile's button wraps under
  its figures), and the results
  page's "How it turned out" is 5/4/3. Wide screens only; phones keep one
  column. The Home hero lines were made fainter so the front pops. "How it
  works" stays in one line (a staircase was tried and reverted).
- **Smaller type** (Hriday, "text smaller everywhere"): the type tokens are
  about 10% smaller (body 15px, small 14px, hero clamp(48px, 7.2vw, 108px))
  and literal sizes in app.css were scaled to match.
- **Slow movement** (Hriday, "make them move slowly"; his exception to "every
  animation explains something"): Home's tiles float a few pixels on long
  out-of-step cycles (`translate`, so hover still works), and the tile and
  hero engraving drifts sideways. Off under reduced motion.
- **Highlights and wording**: gold marker (`.hl-gold`) under a few words in
  "How to play". Catchier Home wording approved and live 2026-11-18 (vault:
  `Areas/Catchier wording (for approval)`): "Look around for free", "Your
  turn: pick a company", "Shuffle companies", "Just reported", "How to
  play" and its three steps; the results page's section is "What really
  happened" (the company page keeps "How it turned out").
- **No gradients on surfaces**: tiles, 3D cards, the results header, the
  top story, news/video/macro cards, panels and gold accents are flat
  colour. The company colour now shows as flat fills, a faint flat tint on
  panels, solid top edges and the difficulty band. Gradients left on
  purpose: the hero slider and ball, the 3D card's moving light and rims,
  soft shadows, scrollbar thumbs, hard-stop stripes (`.hl-under`, the news
  title strip).
- **Difficulty words** are "Easy / Medium / Hard" (Hriday, 2026-11-18) on
  a see-through dark band (black 26%, so the card's engraving and grain
  show through it) down the left edge (`DifficultyEdge.tsx`,
  `.edge-label`; screen readers hear "... to forecast"): Home tiles, both
  3D cards, the results header. The colour note above Home's tiles is gone.
- **No captions or intros**: footnotes and source lines are folded into a
  "Sources and notes" toggle (`FinePrint.tsx`, native `<details>`, text
  unchanged). Removed: Home's hero lede, the workspace and worksheet
  intros, the chart's "scroll or pinch" hint. Kept visible on purpose: the
  "at least 30 days old" price labels and the search page's liability line.
- Open: Hriday saw an empty "tab" at the bottom of Research; not found in
  checks (live, desktop and phone), left for him to point at.

## Redesign v3 (2026-11-15 to 2026-11-17; wins over every design section below)

Feedback said the site looked AI-generated; Hriday set a "final direction"
(dark first, Barlow Condensed headlines, frosted glass, sector colour
blocks). Everything in "Design system", "Liquid Glass" and "Liquid Glass
polish" below is history: the wallpaper, cursor light, palettes (Aurora/
Graphite), CountUp, the reveal fallback, tilt and ArrowChip are deleted.

- **Files.** `theme.css` = v3 tokens: dark by default, **light mode**
  (2026-11-17) under `:root[data-mode="light"]` at its end (first visit
  follows the device; AA checked by script, numbers in the block's
  comment), then an alias block mapping old token names that `legacy.css`
  still reads. `legacy.css` = the old app.css minus every rule the v3 layer
  owns and every dead class (pruned 2026-11-17, 3,935 lines); it still holds
  live rules (admin internals, tooltips, worksheet fields, the hidden
  tools). `app.css` = the v3 layer, loaded last; a `[data-mode="light"]`
  block near its end covers the few hard-coded tints. Before adding a
  className, check it has CSS (a script check found the "incomplete" look
  twice).
- **Tokens.** Page #0B0D12, text #F7F8FA, secondary #A7B0C0. Glass panels
  (`.glass.panel`: white 7%, 32px blur, lit top edge, dark bottom edge,
  24px radius); raised glass inside them; never blur inside blur. Capsule
  buttons: primary off-white, raised; hover lifts 3px + scale 1.04 (mouse
  only), press sits 1px below rest; the arrow is a real element
  (`.btn-arrow-icon`) and tilts to ↗ only while hovered itself. `--gold`
  only for the student's own range and score; green/red for hit/miss and
  up/down; orange "locks soon".
- **Company colour = how hard it is to forecast** (`lib/difficulty.ts`,
  Hriday 2026-11-17, tested): the harder band of (operating margin's range
  over Stackly's quarters: <3 / 3-7 / >7 points) and (swing in
  quarter-to-quarter revenue change: <10 / 10-25 / >25 points). Easy =
  emerald, medium = cobalt, hard = violet (`.difficulty-*`, reusing the
  sector token sets); too little data = graphite (`.sector-neutral`).
  Labels "Easy/Medium/Hard to forecast", the note above Home's tiles and
  the glossary's "Difficulty" are approved wording (vault: `Areas/Difficulty
  colours`). Home tiles, both 3D cards, the company page, workspace and
  Research use it; league companies are always measured on the league's
  research history so the colour matches everywhere. Pages with a company
  carry `.company-colour` (a soft glow and tinted panel edges) and the
  difficulty class, which highlights use (equation terms, last year's
  numbers, key-insight underline, workspace numbers). The sector tokens
  (autos #1F4FD6, FMCG #077A4C, IT #6A3FD8, cement #DBA13D, and January's
  banks, pharma, energy, metals; text checked on all shades) stay in
  `theme.css`; the `.sector-*` classes except `neutral` were removed.
- **Type.** Barlow Condensed 700/800 (self-hosted, OFL in `public/fonts/`)
  for hero/chapter/tile headlines only, uppercase; system font for the rest.
- **Scroll motion everywhere** (`hooks/usePageMotion.ts`, called once in
  App): every top-level `.glass.panel` in `.app-main` rises with the scroll
  (eased, both ways); Home also marks tiles/titles/steps/band with
  `data-scrub`. Positions come from offsetTop (ignores transforms), reads
  before writes, and an element's transform is cleared once it has arrived.
  Never put `overflow` on an ancestor of these.
- **Company page** (`CompanyStory.tsx`): a pinned story 8 screens tall with
  six chapters (How it makes money, Last year's numbers, Where it's heading,
  Your checklist, Results and the share price, Your turn). A CSS 3D card
  (`CardArt.tsx` artwork: guilloche, grain; light follows its rotation;
  laid out at 1.2x and scaled down so the per-chapter 1.12x zoom stays
  sharp) turns continuously; text and the big faded word move with the
  eased scroll. Chapter 05's steps light up one by one, then a year of
  weekly prices (30-day lag) draws in. Reduced motion or no sticky: a flat
  list.
- **Home hero** (`HeroObject.tsx`): a gold range on a recessed track and a
  textured ball (`BallSkin` in `FreeBall.tsx`: dimples and seam that turn as
  it rolls, fixed shading). The range follows the pointer on a spring; the
  ball rocks in a shallow dip, can be thrown, tapped to hop. Dragged out of
  the scene it comes loose (`lib/ballStore.ts`, `FreeBall.tsx`, Home only):
  gravity, lands on tiles/panels, rests at the screen bottom, double tap =
  top of Home; dropping it into the gold range (or leaving Home) puts it
  back on the slider. Decorative, aria-hidden, pointer only.
- **Research** restyled: hero with key figures and a small draggable 3D card
  (`ResearchCard.tsx`: spins in, coasts, brakes evenly to face you, lets go
  after 1.5 s held; sector from `lib/leagueSector.ts`, else graphite);
  sticky section bar (`ResearchSectionNav.tsx`); ratios always shown (no
  "Show all ratios" toggle) as one panel per group with row lists; thin
  comparison bars in the ratio lists (same unit only) and the peers table;
  sparklines/price chart draw in once (`hooks/useOnceVisible.ts`); "Why it
  matters" chains step in 250 ms apart. Animations play once per visit, are
  transforms/opacity (plus SVG line drawing and the price chart's clip), and
  are off under reduced motion.
- **Workspace** restyled (outlined step numeral, numbered question cards,
  lettered glossary cards, callouts). Its step titles and "why" lines and
  the Home/story wording were simplified 2026-11-16 (vault: `Areas/Simpler
  wording draft (for approval)`, approved); Home's headline is "Forecast
  company results" (Hriday, 2026-11-17).
- **The page scrollbar** on mouse devices is `PageScrollbar.tsx`: it floats
  over the page (the native one is hidden from first paint by
  `public/theme-init.js`, class `custom-scrollbar`), so full-width parts
  reach the edge: a semi-transparent frosted pill socket holding a glossy
  silver pill with a shadow. Drag it or click the track; wheel and keyboard
  are native. Touch screens keep their own. The peers table keeps a native
  bar in the same style (WebKit pseudo-elements; Firefox flat colours,
  since `scrollbar-color` disables the pseudo-elements in Chrome 121+).
- **Story strip**: one white pill slides between chapters while the
  current chapter's name opens (900 ms, ease-in-out sine, since 2026-11-18:
  Hriday asked for "smoother and slower"; `hooks/useSlidingPill.ts`, each
  name opens to its measured width `--label-w` so the opening runs evenly).
  Research's section bar uses the same hook and pill (company colour); the story is full-bleed and starts flush
  with the screen so the strip sits the page margin above the bottom. On
  phones the skip button is hidden (the 06 tab does the same) and the strip
  spreads its six numbers.
- **Results page**: score in large gold, gold range bars, ticker under the
  name. Since 2026-11-17 it is in the company's difficulty colour
  (`hooks/useCompanyDifficulty.ts`, cached per company): a card-material
  header with the season and difficulty label, numbered metric badges, and
  "How it turned out" as cards with the result on a colour marker. Home's
  "Recent results" rows carry the same colour (swatch + label). Rows rise
  with the scroll (`data-scrub="row"` in `usePageMotion`). **Sheets** (Settings, account, sign-in) float as frosted glass.
- **Accessibility**: focus ring on everything reachable, 44px targets on
  touch screens, segmented controls scroll rather than wrap; under reduced
  motion the hero, the loose ball and the Research card are still.
- Frame rate at 390px with CPU 4x (2026-11-17): Home 56.8 fps, story 59.3,
  Research 59.9.
- **Not built yet**: the three.js Home scene; deleting `legacy.css` (port
  its live rules first). **Backlog:** return the student's own
  range inside the recent-results response, so Home stops making up to 5
  `my-result` calls to draw it.

## Design system (2026-11 design pass)

Approved by Hriday 2026-11-06 after a screenshot audit. Goal: calm,
Apple-quality, not "vibe coded". Rules to keep:

- **Tokens only.** `theme.css` holds every colour, spacing step
  (`--space-1..10`, a 4/8 scale), radius, type size, control height and
  motion value. `app.css` reads tokens; a literal hex, rem spacing or radius
  in a new rule is a bug. The older per-feature rules in `app.css` were
  mapped onto the tokens by script; the "Design system" layer at the END of
  `app.css` defines the shell, buttons, forms, grouped lists, sheets and the
  league screens, and deliberately wins over the older rules above it.
- **Two radii**: `--radius-sm` (8px, controls) and `--radius-lg` (14px,
  surfaces). Circles (avatars, dots) and 2-4px bar ends are shapes, not radii.
- **One mode axis**: `data-mode` light/dark only. The green/blue colour
  themes and their picker were removed (git has them; no "Blue" revert path
  any more). `useTheme` still sets the attribute in a `useLayoutEffect`
  (see below for why).
- **Colour**: neutral greys; ONE accent (blue) for primary actions, links,
  focus and key highlights; `--positive`/`--negative` (green/red) ONLY for
  numbers that rose/fell or a forecast that hit/missed, including chart
  lines (PriceChart colours by period direction) and the results number line
  (your range = accent, actual = green if hit / red if miss, lazy and crowd
  marks grey). `--caution` (amber) = "needs attention" (lock soon, admin
  to-dos). Every text token is >= 4.5:1 on every surface in both modes
  (checked by script 2026-11-06); re-check if you change one.
- **Glass** only on the top bar, sidebar/phone tab bar and sheets (`.sheet`:
  settings/account slide-over, modals): translucent fill + `blur(20px)
  saturate(180%)` + light edge. Solid fallback when `backdrop-filter` is
  unsupported or `prefers-reduced-transparency` is set. Never on content.
  The content column (`.app-shell-content`) is the scroll container so
  content scrolls under the sticky header and the phone tab bar.
- **Type**: system font stack (`--font-sans`), no web fonts at all (Google
  Fonts removed, charts read `--font-sans` too). `font-variant-numeric:
  tabular-nums` is set on `body`.
- **Buttons**: `.btn` + `.btn-primary` (one per screen) / `.btn-secondary`
  (tinted) / `.btn-tertiary` (text) / `.btn-destructive` /
  `.btn-destructive-filled`, `.btn-block`, `.btn-compact`. 44px minimum
  height, hover changes background, press darkens + scales to
  `--press-scale` in `--duration-press` (both zero under reduced motion),
  `:focus-visible` ring, `aria-busy` shows a spinner (set it while saving,
  together with `disabled`), disabled is grey not faded. Also `.segmented`,
  `.chip`, `.link-button`, `.status-text` (a dot plus a word, never colour
  alone).
- **Layout primitives**: `.page` (+`.page-wide`), `.page-header`,
  `.page-title`, `.page-lede`, `.section`, `.section-title`, `.group` (one
  surface with hairline dividers, used for the home list, My forecasts,
  results and the admin board), `.field`/`.field-label`/`.input`/
  `.field-hint`/`.form-error`/`.checkbox-row`, `.table-wrap`/`.data-table`.
- **No decorative motion**: the animated backdrop glow, fade-in-on-mount,
  hover lifts, gradients and shimmer were removed. Only sheet slide/fade,
  popovers and spinners animate, all on the motion tokens.
- **Copy**: plain and specific; no em dashes (or " -- ") in visible text,
  no buzzwords, no exclamation marks. This includes server-side text
  (`metrics.py` popovers, `research_history.py`).
- Home rows show everything (sector, results date, lock countdown,
  description, latest-quarter revenue/profit with source and date); the old
  hover/tap-to-expand cards are gone. "Show different companies" replaces
  all four.
- Screenshots for checking a change: there's no committed harness; a
  Playwright script that mocks open events/admin user/a scored result was
  used for the 2026-11-06 pass (scratchpad only, not committed).

### Liquid Glass (2026-11-06, second pass; replaces parts of the above)

Approved by Hriday after a home-page trial. Where this conflicts with the
bullets above, this wins.

- **Always on**: `.app-shell` carries `lg`; every rule lives under `.lg` in
  the "Liquid Glass" sections at the end of `app.css`. Tokens are in the
  "Liquid Glass" block at the end of `theme.css` (`:root` level, so the
  charts' `getComputedStyle(document.documentElement)` reads them too).
- **Palettes**: Aurora (default) and Graphite, chosen in Settings (Theme +
  Mode), saved per browser (`finai-metrics-palette`, try/catch, falls back to
  Aurora), set as `data-palette` on `<html>`. Deep ocean was tried and
  removed. A palette block must repeat every variable it changes in both
  modes (the light Graphite block outranks the rest).
- **Radii**: `--radius-panel` 24px (glass panels, bars, sheets),
  `--radius-inner` 16px (anything inside a panel), `--radius-pill` (buttons,
  segmented, chips). This supersedes the 8/14 pair for live screens.
- **Wallpaper** (`Wallpaper.tsx`): four pre-blurred radial-gradient fields
  on two parallax layers, 21-29s flow/morph loops (transform + opacity only),
  mouse parallax eased in rAF (writes only `--px/--py`), a tint that fades
  in on scroll, paused while the tab is hidden, static under reduced motion.
  The content column must stay `position: relative; z-index: 1` or the fixed
  wallpaper paints over non-positioned content (a real bug, hid the footer).
- **Glass**: `.glass` = translucent fill + sheen + `blur(28px) saturate(180%)`
  + inner edge highlight + layered shadow. `.glass .glass` drops the blur
  (no nested blur, the main phone cost) and becomes an inset surface. Solid
  fallback without backdrop-filter or with reduced transparency.
- **Contrast**: text tokens are retuned for glass and checked against the
  worst case (glass over the brightest wallpaper field) per palette and
  mode. Re-run that check if you change a wallpaper or text colour.
- **Cursor light** (`useCursorLight.ts`): one pointermove listener, one rAF
  per frame, reads rects then writes `--mx/--my/--light` on the hovered
  `.btn` and its `.glass` panel. Mouse only; off under reduced motion.
- **Scroll motion**: CSS scroll-driven animations on the `--page` scroll
  timeline (content column; `timeline-scope` on `.lg`) and `view()`: hero
  recedes, top bar turns solid + progress line, panels (`.reveal`) and rows
  (`.reveal-row`) glide in, wallpaper tint. Fallback: `useRevealFallback.ts`
  (global IntersectionObserver + MutationObserver) for browsers without
  `animation-timeline`. Ranges are fixed lengths (`entry 0px entry 240px`),
  not percentages, so a tall panel isn't left blurred half on screen.
  `CountUp.tsx` counts revenue/profit up once on first view.
- **"Locks soon"** (<24h): a tinted pill badge with a clock icon and
  primary-colour text (`--soon-bg`, coral in Graphite, amber in Aurora), so
  it can't be confused with Graphite's amber links and doesn't rely on
  colour. A coral text colour was rejected: same hue as the negative red and
  under 4.5:1 on dark glass.
- **Home between seasons**: when nothing is open it lists the locked
  companies ("Results due 27 Oct" / "Results out, scoring soon") plus "How
  it works". Rows: name, one status line, description, Revenue/Profit in
  aligned columns (labels once per list), one action; one source footnote
  per panel.

### Liquid Glass polish (2026-11-07, third pass; wins over the above)

Specified by Hriday; the CSS is the "Liquid Glass polish (2026-11-07)" block
at the end of `app.css`.

- **Spacing**: `--panel-gap` 24px (16px phone) between panels on every page,
  `--panel-pad` 32px (20px) inside every panel, `--tile-gap` 12px,
  `--title-gap` 16px under every panel/section title. Stacked children get
  their spacing from the gap only (margins zeroed).
- **Tiles** (`TileGrid.tsx` + `hooks/useBalancedGrid.ts`; widths now uneven,
  see "Flat and sharp pass"): equal-height rows,
  column count chosen per section so no tile sits alone (5 tiles: 5 across,
  else 3 + 2 centred; two columns on phones, an odd last tile spans the row).
  Every ratio tile has a status line: Healthy/Watch/Weak, or "No benchmark"
  / "No data" (hollow dot) for neutral metrics.
- **Tooltips** (`Tooltip.tsx`, portalled to `<body>`): glass, `--lg-tooltip`
  55% fill + `blur(40px) saturate(180%)`. Text checked >= 4.7:1 per palette
  and mode even over a mid-grey backdrop; re-check if you lower the fill.
- **Motion rules**: nothing tilts (the 3D tilt and pointer lean on tiles,
  cards and rows were removed 2026-11-11 at Hriday's request; don't bring
  them back). Panels only rise in (translateY + opacity); small things
  (`.tile`, `.reveal-row`, `.reveal-item`) rise in on scroll
  (`lg-rise-in-small`: translateY, opacity, slight scale), staggered by
  `--col`. The cursor spotlight stays (`useCursorLight.ts`, `--mx/--my/--light`).
  Buttons: scale 1.02 on hover (mouse only), 0.97 on press. The arrow chip turns
  → to ↗ only when its own button (or a row's action pill) is hovered or the
  control has keyboard focus, never on row hover. Hover effects sit in
  `@media (hover: hover)`; everything is off under reduced motion.
- **Every scroll entrance finishes once its element is fully on screen**
  (`entry 0% entry 100%`; panels `entry min(100%, 200px)`), and
  `useRevealFallback.ts` snaps anything still mid-entrance to its final state
  (`.is-settled`) once the page can't scroll further. **Never put
  `overflow: hidden/auto` on an ancestor of animated elements**: it becomes
  their scroll container and their `view()` timeline stops following the
  page. That was the cause of the faded Valuation panel
  (`.expanded-details` now uses `overflow: clip`, `.metrics-pane` visible).
- **Company page**: header stat callouts (latest revenue, profit, margin from
  the research history, results date, lock) with source and fetch date;
  the explainer is lead sentence, equation chips, three drivers, a "Key
  insight" callout and a checklist; research notes are a "Tip" callout;
  revenue and margin sparklines (`QuarterSparkline.tsx`, real values only,
  gaps for missing quarters, two separate charts, never a dual axis) sit
  with the quarters table. `ForecastPage` fetches the research history once
  and passes it down.

**Responsive breakpoints (`app.css`).** (Since 2026-11 the live screens' phone
rules are in the design-system layer's "Phones" block at the end of `app.css`;
the history below still explains the older rules.) Built 2026-07 after a live phone-width
audit (375px viewport) found two severely broken layouts: `.summary-row`'s
2-column grid clipped the Analyst Consensus card off the right edge of the
screen entirely, and (now removed along with the recommendations feature
itself, see "Homepage recommendations" below) `.recommended-companies-grid`'s
inline `repeat(N, 1fr)` column count squeezed name/ticker text unreadably at
phone width. Fixes live in a dedicated "Responsive: phone-width screens"
section at the end of `app.css`, plus the pre-existing 900px `.charts-row`
stack above it:
- `max-width: 640px` is the general phone cutoff — sidebar/header/search-bar
  padding, calculator result/scenario grids (3-col → 1-col; three equal
  columns leave too little width per currency value), and `.metric-card`
  corner rounding (every card gets its own radius here, since `.metric-cards`
  normally rounds only the grid's outer first/last child on the assumption
  each group fits one row — an assumption `auto-fit` breaks once rows wrap
  at phone width).
- `max-width: 760px` stacks `.summary-row` to one column — needs a wider
  cutoff than 640px since two side-by-side compact cards stop fitting
  before a general single-column phone layout would kick in.
- `.settings-panel`/`.auth-panel` and the Tapetide key gate needed no
  breakpoint — their existing `max-width: 90vw` / centered-card patterns
  already adapted correctly, confirmed live rather than assumed.

**`useTheme.ts` sets the `data-mode` attribute in a `useLayoutEffect`, not
a plain `useEffect` — this one matters, don't "simplify" it back.**
`PriceChart.tsx`/`PriceForecastChart.tsx` each have their own `[theme]`-
triggered effect that reads CSS variables via `getComputedStyle` (`cssVar()`)
to re-theme their lightweight-charts `<canvas>` (which can't just pick up
new CSS custom properties on its own the way normal DOM elements do). React
runs every component's `useLayoutEffect`s, tree-wide, before any
component's plain `useEffect`s in the same commit — but within the same
effect type, a child's effect still fires before its parent's. `useTheme()`
lives in `App.tsx` (the root); the two chart components are deep
descendants. With a plain `useEffect` here, their child effects fired
*before* this parent effect had actually flipped the `data-mode`
attribute, so they read the *previous* theme's colors and never corrected
themselves until some unrelated re-render happened to trigger another
read — matching a user-reported bug where the charts "glitched"
specifically after a theme change, and specifically after a search (since
that's the only time these two chart components are mounted at all). The
fix follows directly from React's documented effect-ordering guarantees;
it wasn't independently reproduced frame-by-frame before fixing (a
live-rendered canvas glitch that self-corrects on the next unrelated
re-render is inherently hard to catch with a static screenshot).

**`MetricCard`'s popover carries `definition`/`assessment`/`explanation`
text computed server-side in `metrics.py`** (not generated client-side or
via the LLM) — see `_build_assessment`. The backend's `compute_health_snapshot`
(worded as a description of the *ratios* -- "Strong Fundamentals", "driven
by strong profitability" -- and explicitly disclaiming itself as "not a
recommendation to buy, sell, or hold") is the same kind of server-computed
text, though it's no longer rendered anywhere in the UI (see "Financial
Health Snapshot" below) -- if it's ever brought back, don't casually
reintroduce buy/sell/hold wording, since that compliance line was drawn
deliberately after the user originally asked for a buy/sell/hold verdict
box and it was scoped down instead.

**`.metric-card` status is a coloured dot plus a word** (Healthy / Watch /
Weak) since the 2026-11 design pass; before that it was a coloured left-edge
ribbon on a tinted card, and before that a lone 6px dot.

**`PriceForecastChart` is a deliberately separate chart, not a series
overlaid on `PriceChart`.** An earlier version drew the High/Mean/Low fan
directly on the 5-year price chart; the fan's ~9-month horizon made it an
imperceptible sliver against 5 years of history (confirmed live — a user
couldn't find it on screen). `PriceForecastChart`'s whole time axis is just
"today" → the target date, so the fan fills the frame, with its own
smaller canvas height (`.price-forecast-canvas`, 220px vs. the main
chart's 280px). Two lightweight-charts details worth preserving if you
touch this file: the % return figures are shown in the legend below the
chart, *not* as on-chart text markers — an earlier attempt at on-chart
labels had the marker's own circle clip its text (fixed by `position:
"aboveBar"`), and then had adjacent High/Mean labels collide with each
other when the targets are close in price (a real, recurring case, not an
edge case) — legend-only sidesteps both permanently. The "Today" origin
marker needs `zOrder: "top"` in `createSeriesMarkers`, or the three dashed
lines' strokes render on top of it since they all pass through that exact
shared point.

**`ReturnCalculator.tsx`'s main projection tiles are driven by the analyst
consensus mean price target when one exists, not the stock's own trailing
price history.** This went through two iterations before landing here,
both driven by real, confirmed user-visible problems -- worth knowing the
history if you touch this file again:
1. Originally, the rate's lookback window was tied directly to whatever
   "Time period" the user was projecting forward with
   (`targetDays = periodInYears * 365.25`). Picking a short period like
   "1 Month" made it annualize a mere 30-day price window, and CAGR math
   (`(end/start)^(1/years) - 1`) massively amplifies noise over a short
   window -- a perfectly ordinary ~7% move over 30 days compounded to a
   headline "133% annual return."
2. Fixed by switching to a fixed ~1-year trailing lookback, independent of
   the projection period -- stable, but this surfaced a *second* problem:
   the rate was still purely backward-looking (what the stock's price
   actually did), while the separate "Analyst price target scenario"
   section below it is forward-looking (what analysts expect). A stock can
   easily have had a down trailing year while analysts expect a recovery --
   nothing wrong with that individually, but it read as broken to see the
   main "Total Gain" tile negative while a "Worst case" analyst scenario
   right below it was positive, with no indication these were two
   unrelated kinds of numbers.
3. **Current design**: `computeProjectionRate` tries `computeForecastRate`
   first -- annualizing the analyst consensus mean target from today to
   `AnalystConsensus.target_date` (`(meanTarget/basePrice)^(1/yearsToTarget) - 1`)
   -- and only falls back to `computeHistoricalRate` (the fixed ~1yr
   trailing calculation from iteration 2, kept as-is) when a stock has no
   analyst coverage to derive a forecast rate from. The rate field's label,
   helper text, and the bottom disclaimer all switch wording based on
   `ProjectionRate.source` ("forecast" vs "historical") so it's never
   ambiguous which basis produced the number. This makes the main tiles
   agree in direction with the "Likely case" scenario tile by construction
   (both ultimately derive from the same mean target) -- if "Time period"
   happens to exactly match the real analyst horizon, the two even compute
   to the exact same figure, since `p*(1+r)^t` with `t = spanYears` and `r`
   derived from that same span algebraically reduces to the scenario
   section's own `p*(mean/basePrice)`.
   `PickedStock.recentPoints` (the ~6-7mo daily series, used by the very
   first, period-coupled version above) is no longer needed anywhere in
   this component and was removed rather than left dead.
4. **(2026-08) Attempted fix, later reverted (see iteration 5) for
   reintroducing iteration 1's exact bug via a different path.** Tapetide's
   `target_date` is typically well under a year out (~7-10 months, see
   `AnalystConsensus`'s own docs above) -- annualizing that short a real
   span with `(mean/base)^(1/spanYears) - 1` amplifies it the same way
   iteration 1's user-chosen short window did. Confirmed live with real
   cached RELIANCE data: a genuine ~28% raw upside to a ~0.64yr-out target
   compounded to a headline ~47% "annual return" -- a user-reported,
   verified mismatch (they expected ~30-40%, matching the raw figure, and
   saw ~50%). "Fixed" by flooring the exponent's denominator at 1yr in both
   `computeForecastRate`/`computeHistoricalRate`, on the theory that a
   sub-1yr target should show its real, un-extrapolated return instead of
   a stretched annual pace -- explicitly flagged at the time as breaking
   the iteration-3 invariant (main tiles no longer reduce to the scenario
   section's figure) as an "accepted trade-off." That trade-off turned out
   to be a real bug, not a cosmetic one -- see iteration 5.
5. **(2026-08) Reverted iteration 4 -- the floor broke Time Period
   compounding, a second user-reported, verified mismatch.** The floored
   rate is only the true annual pace at exactly `Time Period = spanYears`;
   compounding it via `p*(1+r)^t` for ANY other `t` (which is the whole
   point of the Time Period field) no longer means anything, because a
   floored rate isn't a real per-year figure. Confirmed live: RELIANCE's
   floored ~27% rate compounded over a 1.5yr Time Period produced a
   "Total Return" of ~45% -- not the rate shown, not the real target
   return, not annualized correctly for 1.5 years, just wrong. `ratePct`
   is now ALWAYS true CAGR again (`(mean/base)^(1/spanYears) - 1`,
   uncapped) so Time Period compounding is coherent for every value, and
   the iteration-3 invariant (main tiles == scenario section at
   `Time Period = spanYears`) holds again unconditionally. The real,
   non-annualized number iteration 4 was trying to surface didn't
   disappear -- `ProjectionRate.rawPct` carries it separately now, and the
   rate field's helper text shows both together whenever `spanYears < 1`
   ("implies a +27% move by then -- the rate above is that pace stretched
   to a full year") instead of silently substituting one number for the
   other. Lesson: a "more honest number" that breaks the field it feeds
   into isn't more honest, it's just wrong in a different place -- fix
   confusing *labeling* with better labels, not by changing what the
   underlying rate mathematically means.
6. **(2026-08) Flipped the priority: trailing historical performance is
   now the DEFAULT, analyst-forecast is now the fallback -- reversing
   iteration 3's own choice.** Iterations 4/5 kept trying to fix the
   *display* of the forecast-annualized rate, but the deeper problem
   never went away: annualizing a sub-1yr analyst target, however
   honestly labeled, kept producing headline numbers a user twice
   reported as implausibly high -- first "~50%, should be 30-40%," then
   after the raw figure was surfaced, still "~50%, should be ~15%."
   Investigated with real live data rather than guessing a third
   formula: RELIANCE's true forecast-annualized CAGR was ~46%/yr, while
   its actual trailing performance over 1/3/5 years was -3% to +6% --
   *nowhere near* either the forecast-derived number or the user's
   expected ~15%. There is no honest RELIANCE-specific figure that lands
   near a generic "stocks return ~15%" intuition; the fix isn't a better
   formula, it's changing what's being measured. `computeProjectionRate`
   now tries `computeHistoricalRate` first, falling back to
   `computeForecastRate` only when a stock has no price history yet (a
   very recent listing) -- inverting iteration 3's `computeForecastRate
   ?? computeHistoricalRate`. This reintroduces the exact "main tiles vs.
   scenario section can point in different directions" risk iteration 3
   moved away from (a stock can have a weak trailing year while analysts
   expect a recovery) -- accepted as the better trade-off given two
   real, escalating complaints about the forecast-first design and zero
   complaints about the historical one.
   **Also fixed a real, separate bug found while investigating:**
   `computeHistoricalRate` anchored to `series[series.length - 1]` --
   Tapetide's price-history feed was confirmed live to sometimes serve a
   "latest" weekly point several months stale (a fetch made in August
   returned a series ending in March), silently computing the wrong
   1-year window and pricing off a stale close. Now anchored to the live
   current price and `Date.now()` instead (the same fresh price already
   fetched for the stock picker) -- the price-history *series* is still
   used to find the point ~1 year back, just not trusted for "today."
   The rate field's label and helper text now say explicitly "trailing
   historical performance" whenever this basis is used, per direct user
   request, so it's never ambiguous that the number is backward-looking,
   not a forecast.
7. **(2026-08) Switched `computeHistoricalRate` from a rolling trailing-
   365-days-from-today window to a fixed most-recently-completed-calendar-
   year window (Jan 1 -- Dec 31).** Iteration 6 fixed *which endpoint*
   anchors the window (live price/`Date.now()` instead of a possibly-stale
   `series[series.length-1]`) but kept the window itself rolling -- which
   turned out to have its own, different problem: a rolling window's
   answer silently changes depending on what day you happen to look. Real,
   confirmed user report: RELIANCE's rolling trailing-12-months figure was
   -6.84% (confirmed live against Tapetide's own public `/stocks/RELIANCE`
   "1Y" chart, no API key needed) at the same time its 2025 calendar year
   alone was a real, Google-confirmed +29% -- the stock rallied hard
   through 2025 and gave back a lot of it in a 2026 pullback, so *both*
   figures are simultaneously true; they just answer different questions.
   Landing on "the day you happen to check" right after a pullback reads as
   a wrong/broken number even though the math was correct. A fixed
   Jan-Dec window doesn't have that problem -- it's the same unambiguous
   number regardless of what day you load the calculator, at the cost of
   being a full year stale by December (a real, accepted trade-off, not
   fixed here). `computeHistoricalRate` now finds the series points closest
   to Jan 1 and Dec 31 of `currentYear - 1` and returns their simple
   close-to-close return; if the series doesn't reach back to the start of
   that year at all (a recently-listed stock), it returns `null` so
   `computeProjectionRate` falls through to `computeForecastRate` --
   same fallback shape as before, just a stricter "not available" check
   than the old `clamped`-to-oldest-point behavior (which has been removed
   entirely -- a partial-year return computed from a wrong starting point
   would be actively misleading, not just imprecise). The rate label now
   says "`{year} calendar-year performance`" instead of "trailing
   historical performance" so it's unambiguous which specific window
   produced the number.

**(Removed 2026-09) The "Analyst price target scenario" section (Worst/
Likely/Best case tiles, from Tapetide's real Low/Mean/High analyst target)
used to sit right below the main results tiles, on a different, fixed
horizon than them** -- it always projected to Tapetide's `target_period`
(e.g. "FY2027 (period ending Mar 2027)", ~8-9 months out), independent of
"Time period," via a straight linear price-ratio scale-up
(`p * (targetPrice / basePrice)`) with no compounding. That was a
deliberate, disclosed difference from the main tiles' compounding
"Time period" projection, not a bug -- but the user found the section
itself useless sitting there and asked for it to be dropped, not fixed.
`ReturnCalculator.tsx` still reads `pickedStock?.analystTargets` (kept as
`targets`) for the separate `computeForecastRate`/`computeHistoricalRate`
note text above (`targets?.period`), but the `scenarios` array, the whole
`calculator-scenario-section` JSX block, and its `.calculator-scenario-*`
CSS were all deleted rather than kept dead. `AnalystConsensus`'s own
Price Target block on the main search page (a different card entirely,
Low/Mean/High plus current price on one axis) is unaffected -- this
removal was Return Calculator-only.
