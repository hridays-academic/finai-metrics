import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  value: number;
  format: (n: number) => string;
  durationMs?: number;
}

function canAnimate(): boolean {
  return (
    typeof IntersectionObserver !== "undefined" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Counts up from 0 to `value` once, the first time the number scrolls into
// view. Shows the final value straight away under reduced motion.
export default function CountUp({ value, format, durationMs = 900 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [animate] = useState(canAnimate);
  const [shown, setShown] = useState(animate ? 0 : value);

  useEffect(() => {
    if (!animate || !ref.current) {
      setShown(value);
      return;
    }
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / durationMs);
          setShown(value * (1 - Math.pow(1 - t, 3)));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.6 }
    );
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, animate, durationMs]);

  return (
    <span ref={ref}>
      <span className="visually-hidden">{format(value)}</span>
      <span aria-hidden="true">{format(shown)}</span>
    </span>
  );
}
