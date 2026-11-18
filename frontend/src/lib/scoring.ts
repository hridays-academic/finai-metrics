// A mirror of backend/app/services/scoring.py for the guide's live examples
// (2026-11-18). The server stays the only scorer of real forecasts; this
// only lets the guide show the same arithmetic and the same approved
// sentences while you drag. scoring.test.ts checks it against Python output.

export const ALPHA = 0.2; // 80% ranges
export const K = 2; // points lost per unit of interval score
export const BONUS = 10; // beat the lazy guess

export function intervalScore(low: number, high: number, actual: number): number {
  const width = high - low;
  if (actual < low) return width + (2 / ALPHA) * (low - actual);
  if (actual > high) return width + (2 / ALPHA) * (actual - high);
  return width;
}

export interface MetricScore {
  points: number;
  base: number; // before the bonus
  hit: boolean;
  beatLazy: boolean | null;
}

export function scoreMetric(low: number, high: number, actual: number, lazy: number | null): MetricScore {
  const base = Math.max(0, 100 - K * intervalScore(low, high, actual));
  const midpoint = (low + high) / 2;
  const beatLazy = lazy === null ? null : Math.abs(midpoint - actual) < Math.abs(lazy - actual);
  return { points: base + (beatLazy ? BONUS : 0), base, hit: low <= actual && actual <= high, beatLazy };
}

// Python's _n: one decimal, half rounded away from zero on the number's
// shortest decimal form (so 0.15 -> 0.2, as Decimal(repr(0.15)) does), and a
// trailing ".0" dropped.
export function n(value: number): string {
  const sign = value < 0 ? "-" : "";
  const text = String(Math.abs(value));
  let out: string;
  if (/e/i.test(text)) {
    out = Math.abs(value).toFixed(1);
  } else {
    const [whole, frac = ""] = text.split(".");
    let tenths = Number(whole) * 10 + Number(frac[0] ?? "0");
    if (Number(frac[1] ?? "0") >= 5) tenths += 1;
    out = `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  if (out === "0.0") return "0";
  const trimmed = out.endsWith(".0") ? out.slice(0, -2) : out;
  return sign + trimmed;
}

function pts(value: number): string {
  const text = n(value);
  return text === "1" ? `${text} point` : `${text} points`;
}

function dist(value: number): string {
  const text = n(value);
  return text === "1" ? `${text} percentage point` : `${text} percentage points`;
}

// The approved results-page sentences (scoring.explain_metric), for a
// percentage metric: the points line, then the bonus line.
export function explain(low: number, high: number, actual: number, lazy: number | null): string[] {
  const score = scoreMetric(low, high, actual, lazy);
  const width = high - low;
  const widthCost = K * width;
  let pointsLine: string;
  if (score.hit) {
    let ending = `100 - ${n(widthCost)} = ${n(100 - widthCost)}.`;
    if (widthCost > 100) ending += " Scores can't go below 0, so this counts as 0.";
    pointsLine =
      `Your range was ${dist(width)} wide and the result (${n(actual)}%) landed inside it, ` +
      `so you lost ${pts(widthCost)} for width: ${ending}`;
  } else {
    const side = actual < low ? "below" : "above";
    const miss = actual < low ? low - actual : actual - high;
    const perPoint = (K * 2) / ALPHA;
    const total = widthCost + perPoint * miss;
    let ending = `100 - ${n(total)} = ${n(100 - total)}.`;
    if (total > 100) ending += " Scores can't go below 0, so this counts as 0.";
    pointsLine =
      `The result (${n(actual)}%) landed ${dist(miss)} ${side} your range, so on top of ` +
      `${pts(widthCost)} for your range's width you lost ${pts(perPoint * miss)} for the miss ` +
      `(${n(perPoint)} for each percentage point you missed by): ${ending}`;
  }
  const midpoint = (low + high) / 2;
  let bonusLine: string;
  if (score.beatLazy === true) {
    bonusLine =
      `Your midpoint (${n(midpoint)}%) was closer to the result than the lazy guess (${n(lazy as number)}%), ` +
      `so you earned the +${n(BONUS)} bonus: ${n(score.base)} + ${n(BONUS)} = ${n(score.points)}.`;
  } else if (score.beatLazy === false) {
    bonusLine =
      `The lazy guess (${n(lazy as number)}%) was at least as close to the result as your midpoint ` +
      `(${n(midpoint)}%), so no bonus this time.`;
  } else {
    bonusLine =
      "There was no lazy guess for this number (last year's figure wasn't available), so no bonus was possible.";
  }
  return [pointsLine, bonusLine];
}
