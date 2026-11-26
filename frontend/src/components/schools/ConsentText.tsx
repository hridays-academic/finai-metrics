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
