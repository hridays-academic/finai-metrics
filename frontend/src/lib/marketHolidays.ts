// NSE/BSE's published trading-holiday calendar, hand-maintained rather
// than looked up live -- neither Tapetide nor yfinance expose an "is the
// market open today, and why not" endpoint, and there's no free, reliable
// holiday-calendar API worth adding a dependency for one static list that
// only changes once a year. This exists because a closed market makes
// Paper Trading's live-polled prices look frozen/broken (a real user
// report: "it's Monday, prices haven't moved, is something wrong?" --
// which turned out to be a genuine NSE/BSE holiday, Ganesh Chaturthi, not
// a bug) -- see MarketStatusNotice.tsx and CLAUDE.md's "Paper Trading"
// section.
//
// Verified against two independent published 2026 calendars (Zerodha's
// and Groww's own holiday pages), which agreed on every date, rather than
// trusting a single source -- a wrong date here would either wrongly
// claim a real trading day is a holiday, or silently miss a real one.
//
// MAINTENANCE: refresh this list every December for the coming year --
// NSE/BSE publish next year's calendar well in advance. A date simply
// absent from this list is treated as an ordinary trading day, so an
// unrefreshed list doesn't break anything; it just silently stops
// flagging holidays once the year rolls over. There's no runtime check
// that this list still covers "today."
//
// Deliberately excludes holidays that fall on a weekend (e.g. 2026-11-08,
// Diwali Laxmi Pujan, a Sunday with a special short evening "Muhurat
// Trading" session) -- those are already covered by isWeekendInIndia()
// below, and Muhurat Trading's symbolic ~1hr window isn't something this
// app's regular-hours yfinance polling meaningfully reflects anyway.
export interface MarketHoliday {
  date: string; // "YYYY-MM-DD", India Standard Time
  name: string;
}

export const NSE_HOLIDAYS_2026: MarketHoliday[] = [
  { date: "2026-01-15", name: "Municipal Corporation Elections (Maharashtra)" },
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-03-03", name: "Holi" },
  { date: "2026-03-26", name: "Shri Ram Navami" },
  { date: "2026-03-31", name: "Shri Mahavir Jayanti" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-14", name: "Dr. Baba Saheb Ambedkar Jayanti" },
  { date: "2026-05-01", name: "Maharashtra Day" },
  { date: "2026-05-28", name: "Bakri Eid" },
  { date: "2026-06-26", name: "Moharram" },
  { date: "2026-09-14", name: "Ganesh Chaturthi" },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti" },
  { date: "2026-10-20", name: "Dussehra" },
  { date: "2026-11-10", name: "Diwali-Balipratipada" },
  { date: "2026-11-24", name: "Prakash Gurpurb Sri Guru Nanak Dev" },
  { date: "2026-12-25", name: "Christmas" },
];

// "Today" as NSE/BSE would define it -- India Standard Time, not the
// visitor's own browser timezone. Without this, a visitor checking from
// somewhere like the US could see the wrong weekday/date near midnight
// IST boundaries (e.g. it's already Saturday in India but still Friday
// evening locally, or vice versa).
export function todayInIndia(): { dateStr: string; dayOfWeek: number } {
  const now = new Date();
  // en-CA formats as "YYYY-MM-DD", conveniently matching the holiday
  // list's own date format with no further parsing.
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  // Reconstruct as a UTC-midnight Date purely to read its day-of-week --
  // parsing "YYYY-MM-DD" with an explicit "Z" and reading getUTCDay()
  // sidesteps the browser's own local timezone entirely, unlike calling
  // `new Date(dateStr).getDay()` directly (which uses local-midnight and
  // can land on the wrong side of a day boundary depending on the viewer).
  const dayOfWeek = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return { dateStr, dayOfWeek };
}

export function isWeekendInIndia(dayOfWeek: number): boolean {
  return dayOfWeek === 0 || dayOfWeek === 6;
}

export function getTodaysHoliday(): MarketHoliday | null {
  const { dateStr } = todayInIndia();
  return NSE_HOLIDAYS_2026.find((h) => h.date === dateStr) ?? null;
}
