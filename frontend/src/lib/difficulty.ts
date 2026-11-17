// How hard a company's next results are to forecast (2026-11-17, Hriday:
// "the colour of the company should be based on difficulty"). Pure, so it
// is the same on every page and tested. Two plain measures over the
// quarters Stackly has (Yahoo's quarterly figures):
// - how far the operating margin moved: highest minus lowest, in points;
// - how much quarter-to-quarter revenue growth swung: the biggest minus the
//   smallest change between back-to-back quarters, in points.
// Each is banded (margin: under 3 / 3-7 / over 7; revenue: under 10 / 10-25
// / over 25) and the company takes the harder band. Cut-offs set from the
// seven pilot companies on 2026-11-17: Mphasis easy; Maruti, Escorts,
// Marico medium; Dabur, Jyothy, Sagar Cements hard. Too little data: null
// (the neutral graphite colour).
// Colours: easy = emerald, medium = cobalt, hard = violet (app.css,
// .difficulty-*). The words below were approved by Hriday on 2026-11-17
// (vault: Areas/Difficulty colours (for approval)); change only with approval.

export type Difficulty = "easy" | "medium" | "hard";

export interface DifficultyRow {
  period_end_date: string; // YYYY-MM-DD
  revenue: number | null;
  margin: number | null; // percent
}

const LEVELS: Difficulty[] = ["easy", "medium", "hard"];

function monthsBetween(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

export function marginRange(rows: DifficultyRow[]): number | null {
  const m = rows.map((r) => r.margin).filter((v): v is number => v !== null && Number.isFinite(v));
  return m.length >= 3 ? Math.max(...m) - Math.min(...m) : null;
}

export function revenueSwing(rows: DifficultyRow[]): number | null {
  const sorted = rows
    .filter((r): r is DifficultyRow & { revenue: number } => r.revenue !== null && r.revenue > 0)
    .sort((a, b) => a.period_end_date.localeCompare(b.period_end_date));
  const changes: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (monthsBetween(sorted[i - 1].period_end_date, sorted[i].period_end_date) !== 3) continue;
    changes.push(((sorted[i].revenue - sorted[i - 1].revenue) / sorted[i - 1].revenue) * 100);
  }
  return changes.length >= 2 ? Math.max(...changes) - Math.min(...changes) : null;
}

function band(value: number | null, low: number, high: number): number {
  if (value === null) return -1;
  return value < low ? 0 : value <= high ? 1 : 2;
}

export function difficultyOf(rows: DifficultyRow[]): Difficulty | null {
  const level = Math.max(band(marginRange(rows), 3, 7), band(revenueSwing(rows), 10, 25));
  return level < 0 ? null : LEVELS[level];
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy to forecast",
  medium: "Medium to forecast",
  hard: "Hard to forecast",
};

export const DIFFICULTY_NOTE =
  "Colours show how much a company's numbers jump around from quarter to quarter. The more they jump, the harder it is to forecast.";

// The colour class for a company's tile, card and pages.
export function colourClass(level: Difficulty | null): string {
  return level ? `difficulty-${level}` : "sector-neutral";
}

// From the league's research history (Home, company page, workspace).
export function fromProviderRows(
  rows: { period_end_date: string; revenue: number | null; operating_margin_pct: number | null }[] | undefined
): DifficultyRow[] {
  return (rows ?? []).map((r) => ({ period_end_date: r.period_end_date, revenue: r.revenue, margin: r.operating_margin_pct }));
}
