// Animates a number from 0 to `value` once it scrolls into view, using
// requestAnimationFrame with an ease-out curve. Renders the final value
// immediately under prefers-reduced-motion or if IntersectionObserver is
// unavailable. Supports a prefix, suffix, and decimal places.
import { useEffect, useRef, useState } from "react";

type CountUpProps = {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number; // ms
  className?: string;
};

export function CountUp({ value, prefix = "", suffix = "", decimals = 0, duration = 1600, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      setDisplay(value);
      return;
    }

    let raf = 0;
    let started = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started) {
            started = true;
            const start = performance.now();
            function step(now: number) {
              const t = Math.min(1, (now - start) / duration);
              const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
              setDisplay(value * eased);
              if (t < 1) raf = requestAnimationFrame(step);
              else setDisplay(value);
            }
            raf = requestAnimationFrame(step);
            io.unobserve(el);
          }
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {display.toLocaleString("id-ID", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}
