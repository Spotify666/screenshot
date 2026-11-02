"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

export const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useMediaQuery(query: string, serverValue = false) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** True while the user is scrolling down past the top — used to tuck chrome away. */
export function useHideOnScroll({ threshold = 10, offset = 96 } = {}) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - last;
        if (Math.abs(delta) < threshold) return;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setHidden(delta > 0 && y > offset && y < max - 48);
        last = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [threshold, offset]);
  return hidden;
}

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
