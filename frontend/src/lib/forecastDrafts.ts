// Unsaved forecast inputs per event, kept in memory for this tab only:
// never stored or sent anywhere, gone on reload. Lets a half-filled form
// survive switching tabs, Back/Forward, opening another company, or signing
// in midway. Cleared on sign-out so the next person doesn't see them.
export type Range = { low: string; high: string };

export interface ForecastDraft {
  ranges: Record<string, Range>;
  tags: string[];
  note: string;
}

const drafts = new Map<number, ForecastDraft>();

export function getForecastDraft(eventId: number): ForecastDraft | undefined {
  return drafts.get(eventId);
}

export function setForecastDraft(eventId: number, draft: ForecastDraft): void {
  drafts.set(eventId, draft);
}

export function clearForecastDraft(eventId: number): void {
  drafts.delete(eventId);
}

export function clearForecastDrafts(): void {
  drafts.clear();
}
