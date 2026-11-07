// A small line of one figure over the quarters, oldest on the left. Real
// values only: a quarter with no data is a gap in the line (never
// interpolated), and a dot marks every quarter that has one, so a quarter
// between two gaps still shows. The quarters table next to it holds the
// exact numbers.
interface QuarterSparklineProps {
  label: string;
  values: (number | null)[];
  quarterLabels: string[];
  format: (v: number) => string;
}

const W = 320;
const H = 72;
const PAD = 6;

export default function QuarterSparkline({ label, values, quarterLabels, format }: QuarterSparklineProps) {
  const known = values.filter((v): v is number => v !== null);
  const lastIndex = values.reduce<number>((acc, v, i) => (v === null ? acc : i), -1);
  const min = Math.min(...known);
  const max = Math.max(...known);
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, values.length - 1);
  const y = (v: number) => (max === min ? H / 2 : PAD + ((max - v) * (H - 2 * PAD)) / (max - min));

  let path = "";
  values.forEach((v, i) => {
    if (v === null) return;
    path += `${i > 0 && values[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
  });

  const description = values
    .map((v, i) => `${quarterLabels[i]}: ${v === null ? "no data" : format(v)}`)
    .join(", ");

  return (
    <figure className="sparkline reveal-item">
      <figcaption className="sparkline-head">
        <span className="sparkline-label">{label}</span>
        <span className="sparkline-value">
          {lastIndex >= 0 ? format(values[lastIndex] as number) : "N/A"}
          {lastIndex >= 0 && <span className="sparkline-when"> {quarterLabels[lastIndex]}</span>}
        </span>
      </figcaption>
      {known.length > 0 ? (
        <svg className="sparkline-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. ${description}`}>
          <line className="sparkline-base" x1={PAD} x2={W - PAD} y1={H - 1} y2={H - 1} />
          <path className="sparkline-line" d={path} />
          {values.map((v, i) =>
            v === null ? null : (
              <circle key={i} className={`sparkline-dot ${i === lastIndex ? "is-last" : ""}`} cx={x(i)} cy={y(v)} r={i === lastIndex ? 4.5 : 3} />
            )
          )}
        </svg>
      ) : (
        <p className="sparkline-empty">No quarters available</p>
      )}
      <div className="sparkline-range" aria-hidden="true">
        <span>{quarterLabels[0]}</span>
        <span>{quarterLabels[quarterLabels.length - 1]}</span>
      </div>
    </figure>
  );
}
