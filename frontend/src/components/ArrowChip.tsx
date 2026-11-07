// The small circular arrow at the end of primary buttons and row actions.
// It turns from → to ↗ on hover (app.css: .arrow-chip). Decorative only.
export default function ArrowChip() {
  return (
    <span className="arrow-chip" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <path d="M2.5 8h10M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
