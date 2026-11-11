// Stackly's own line icons for news themes and company event types. Same
// family as the app's other icons: currentColor stroke, no fill.
const PATHS: Record<string, string> = {
  crude: "M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10z",
  monsoon: "M7 14.5a4 4 0 0 1 .4-8 5 5 0 0 1 9.4 1.6A3.3 3.3 0 0 1 16.5 14.5zM9 17.5l-1 2.5M13 17.5l-1 2.5M17 17.5l-1 2.5",
  rupee: "M7 5h10M7 9h10M9.5 5c3.5 0 5 1.8 5 4s-1.8 4-5 4H8l7 6",
  tariffs: "M3.5 15.5h17l-2 4h-13zM6.5 15.5v-5h11v5M12 10.5V4.5M9 7.5h6",
  supply: "M12 4l9 15.5H3zM12 10v4.5M12 17v.01",
  gst: "M6.5 3.5h11v17l-2-1.5-2 1.5-1.5-1.5-1.5 1.5-2-1.5-2 1.5zM9 8h6M9 11.5h6M9 15h3.5",
  rates: "M18 6L6 18M8 7.5a1.5 1.5 0 1 0 0 .01M16 16.5a1.5 1.5 0 1 0 0 .01",
  inputs: "M3.5 20.5v-9l5 3v-3l5 3v-3l5 3V4.5h2v16zM3.5 20.5h17",
  tech: "M7 7h10v10H7zM10 10h4v4h-4zM9.5 3.5V7M14.5 3.5V7M9.5 17v3.5M14.5 17v3.5M3.5 9.5H7M3.5 14.5H7M17 9.5h3.5M17 14.5h3.5",
  results: "M4 20h16M6.5 20v-6M11 20V9M15.5 20v-9M20 20V5",
  commentary: "M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3z",
  monthly_sales: "M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4.5M15.5 4v4.5M8 14h3M8 16.5h6",
  order: "M7 4.5h10v16H7zM9.5 4.5v-1h5v1M9.5 12l2 2 3.5-4",
  price_change: "M3.5 12.5L11 5h8.5v8.5L12 21zM15.5 8.5v.01",
  capacity: "M3.5 20.5V10l5 3V10l5 3V7.5h7v13zM3.5 20.5h17M17 4v3.5",
  management: "M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20.5c.8-3.8 3.6-6 7-6s6.2 2.2 7 6",
  legal: "M12 4v16M7 20h10M5 7.5h14M7.5 7.5l-3 6h6zM16.5 7.5l-3 6h6z",
};

export default function ThemeIcon({ theme, size = 18 }: { theme: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="theme-icon">
      <path d={PATHS[theme] ?? PATHS.results} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
