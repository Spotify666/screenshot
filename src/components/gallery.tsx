"use client";

import { Check, Trash2, Upload, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatBytes, timeAgo } from "@/lib/format";
import { navState } from "@/lib/nav-state";
import { displayName, publicUrl, screensTall, tileRects, type Screenshot } from "@/lib/screenshot";
import { useAdmin } from "./admin-provider";
import { Dock, DockButton, DockSlot } from "./dock";
import { Button, Logo } from "./ui";

export function Gallery({ initial }: { initial: Screenshot[] }) {
  const [items, setItems] = useState(initial);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState<number | null>(null);
  const { pickFiles, requestDelete } = useAdmin();
  const router = useRouter();

  useEffect(() => setItems(initial), [initial]);

  // Coming back from history after an upload/delete elsewhere: refetch.
  useEffect(() => {
    if (!navState.dirty) return;
    navState.dirty = false;
    router.refresh();
  }, [router]);
  useEffect(() => setNow(Date.now()), [initial]);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && exitSelect();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  function exitSelect() {
    setSelecting(false);
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalBytes = useMemo(() => items.reduce((sum, s) => sum + s.original_bytes, 0), [items]);
  const empty = items.length === 0;

  return (
    <div className="min-h-dvh pb-36">
      <header className="mx-auto flex max-w-[1240px] items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+18px)] sm:px-8">
        <div className="flex items-center gap-2">
          <Logo className="size-[22px] text-ink" />
          <span className="text-[15.5px] font-semibold tracking-[-0.015em]">Longshot</span>
        </div>
        {!empty && (
          <p className="font-mono text-[12px] text-ink-3 tabular">
            {formatBytes(totalBytes)} stored
          </p>
        )}
      </header>

      <main className="mx-auto max-w-[1240px] px-4 sm:px-8">
        {empty ? (
          <EmptyState onUpload={pickFiles} />
        ) : (
          <>
            <div className="mt-9 mb-6 flex items-end justify-between gap-4 sm:mt-12 sm:mb-8">
              <h1 className="text-[28px] leading-none font-semibold tracking-[-0.025em] sm:text-[34px]">
                {selecting ? (
                  <span className="enter inline-block">Select to delete</span>
                ) : (
                  <>
                    Screenshots <span className="ml-1 font-mono text-[0.55em] font-normal text-ink-3 tabular">{items.length}</span>
                  </>
                )}
              </h1>
            </div>

            <ul className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-9 lg:grid-cols-4 xl:grid-cols-5">
              <AnimatePresence initial={false}>
                {items.map((s, i) => (
                  <Card
                    key={s.id}
                    screenshot={s}
                    index={i}
                    now={now}
                    selecting={selecting}
                    selected={selected.has(s.id)}
                    onToggle={() => toggle(s.id)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </>
        )}
      </main>

      <Dock>
        <AnimatePresence mode="popLayout" initial={false}>
          {selecting ? (
            <DockSlot slotKey="select">
              <DockButton onClick={exitSelect} aria-label="Cancel selection">
                <X className="size-[18px]" strokeWidth={2} />
                Cancel
              </DockButton>
              <DockButton
                variant="danger"
                disabled={selected.size === 0}
                onClick={() =>
                  requestDelete(
                    items.filter((s) => selected.has(s.id)),
                    (ids) => {
                      setItems((prev) => prev.filter((s) => !ids.includes(s.id)));
                      exitSelect();
                      navState.dirty = false;
                      router.refresh();
                    },
                  )
                }
              >
                <Trash2 className="size-[17px]" strokeWidth={2} />
                {selected.size ? `Delete ${selected.size}` : "Delete"}
              </DockButton>
            </DockSlot>
          ) : (
            <DockSlot slotKey="idle">
              <DockButton variant="primary" onClick={pickFiles}>
                <Upload className="size-[17px]" strokeWidth={2.25} />
                Upload
              </DockButton>
              <DockButton onClick={() => setSelecting(true)} disabled={empty} className="disabled:opacity-40">
                <Trash2 className="size-[17px]" strokeWidth={2} />
                Delete
              </DockButton>
            </DockSlot>
          )}
        </AnimatePresence>
      </Dock>
    </div>
  );
}

function Card({
  screenshot: s,
  index,
  now,
  selecting,
  selected,
  onToggle,
}: {
  screenshot: Screenshot;
  index: number;
  now: number | null;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const reduce = useReducedMotion();
  const screens = screensTall(s);
  // A tall preview inside a 4:5 frame; hovering slides it up to hint at length.
  const peek = Math.min(0.42, Math.max(0, 1 - (s.thumb_width * 1.25) / s.thumb_height));

  const preloadFirstTile = () => {
    if (s.preview_path) new Image().src = publicUrl(s.preview_path);
    const first = tileRects(s)[0];
    if (first) new Image().src = first.src;
  };

  const body = (
    <>
      <div
        className={cn(
          "no-save relative aspect-[4/5] overflow-hidden rounded-[16px] bg-surface-2 ring-1 ring-line transition-[box-shadow,transform] duration-200 ease-out",
          selecting && selected && "scale-[0.96] ring-2 ring-danger",
        )}
      >
        <img
          src={publicUrl(s.thumb_path)}
          alt=""
          width={s.thumb_width}
          height={s.thumb_height}
          loading={index < 8 ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          className={cn(
            "absolute inset-x-0 top-0 h-auto w-full transition-transform duration-300 ease-out",
            !selecting && "group-hover:translate-y-[calc(var(--peek)*-100%)] group-hover:duration-[1400ms]",
          )}
          style={{ ["--peek" as string]: peek.toFixed(3) }}
        />
        <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-[3px] font-mono text-[10.5px] leading-none text-white tabular">
          {screens} {screens === 1 ? "screen" : "screens"}
        </span>
        {selecting && (
          <span
            className={cn(
              "enter absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-full ring-2 transition-colors duration-150",
              selected ? "bg-danger text-white ring-danger" : "bg-black/20 text-transparent ring-white/90",
            )}
          >
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="mt-2.5 px-0.5">
        <p className="truncate text-[14px] font-medium tracking-[-0.005em]">{displayName(s.name)}</p>
        <p className="mt-0.5 truncate text-[12.5px] text-ink-3 tabular">
          {formatBytes(s.original_bytes)}
          {now ? ` · ${timeAgo(s.created_at, now)}` : ""}
        </p>
      </div>
    </>
  );

  return (
    <motion.li
      layout={reduce ? false : "position"}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
      transition={{ type: "spring", duration: 0.4, bounce: 0.1 }}
    >
      <div className="enter" style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
      {selecting ? (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          aria-label={`Select ${displayName(s.name)}`}
          className="pressable group block w-full rounded-[16px] text-left"
        >
          {body}
        </button>
      ) : (
        <Link
          href={`/s/${s.id}`}
          prefetch
          onClick={() => (navState.fromGallery = true)}
          onPointerEnter={preloadFirstTile}
          onTouchStart={preloadFirstTile}
          className="pressable group block rounded-[16px]"
        >
          {body}
        </Link>
      )}
      </div>
    </motion.li>
  );
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <section className="enter mx-auto flex max-w-sm flex-col items-center pt-[14vh] text-center">
      <div aria-hidden className="relative mb-8 h-44 w-24 overflow-hidden rounded-[18px] bg-surface p-2 shadow-float ring-1 ring-line">
        <div className="reduce-motion-static flex animate-[empty-scroll_7s_var(--ease-in-out)_infinite_alternate] flex-col gap-1.5">
          {Array.from({ length: 16 }, (_, i) => (
            <div
              key={i}
              className={cn("h-3.5 rounded-[5px]", i % 3 === 1 ? "ml-auto bg-accent/25" : "bg-surface-2")}
              style={{ width: `${48 + ((i * 37) % 40)}%` }}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent" />
      </div>
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">No screenshots yet</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-pretty text-ink-2">
        Upload a long screenshot, up to 50&nbsp;MB. It&rsquo;s shown at full resolution and scrolls smoothly on any device.
      </p>
      <Button variant="primary" size="lg" className="mt-7" onClick={onUpload}>
        <Upload className="size-[17px]" strokeWidth={2.25} />
        Upload screenshot
      </Button>
      <p className="mt-4 hidden text-[13px] text-ink-3 sm:block">or drop an image anywhere</p>
    </section>
  );
}
