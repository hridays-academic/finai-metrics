import { useEffect, useState } from "react";

interface LockCountdownProps {
  lockAt: string; // ISO
  // The server's clock at fetch time, so a wrong device clock can't show a
  // misleading countdown. The server enforces the lock regardless.
  serverNow?: string;
  compact?: boolean;
}

const IST: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
};

export function formatIst(iso: string): string {
  return `${new Date(iso).toLocaleString("en-IN", IST)} IST`;
}

function remaining(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "under a minute";
}

function remainingLong(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (d > 0) return `${unit(d, "day")} ${unit(h, "hour")}`;
  if (h > 0) return `${unit(h, "hour")} ${unit(m, "minute")}`;
  if (m > 0) return unit(m, "minute");
  return "under a minute";
}

export default function LockCountdown({ lockAt, serverNow, compact }: LockCountdownProps) {
  const [offset] = useState(() => (serverNow ? new Date(serverNow).getTime() - Date.now() : 0));
  const [now, setNow] = useState(() => Date.now() + offset);
  const left = new Date(lockAt).getTime() - now;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), left < 3_600_000 ? 1_000 : 30_000);
    return () => clearInterval(id);
  }, [offset, left < 3_600_000]);

  if (left <= 0) {
    return <span className="league-lock locked">{compact ? "Locked" : `Forecasts locked ${formatIst(lockAt)}`}</span>;
  }
  const soon = left < 86_400_000;
  return (
    <span className={`league-lock ${soon ? "soon" : ""}`} title={`Locks at ${formatIst(lockAt)}`}>
      {/* Under a day left: a tinted badge with a clock, so it reads as a
          warning by shape and icon, not by colour alone. */}
      {soon && (
        <svg className="league-lock-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" />
          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )}
      {compact ? `Locks in ${remaining(left)}` : `Forecasts lock ${formatIst(lockAt)} (in ${remainingLong(left)})`}
    </span>
  );
}
