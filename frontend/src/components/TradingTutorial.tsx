import { useState } from "react";

interface TradingTutorialProps {
  onClose: () => void;
}

// Shown once per browser on first visit to Paper Trading (see
// PaperTrading.tsx's TUTORIAL_SEEN_KEY), reachable again anytime via the
// "?" button next to the page heading. Same overlay/card styling as
// TapetideKeyGate.tsx (.tapetide-gate-*) rather than inventing a new
// modal pattern, and the same optional-video approach: the <video> element
// points at a file that may not exist yet (no walkthrough recorded as of
// this writing) -- onError hides it and falls back to the text-only steps
// below rather than showing a broken player.
export default function TradingTutorial({ onClose }: TradingTutorialProps) {
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <div className="tapetide-gate-overlay" role="dialog" aria-modal="true" aria-label="How Paper Trading works">
      <div className="tapetide-gate-card trading-tutorial-card">
        <h2>Welcome to Paper Trading</h2>
        <p className="tapetide-gate-intro">
          Practice buying and selling real NSE/BSE stocks with virtual coins -- here's how it works.
        </p>

        {!videoFailed && (
          <video
            className="tapetide-gate-video"
            src="/videos/paper-trading-guide.mp4"
            controls
            playsInline
            preload="metadata"
            onError={() => setVideoFailed(true)}
          />
        )}

        <ol className="tapetide-gate-steps">
          <li>Search any NSE/BSE stock above and hit "Use" to start trading it.</li>
          <li>
            Prices and the chart refresh automatically every ~20 seconds, and are delayed roughly
            15 minutes (see the "Delayed" badge) -- not a live/real-time feed.
          </li>
          <li>Buy or sell whole shares (no fractional shares) at the current price, using your virtual coin balance.</li>
          <li>
            Search again anytime to trade a different stock -- your existing holdings stay exactly as
            they are; searching doesn't remove anything from your portfolio.
          </li>
          <li>
            Your coin balance, total portfolio value, and overall P&amp;L are always shown at the top;
            every buy/sell is logged in the transaction history below.
          </li>
          <li>"Reset portfolio" wipes your holdings and transactions and restores your starting coins, anytime.</li>
        </ol>

        <button type="button" className="search-button trading-tutorial-close" onClick={onClose}>
          Got it, let's trade
        </button>
      </div>
    </div>
  );
}
