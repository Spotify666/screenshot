"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { publicUrl, tileRects, type Screenshot, type TileRect } from "@/lib/screenshot";

/** Tiles downloading at once. Few, so the one you're looking at gets the bandwidth. */
const MAX_INFLIGHT = 3;
/** Beyond this many screens away, tiles load only when the whole set is modest. */
const NEAR_SCREENS = 3;
const PRELOAD_ALL_BYTES = 16 * 1024 * 1024;

const blockSave = (e: MouseEvent) => e.preventDefault();

/**
 * Shows a screenshot exactly as captured, top to bottom, without ever leaving a
 * gap:
 *
 * 1. A tiny preview of the whole image paints first, so the full capture is on
 *    screen, in order, almost immediately (slightly soft).
 * 2. Full-resolution tiles then sharpen it in reading order: what's on screen
 *    first (top to bottom), then what's below, then what's above. Only a few
 *    download at once, and tiles far from the viewport are cancelled when you
 *    jump, so the part you're reading is always next.
 *
 * Tiles sit in a box with the image's exact aspect ratio, so nothing shifts.
 */
export function TiledImage({ screenshot, className }: { screenshot: Screenshot; className?: string }) {
  const rects = useMemo(() => tileRects(screenshot), [screenshot]);
  const containerRef = useRef<HTMLDivElement>(null);
  const settled = useRef(new Set<string>());
  const preloadAll = useRef(false);
  const [wanted, setWanted] = useState<ReadonlySet<string>>(
    () => new Set(rects.filter((r) => r.row === 0).map((r) => r.key)),
  );
  const hasPreview = Boolean(screenshot.preview_path);

  const pump = useCallback(() => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box || box.height <= 0) return;
    // Viewport and one screen, as fractions of the image height.
    const top = -box.top / box.height;
    const bottom = (window.innerHeight - box.top) / box.height;
    const screen = Math.max(1e-6, window.innerHeight / box.height);

    setWanted((prev) => {
      let inflight = 0;
      for (const k of prev) if (!settled.current.has(k)) inflight++;

      const queue: { key: string; score: number }[] = [];
      for (const r of rects) {
        if (prev.has(r.key)) continue;
        const t = r.top / 100;
        const b = (r.top + r.height) / 100;
        let score: number;
        if (b > top && t < bottom) score = t; // on screen, top to bottom
        else if (t >= bottom) score = 10 + (t - bottom) / screen; // below, in reading order
        else score = 10.25 + ((top - b) / screen) * 1.5; // above, nearest first
        if (score >= 10 && score - 10 > NEAR_SCREENS && !preloadAll.current) continue;
        queue.push({ key: r.key, score });
      }
      if (!queue.length) return prev;
      queue.sort((x, y) => x.score - y.score);

      let room = MAX_INFLIGHT - inflight;
      let next: Set<string> | null = null;

      // Something on screen is waiting: cancel downloads that are now far away.
      const urgent = queue.filter((q) => q.score < 10).length;
      if (urgent > room) {
        for (const r of rects) {
          if (room >= urgent) break;
          if (!prev.has(r.key) || settled.current.has(r.key)) continue;
          const t = r.top / 100;
          const b = (r.top + r.height) / 100;
          if (b < top - screen || t > bottom + screen) {
            next ??= new Set(prev);
            next.delete(r.key);
            room++;
          }
        }
      }

      if (room <= 0) return next ?? prev;
      next ??= new Set(prev);
      for (const q of queue.slice(0, room)) next.add(q.key);
      return next;
    });
  }, [rects]);

  const onSettled = useCallback(
    (key: string) => {
      settled.current.add(key);
      pump();
    },
    [pump],
  );

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    preloadAll.current = !connection?.saveData && screenshot.original_bytes <= PRELOAD_ALL_BYTES;

    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        pump();
      });
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [pump, screenshot.original_bytes]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={screenshot.name}
      onContextMenu={blockSave}
      onDragStart={blockSave}
      className={cn("no-save relative w-full overflow-hidden bg-surface-2", className)}
      style={{ aspectRatio: `${screenshot.width} / ${screenshot.height}` }}
    >
      {hasPreview && (
        <img
          src={publicUrl(screenshot.preview_path!)}
          alt=""
          aria-hidden
          decoding="async"
          fetchPriority="high"
          draggable={false}
          className="absolute inset-0 block size-full max-w-none"
        />
      )}
      {rects.map((r) => (
        <Tile
          key={r.key}
          rect={r}
          load={wanted.has(r.key)}
          priority={r.row === 0}
          shimmer={!hasPreview}
          onSettled={onSettled}
        />
      ))}
    </div>
  );
}

const MAX_RETRIES = 3;

const Tile = memo(function Tile({
  rect,
  load,
  priority,
  shimmer,
  onSettled,
}: {
  rect: TileRect;
  load: boolean;
  priority: boolean;
  shimmer: boolean;
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
      className={cn("absolute", shimmer && load && !loaded && "skeleton")}
      style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }}
    >
      {(load || loaded) && (
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
          className="tile block size-full max-w-none"
        />
      )}
    </div>
  );
});
