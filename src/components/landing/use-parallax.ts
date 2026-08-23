// Scroll-coupled parallax: sets a `--py` CSS custom property (px) on the
// element based on its distance from viewport center. Apply with the
// `.parallax-y` utility (transform: translateY(var(--py, 0px))). Negative
// strength moves opposite to scroll. No-ops under prefers-reduced-motion.
import { useEffect, useRef } from "react";

export function useParallax<T extends HTMLElement = HTMLDivElement>(strength = 0.25) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    function update() {
      const el2 = ref.current;
      if (!el2) return;
      const rect = el2.getBoundingClientRect();
      const vh = window.innerHeight;
      const progress = (rect.top + rect.height / 2 - vh / 2) / vh; // ~ -1..1
      el2.style.setProperty("--py", `${progress * strength * -100}px`);
    }
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [strength]);

  return ref;
}
