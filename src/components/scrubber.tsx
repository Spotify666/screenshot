"use client";

import { useEffect, useRef } from "react";

const THUMB = 44;
const TOP_GAP = 72;
const BOTTOM_GAP = 96;

/**
 * A slim fast-scroll handle on the right edge — invaluable when a capture is
 * dozens of screens tall. Appears while scrolling, drag it to jump anywhere.
 * Updates are written straight to the DOM (no React renders per frame).
 */
export function Scrubber() {
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current!;
    const thumb = thumbRef.current!;
    const label = labelRef.current!;
    let frame = 0;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let dragging = false;
    let grabOffset = 0;
    let pointerId: number | null = null;

    const metrics = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const track = root.clientHeight - THUMB;
      return { max, track };
    };

    const paint = () => {
      frame = 0;
      const { max, track } = metrics();
      const long = max > window.innerHeight * 2.5;
      root.dataset.enabled = long ? "true" : "false";
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      thumb.style.transform = `translate3d(0, ${p * track}px, 0)`;
      label.textContent = `${Math.round(p * 100)}%`;
    };

    const show = () => {
      root.dataset.visible = "true";
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!dragging) delete root.dataset.visible;
      }, 1100);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
      show();
    };

    const scrollToPointer = (clientY: number) => {
      const { max, track } = metrics();
      const top = root.getBoundingClientRect().top;
      const p = Math.min(1, Math.max(0, (clientY - top - grabOffset) / track));
      window.scrollTo({ top: p * max, behavior: "instant" });
    };

    const onDown = (e: PointerEvent) => {
      if (dragging || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault();
      dragging = true;
      pointerId = e.pointerId;
      thumb.setPointerCapture(e.pointerId);
      grabOffset = e.clientY - thumb.getBoundingClientRect().top;
      root.dataset.dragging = "true";
      show();
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      e.preventDefault();
      scrollToPointer(e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      delete root.dataset.dragging;
      show();
    };

    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    thumb.addEventListener("pointerdown", onDown);
    thumb.addEventListener("pointermove", onMove);
    thumb.addEventListener("pointerup", onUp);
    thumb.addEventListener("pointercancel", onUp);
    const ro = new ResizeObserver(onScroll);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hideTimer);
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      thumb.removeEventListener("pointerdown", onDown);
      thumb.removeEventListener("pointermove", onMove);
      thumb.removeEventListener("pointerup", onUp);
      thumb.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden
      data-enabled="false"
      className="group/scrub pointer-events-none fixed right-0 z-20 w-9 data-[enabled=false]:hidden"
      style={{ top: `calc(env(safe-area-inset-top) + ${TOP_GAP}px)`, bottom: `calc(env(safe-area-inset-bottom) + ${BOTTOM_GAP}px)` }}
    >
      <div
        ref={thumbRef}
        className="pointer-events-none absolute top-0 right-0 flex w-9 items-center justify-end pr-1.5 opacity-0 transition-opacity duration-200 group-data-[visible]/scrub:pointer-events-auto group-data-[visible]/scrub:opacity-100"
        style={{ height: THUMB, touchAction: "none" }}
      >
        <span
          ref={labelRef}
          className="pointer-events-none absolute right-6 rounded-full bg-ink px-2 py-1 font-mono text-[11px] leading-none text-bg tabular opacity-0 shadow-float transition-opacity duration-150 group-data-[dragging]/scrub:opacity-100"
        />
        <span className="h-full w-[5px] rounded-full bg-ink/45 transition-[width,background-color] duration-150 group-data-[dragging]/scrub:w-[7px] group-data-[dragging]/scrub:bg-ink/80" />
      </div>
    </div>
  );
}
