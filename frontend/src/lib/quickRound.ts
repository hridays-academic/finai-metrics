// Quick rounds (master plan phase 5; engagement rules D): pure parts, tested.
// - A round is 10 cards (fewer if the bank is smaller), mixing sectors.
// - A new visitor's first round is 3 Easy cards with hints ("first win").
// - One gold bonus card per round, placed by the round's seed and shown
//   before answering: +20 if the result lands inside the range.
// - Combos: 3 hits in a row double a card's points, 5 in a row triple them;
//   a miss only ends the combo.
import type { PlayCard } from "./api";

export const ROUND_SIZE = 10;
export const FIRST_ROUND_SIZE = 3;
export const GOLD_BONUS = 20;

// A small seeded random number generator (mulberry32), so a round's order
// and its gold card are fixed by its seed, not chosen after answering.
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Round {
  cards: PlayCard[];
  goldIndex: number; // -1 in a first round
  first: boolean;
}

export function buildRound(bank: PlayCard[], seed: number, first: boolean): Round {
  const rand = seeded(seed);
  const shuffled = [...bank].sort(() => rand() - 0.5);
  if (first) {
    const easy = shuffled.filter((c) => c.difficulty === "easy");
    const rest = shuffled.filter((c) => c.difficulty !== "easy");
    return { cards: [...easy, ...rest].slice(0, FIRST_ROUND_SIZE), goldIndex: -1, first: true };
  }
  // Mix sectors: take one card from each sector in turn.
  const bySector = new Map<string, PlayCard[]>();
  for (const c of shuffled) bySector.set(c.sector, [...(bySector.get(c.sector) ?? []), c]);
  const queues = [...bySector.values()];
  const cards: PlayCard[] = [];
  while (cards.length < ROUND_SIZE && queues.some((q) => q.length)) {
    for (const q of queues) {
      const c = q.shift();
      if (c && cards.length < ROUND_SIZE) cards.push(c);
    }
  }
  // Never the first card, so the bonus is something to look forward to.
  const goldIndex = cards.length > 1 ? 1 + Math.floor(rand() * (cards.length - 1)) : -1;
  return { cards, goldIndex, first: false };
}

export function comboMultiplier(streak: number): number {
  return streak >= 5 ? 3 : streak >= 3 ? 2 : 1;
}

// Points for one card: base points x the combo after this card, plus the
// gold bonus when a gold card's result lands inside the range.
export function cardPoints(base: number, hit: boolean, streakBefore: number, gold: boolean): { points: number; streak: number; multiplier: number } {
  const streak = hit ? streakBefore + 1 : 0;
  const multiplier = hit ? comboMultiplier(streak) : 1;
  return { points: base * multiplier + (gold && hit ? GOLD_BONUS : 0), streak, multiplier };
}

// "7 of 10: your ranges caught 70%. Aim for 8." (draft wording)
export function endLine(hits: number, total: number): string {
  const pct = total ? Math.round((hits / total) * 100) : 0;
  const aim = Math.round(total * 0.8);
  return `${hits} of ${total}: your ranges caught ${pct}%. Aim for ${aim}.`;
}
