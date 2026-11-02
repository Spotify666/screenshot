"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { tileRects, type Screenshot, type TileRect } from "@/lib/screenshot";

const BACKGROUND_CONCURRENCY = 6;
/** Prefetch every tile in the background only when the whole set is modest. */
const PRELOAD_ALL_BYTES = 16 * 1024 * 1024;

/**
 * Renders a screenshot as a stack of full-resolution tiles inside a box with
 * the image's exact aspect ratio, so nothing shifts while tiles stream in.
 *
 * Tiles near the viewport (±3 screens) load immediately; once the first row is
 * in, the rest are fetched quietly in the background, nearest first, so that
 * flinging or scrubbing never lands on an empty stretch.
 */
export function TiledImage({ screenshot, className }: { screenshot: Screenshot; className?: string }) {
  const rects = useMemo(() => tileRects(screenshot), [screenshot]);
  const containerRef = useRef<HTMLDivElement>(null);
  const settled = useRef(new Set<string>());
  const pump = useRef<() => void>(() => {});
  const [wanted, setWanted] = useState<ReadonlySet<string>>(
    () => new Set(rects.filter((r) => r.row === 0).map((r) => r.key)),
  );

  const want = useCallback((keys: string[]) => {
    if (!keys.length) return;
    setWanted((prev) => {
      if (keys.every((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, []);

  const onSettled = useCallback((key: string) => {
    settled.current.add(key);
    pump.current();
  }, []);

  // Foreground: whatever is within three screens of the viewport.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const keys: string[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const key = (entry.target as HTMLElement).dataset.tile;
          if (key) keys.push(key);
          io.unobserve(entry.target);
        }
        want(keys);
      },
      { rootMargin: "300% 0px 300% 0px" },
    );
    root.querySelectorAll<HTMLElement>("[data-tile]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [rects, want]);

  // Background: everything else, closest to the reading position first.
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData || screenshot.original_bytes > PRELOAD_ALL_BYTES) return;

    let active = false;
    pump.current = () => {
      if (!active) return;
      setWanted((prev) => {
        let inflight = 0;
        for (const k of prev) if (!settled.current.has(k)) inflight++;
        const room = BACKGROUND_CONCURRENCY - inflight;
        if (room <= 0) return prev;

        const box = containerRef.current?.getBoundingClientRect();
        const focus = box && box.height > 0 ? Math.min(1, Math.max(0, (window.innerHeight / 2 - box.top) / box.height)) : 0;
        const next = rects
          .filter((r) => !prev.has(r.key))
          .map((r) => {
            const center = (r.top + r.height / 2) / 100;
            // Slight bias toward what's below: that's where people scroll.
            return { key: r.key, d: center >= focus ? center - focus : (focus - center) * 1.5 };
          })
          .sort((a, b) => a.d - b.d)
          .slice(0, room);
        if (!next.length) return prev;
        const out = new Set(prev);
        for (const n of next) out.add(n.key);
        return out;
      });
    };

    const start = () => {
      active = true;
      pump.current();
    };
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle ? window.requestIdleCallback(start, { timeout: 1500 }) : window.setTimeout(start, 700);
    return () => {
      active = false;
      pump.current = () => {};
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [rects, screenshot.original_bytes]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={screenshot.name}
      className={cn("relative w-full overflow-hidden bg-surface-2", className)}
      style={{ aspectRatio: `${screenshot.width} / ${screenshot.height}` }}
    >
      {rects.map((r) => (
        <Tile key={r.key} rect={r} load={wanted.has(r.key)} priority={r.row === 0} onSettled={onSettled} />
      ))}
    </div>
  );
}

const MAX_RETRIES = 3;

const Tile = memo(function Tile({
  rect,
  load,
  priority,
  onSettled,
}: {
  rect: TileRect;
  load: boolean;
  priority: boolean;
  onSettled: (key: string) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const markLoaded = useCallback(() => {
    setLoaded(true);
    onSettled(rect.key);
  }, [onSettled, rect.key]);

  // Server-rendered tiles can finish loading before hydration attaches onLoad.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) markLoaded();
  }, [load, attempt, markLoaded]);

  return (
    <div
      data-tile={rect.key}
      className={cn("absolute", load && !loaded && "skeleton")}
      style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }}
    >
      {load && (
        <img
          ref={imgRef}
          src={attempt ? `${rect.src}?retry=${attempt}` : rect.src}
          alt=""
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          draggable={false}
          onLoad={markLoaded}
          onError={() => {
            if (attempt < MAX_RETRIES) setTimeout(() => setAttempt((a) => a + 1), 600 * (attempt + 1));
            else onSettled(rect.key);
          }}
          data-loaded={loaded || undefined}
          className="tile block size-full max-w-none select-none"
        />
      )}
    </div>
  );
});
