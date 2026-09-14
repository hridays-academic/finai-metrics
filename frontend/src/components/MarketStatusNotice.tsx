import { useState } from "react";
import { getTodaysHoliday, isWeekendInIndia, todayInIndia } from "../lib/marketHolidays";

const WEEKEND_DISMISSED_KEY = "finai_weekend_market_notice_dismissed";

// dateStr is "YYYY-MM-DD" in IST -- parsed with an explicit UTC anchor
// (see marketHolidays.ts's todayInIndia()) so the formatted weekday/date
// can't shift a day depending on the viewer's own browser timezone.
function formatDisplayDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-IN", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// Explains a real, otherwise-confusing state: Paper Trading's live quotes
// poll every 20s, but on a day NSE/BSE are simply closed, the price never
// moves -- not a bug (see CLAUDE.md's "Paper Trading" section, and the
// real user report this answers: "it's Monday, why hasn't my price
// changed?", which turned out to be a genuine holiday, not broken
// polling). Reuses TradingTutorial.tsx's `.tapetide-gate-*` overlay/card
// styling wholesale, same page, same modal pattern, not a new one.
//
// Both the holiday and weekend notices are dismissible for the current
// visit (the "Got it" button), but only the weekend one offers a
// permanent "don't show again" -- weekends recur every single week, so a
// one-time acknowledgment makes sense; holidays are comparatively rare
// and each one is a different, worth-repeating fact ("closed for X
// today"), so it's shown fresh every time one actually occurs.
export default function MarketStatusNotice({ visible }: { visible: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  const [dontShowWeekendAgain, setDontShowWeekendAgain] = useState(false);

  const holiday = getTodaysHoliday();
  const { dateStr, dayOfWeek } = todayInIndia();
  const isWeekend = !holiday && isWeekendInIndia(dayOfWeek);
  const weekendAlreadyDismissed = isWeekend && localStorage.getItem(WEEKEND_DISMISSED_KEY) === "1";

  const shouldShow = visible && !dismissed && (holiday !== null || (isWeekend && !weekendAlreadyDismissed));

  if (!shouldShow) return null;

  function handleClose() {
    if (isWeekend && dontShowWeekendAgain) {
      localStorage.setItem(WEEKEND_DISMISSED_KEY, "1");
    }
    setDismissed(true);
  }

  return (
    <div className="tapetide-gate-overlay" role="dialog" aria-modal="true" aria-label="Market status">
      <div className="tapetide-gate-card market-status-card">
        <h2>Markets are closed {holiday ? "today" : "for the weekend"}</h2>
        {holiday ? (
          <p className="tapetide-gate-intro">
            NSE and BSE are closed on {formatDisplayDate(dateStr)} for <strong>{holiday.name}</strong>. Prices
            won't move again until trading resumes -- that's expected, not a problem with the live-price
            polling here.
          </p>
        ) : (
          <p className="tapetide-gate-intro">
            NSE and BSE only trade Monday through Friday. Prices won't move again until markets reopen --
            that's expected, not a problem with the live-price polling here.
          </p>
        )}
        {isWeekend && (
          <label className="market-status-dont-show">
            <input
              type="checkbox"
              checked={dontShowWeekendAgain}
              onChange={(e) => setDontShowWeekendAgain(e.target.checked)}
            />
            Don't show this again for weekends
          </label>
        )}
        <button type="button" className="search-button trading-tutorial-close" onClick={handleClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
