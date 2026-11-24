import { createContext, useContext } from "react";

// The layout pass (2026-11-24, Hriday: "as polished as Home"). Three layouts,
// chosen per page by its object: "split" (Home's hero: text left, the object
// right at Home's scale and tilt), "picker" (split, with four card tiles for
// the object) and "stage" (pages 9 and 10). A page without one keeps the
// v3 template until its turn comes.
export type GuideLayout = "split" | "picker" | "stage";

export const GuideLayoutContext = createContext<GuideLayout | null>(null);

export function useGuideLayout(): GuideLayout | null {
  return useContext(GuideLayoutContext);
}

// The paragraph's first sentence (shown in the primary text colour) and the
// rest. Splits at the first full stop, question or exclamation mark followed
// by a space and a capital; the words are untouched.
export function firstSentence(text: string): [string, string] {
  const m = /^(.+?[.?!])\s+(?=[A-Z])/.exec(text);
  return m ? [m[1], text.slice(m[0].length)] : [text, ""];
}
