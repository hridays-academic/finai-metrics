// The parent consent text (decisions item 8, approved at Stop 1 with
// Hriday's changes: no AI-tutor sentence, "level and badges" not points, and
// it says where the data is stored; that sentence is DRAFT).
export function consentParagraphs(handle: string): string[] {
  return [
    `Your child, ${handle}, wants to use Stackly, a free educational game where students forecast Indian companies' quarterly results.`,
    "Stackly saves their forecasts, practice scores, level and badges, and shows their handle (never their name) on class and site leaderboards. If their teacher has set up a class, the teacher sees their handle, rounds played and scores.",
    "We don't show ads, sell data or use trackers. Their data is stored with Neon (our database) and Vercel (our website host), both in the United States, so it is kept outside India.",
    "You can withdraw consent at any time by emailing stackly.user.support@gmail.com, and we'll delete their saved data.",
  ];
}

// Phase 12: paragraph 5, the AI guide, with its own tick (decision 6: a
// separate tick; re-approval for the guide only). Shown only while the guide
// is offered to students (/api/consent-options `guide`). DRAFT until after
// the lawyer check. This is the version without zero data retention; if
// Anthropic grants it, "deletes them within 30 days" becomes "does not store
// them after answering".
export const GUIDE_PARAGRAPH =
  "Stackly has an AI guide that explains how the game works and what terms and figures mean. If you tick the box below, your child can use it. Their questions are sent to Anthropic, the company that runs the AI, in the United States. Stackly does not keep the questions, only how many were asked each day. Anthropic deletes them within 30 days, does not use them to train its AI, and may keep a conversation for up to 2 years only if its safety systems flag it. The guide never gives buy or sell advice. You can turn it off at any time by emailing stackly.user.support@gmail.com.";
export const GUIDE_TICK = "I also agree to the AI guide.";
