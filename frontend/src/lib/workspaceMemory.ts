// In-memory only (this tab, gone on reload): the step a workspace was left
// on, and the worksheet of a visitor whose work isn't saved to an account
// (signed out, or under 18 with consent still pending). Never stored or
// sent anywhere. Cleared on sign-out with the forecast drafts.
import type { WorksheetData } from "./types";

const steps = new Map<number, number>();
const worksheets = new Map<number, WorksheetData>();

export const getStep = (eventId: number) => steps.get(eventId) ?? 0;
export const setStep = (eventId: number, index: number) => void steps.set(eventId, index);
export const getMemoryWorksheet = (eventId: number) => worksheets.get(eventId);
export const setMemoryWorksheet = (eventId: number, ws: WorksheetData) => void worksheets.set(eventId, ws);

export function clearWorkspaceMemory(): void {
  steps.clear();
  worksheets.clear();
}
