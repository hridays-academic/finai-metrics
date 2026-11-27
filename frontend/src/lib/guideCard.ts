// The card on screen in a quick round or the daily challenge, for the AI
// guide (phase 12): the guide asks the server about this card by id only.
export interface GuideCard {
  cardId: string;
  mystery: boolean;
}

let current: GuideCard | null = null;
const listeners = new Set<() => void>();

export const guideCard = {
  get: (): GuideCard | null => current,
  set(next: GuideCard | null): void {
    if (current?.cardId === next?.cardId && current?.mystery === next?.mystery) return;
    current = next;
    listeners.forEach((f) => f());
  },
  subscribe(f: () => void): () => void {
    listeners.add(f);
    return () => listeners.delete(f);
  },
};
