interface LogoProps {
  onClick?: () => void;
}

// Logo A (chosen by Hriday at Stop 2, 25 Nov 2026): the ball resting
// off-centre in the gold range, on the slab at -6 degrees. No tile. The same
// mark is the favicon, the app icons and the share image (public/).
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo-svg" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g transform="rotate(-6 32 34)">
        <rect x="3" y="31" width="58" height="9" rx="4.5" fill="var(--logo-slab)" />
        <rect x="13" y="27" width="34" height="17" rx="8.5" fill="var(--gold)" />
        <circle cx="37" cy="35.5" r="6" fill="var(--logo-ball)" stroke="var(--logo-ring)" strokeWidth="2" />
      </g>
    </svg>
  );
}

export default function Logo({ onClick }: LogoProps) {
  return (
    <button type="button" className="logo-mark" onClick={onClick} aria-label="Go to home page">
      <LogoMark />
      <span className="logo-wordmark">Stackly</span>
    </button>
  );
}
