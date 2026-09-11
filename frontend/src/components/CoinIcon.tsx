// Minimalist coin glyph for Paper Trading's currency -- outline only, no
// fill, currentColor stroke (same family as every other icon in this app:
// Sidebar/Header/ExpandToggle all use 1.6-1.8 stroke width, currentColor,
// no fill). Replaced an inline 🪙 emoji per explicit feedback that it read
// as cluttered glued directly onto the number -- this renders as its own
// element instead, spaced away from the text by CoinAmount.tsx's wrapper.
// Sized in `em` so it scales with whatever font-size context it's dropped
// into (a live price at 1.4rem vs. a table cell at 0.82rem) rather than
// needing a size prop threaded through every call site.
export default function CoinIcon() {
  return (
    <svg
      className="coin-icon"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
