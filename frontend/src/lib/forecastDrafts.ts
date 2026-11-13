// Unsaved forecast inputs per event, kept in memory for this tab only:
// never stored or sent anywhere, gone on reload. Lets a half-filled form
// survive switching tabs, Back/Forward, opening another company, or signing
// in midway. Cleared on sign-out so the next person doesn't see them.
export type Range = { low: string; high: string };

export interface ForecastDraft {
  ranges: Record<string, Range>;
  // Left out when the draft came from the worksheet, so the saved tags and
  // note stay as they are.
  tags?: string[];
  note?: string;
  // Set by "Use as a starting point" in the driver worksheet.
  fromWorksheet?: boolean;
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
  formJumps.clear();
}

// "Use as a starting point" sends the student to the company page's form.
const formJumps = new Set<number>();

export function requestFormJump(eventId: number): void {
  formJumps.add(eventId);
}

export function takeFormJump(eventId: number): boolean {
  return formJumps.delete(eventId);
}
