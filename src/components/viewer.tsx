"use client";

import { ArrowDown, ArrowLeft, ArrowUp, Download, Minus, Plus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { formatBytes, formatNumber } from "@/lib/format";
import { navState } from "@/lib/nav-state";
import { displayName, downloadUrl, type Screenshot } from "@/lib/screenshot";
import { useAdmin } from "./admin-provider";
import { Dock, DockButton } from "./dock";
import { useElementWidth, useHideOnScroll, useIsoLayoutEffect, useMediaQuery } from "./hooks";
import { Scrubber } from "./scrubber";
import { TiledImage } from "./tiled-image";
import { Button } from "./ui";

const MIN_WIDTH = 240;

export function Viewer({ screenshot: s }: { screenshot: Screenshot }) {
  const router = useRouter();
  const { pickFiles, requestDelete } = useAdmin();
  const chromeHidden = useHideOnScroll();
  const coarse = useMediaQuery("(pointer: coarse)");
  const [colRef, colWidth] = useElementWidth<HTMLDivElement>();

  // Desktop column width. Default ≈ a phone held at reading distance.
  const defaultWidth = Math.max(320, Math.min(560, s.width));
  const [width, setWidth] = useState<number | null>(null);
  const [dpr, setDpr] = useState(2);
  const anchor = useRef<number | null>(null);

  useEffect(() => setDpr(window.devicePixelRatio || 1), []);

  function applyWidth(next: number | null) {
    const rect = colRef.current?.getBoundingClientRect();
    if (rect && rect.height > 0) anchor.current = (window.innerHeight / 2 - rect.top) / rect.height;
    setWidth(next);
  }

  // Keep the same part of the image under the centre of the screen while zooming.
  useIsoLayoutEffect(() => {
    const ratio = anchor.current;
    const col = colRef.current;
    if (ratio == null || !col) return;
    anchor.current = null;
    const rect = col.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    window.scrollTo({ top: top + ratio * rect.height - window.innerHeight / 2, behavior: "instant" });
  }, [width]);

  const current = () => colRef.current?.getBoundingClientRect().width ?? defaultWidth;
  const maxWidth = () => Math.max(MIN_WIDTH, window.innerWidth - 32);
  const zoomIn = () => applyWidth(Math.min(maxWidth(), Math.round(current() * 1.25)));
  const zoomOut = () => applyWidth(Math.max(MIN_WIDTH, Math.round(current() / 1.25)));
  const resetZoom = () => applyWidth(null);

  const goBack = () => {
    if (navState.fromGallery) {
      navState.fromGallery = false;
      router.back();
    } else {
      router.push("/");
    }
  };

  // Keyboard: +/− zoom, 0 resets, Esc goes back. No animation on any of it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable='true']")) return;
      if (document.querySelector("[data-vaul-drawer][data-state='open']")) return;
      if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-" || e.key === "_") zoomOut();
      else if (e.key === "0") resetZoom();
      else if (e.key === "Escape") goBack();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pct = colWidth ? Math.round(((colWidth * dpr) / s.width) * 100) : null;
  const meta = `${formatNumber(s.width)} × ${formatNumber(s.height)} · ${formatBytes(s.original_bytes)}`;

  return (
    <div className="viewer-root min-h-dvh bg-canvas">
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-30 transition-transform duration-300 ease-out",
          chromeHidden && "-translate-y-full",
        )}
      >
        <div className="border-b border-line bg-canvas/95 pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-1 px-1.5 sm:gap-2 sm:px-4">
            <button
              type="button"
              onClick={goBack}
              aria-label="All screenshots"
              className="pressable flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              <ArrowLeft className="size-5" strokeWidth={2} />
            </button>
            <div className="min-w-0 flex-1 px-0.5">
              <h1 className="truncate text-[14.5px] leading-tight font-medium tracking-[-0.005em]">{displayName(s.name)}</h1>
              <p className="mt-0.5 truncate font-mono text-[11.5px] leading-tight text-ink-3 tabular">{meta}</p>
            </div>

            {!coarse && (
              <div className="mr-1 hidden items-center rounded-full bg-surface/70 p-0.5 ring-1 ring-line sm:flex">
                <ZoomButton label="Zoom out (−)" onClick={zoomOut}>
                  <Minus className="size-4" strokeWidth={2} />
                </ZoomButton>
                <button
                  type="button"
                  onClick={resetZoom}
                  title="Reset zoom (0)"
                  className="h-8 min-w-[54px] rounded-full px-1 font-mono text-[12px] text-ink-2 tabular hover:text-ink"
                >
                  {pct != null ? `${pct}%` : ""}
                </button>
                <ZoomButton label="Zoom in (+)" onClick={zoomIn}>
                  <Plus className="size-4" strokeWidth={2} />
                </ZoomButton>
              </div>
            )}

            <a
              href={downloadUrl(s)}
              aria-label="Download original"
              title="Download original"
              className="pressable flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              <Download className="size-[19px]" strokeWidth={2} />
            </a>
          </div>
        </div>
      </header>

      <main className="pt-[calc(env(safe-area-inset-top)+57px)] sm:px-4 sm:pt-[calc(env(safe-area-inset-top)+84px)]">
        <div
          ref={colRef}
          className="enter mx-auto w-full max-w-full sm:w-[var(--col-w)]"
          style={{ "--col-w": `${width ?? defaultWidth}px` } as CSSProperties}
        >
          <TiledImage screenshot={s} className="sm:rounded-[12px] sm:shadow-page" />
        </div>

        <footer className="mx-auto flex max-w-sm flex-col items-center gap-3 px-4 pt-10 pb-[calc(env(safe-area-inset-bottom)+128px)] text-center">
          <p className="font-mono text-[11.5px] text-ink-3 tabular">End · {formatNumber(s.height)} px tall</p>
          <Button size="sm" variant="secondary" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <ArrowUp className="size-3.5" strokeWidth={2.25} />
            Back to top
          </Button>
        </footer>
      </main>

      <Scrubber />
      <ResumeHint id={s.id} />

      <Dock hidden={chromeHidden}>
        <DockButton variant="primary" onClick={pickFiles}>
          <Upload className="size-[17px]" strokeWidth={2.25} />
          Upload
        </DockButton>
        <DockButton onClick={() => requestDelete([s], () => router.replace("/"))}>
          <Trash2 className="size-[17px]" strokeWidth={2} />
          Delete
        </DockButton>
      </Dock>
    </div>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="pressable flex size-8 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

/** Remembers how far you read, and offers to jump back there next time. */
function ResumeHint({ id }: { id: string }) {
  const key = `longshot:pos:${id}`;
  const [resumeAt, setResumeAt] = useState<number | null>(null);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      if (saved > 0.04 && saved < 0.96) setResumeAt(saved);
    } catch {}

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      try {
        localStorage.setItem(key, (window.scrollY / max).toFixed(4));
      } catch {}
    };
    const onScroll = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 350);
      if (window.scrollY > 600) setResumeAt(null);
    };
    const expire = setTimeout(() => setResumeAt(null), 9000);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      clearTimeout(saveTimer);
      clearTimeout(expire);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
    };
  }, [key]);

  if (resumeAt == null) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+82px)] z-30 flex justify-center px-4">
      <button
        type="button"
        onClick={() => {
          const max = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo({ top: resumeAt * max, behavior: "instant" });
          setResumeAt(null);
        }}
        className="pressable enter pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-medium text-bg shadow-float"
      >
        <ArrowDown className="size-3.5" strokeWidth={2.5} />
        Continue at {Math.round(resumeAt * 100)}%
      </button>
    </div>
  );
}
