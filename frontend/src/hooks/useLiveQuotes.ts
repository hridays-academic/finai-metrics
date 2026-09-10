import { useEffect, useState } from "react";
import { fetchLiveQuote } from "../lib/api";
import type { LiveQuote } from "../lib/types";

// Polls every 20s, not "every few seconds" -- yfinance has no documented,
// guaranteed rate limit, but its own maintainers' guidance (see
// YFinanceProvider's module docstring) is to keep sustained request volume
// comfortably under ~1-2 requests/second, or risk temporary IP throttling
// for every user of this app, not just the one polling. 20s keeps a picked
// stock's price and a holdings table of a handful of symbols comfortably
// fresh without coming anywhere near that ceiling. True real-time ticks
// would need a paid broker feed (Zerodha Kite Connect / Upstox) with
// websocket push -- see CLAUDE.md's "Paper Trading" section.
const POLL_INTERVAL_MS = 20_000;

// Used both for the single actively-picked/charted symbol (an array of one)
// and for a whole holdings table's worth of symbols at once -- one hook
// covers both call sites rather than two near-duplicate implementations.
// `active` lets the caller pause polling entirely (e.g. while this page's
// tab isn't the one currently selected -- see App.tsx's view-wrapper
// pattern) instead of quietly polling in the background forever once a
// stock has ever been picked.
export function useLiveQuotes(symbols: string[], active: boolean = true): Record<string, LiveQuote> {
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const symbolsKey = symbols.join(",");

  useEffect(() => {
    if (!active || symbols.length === 0) return;
    let cancelled = false;

    async function pollOnce() {
      const results = await Promise.allSettled(symbols.map((s) => fetchLiveQuote(s)));
      if (cancelled) return;
      setQuotes((prev) => {
        const next = { ...prev };
        results.forEach((r, i) => {
          if (r.status === "fulfilled") next[symbols[i]] = r.value;
        });
        return next;
      });
    }

    pollOnce();
    const id = setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, active]);

  return quotes;
}
