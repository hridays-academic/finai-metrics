interface LogoProps {
  onClick?: () => void;
}

export default function Logo({ onClick }: LogoProps) {
  return (
    <button type="button" className="logo-mark" onClick={onClick} aria-label="Go to home page">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="26" height="26" rx="7" fill="var(--accent)" />
        <path
          d="M6.5 17.5L10 12.5L13 15L19.5 7.5"
          stroke="var(--accent-contrast)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="19.5" cy="7.5" r="1.6" fill="var(--accent-contrast)" />
      </svg>
      <span className="logo-wordmark">
        FinAI <span>Metrics</span>
      </span>
    </button>
  );
}
