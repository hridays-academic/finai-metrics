// The difficulty word on a flat band down a card's left edge (Hriday,
// 2026-11-18: "just Easy, Medium, Hard, on the left edge of the card").
export default function DifficultyEdge({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <span className="edge-label">
      {label}
      <span className="visually-hidden"> to forecast</span>
    </span>
  );
}
