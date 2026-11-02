"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useElementWidth } from "./hooks";

const spring = { type: "spring", duration: 0.38, bounce: 0.14 } as const;

/**
 * The floating action bar. Its width follows its content with a spring, so
 * switching modes (e.g. Upload/Delete -> Cancel/Delete 2) morphs instead of
 * jumping.
 */
export function Dock({ children, hidden = false }: { children: ReactNode; hidden?: boolean }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const reduce = useReducedMotion();

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+14px)]",
        "transition-transform duration-300 ease-[var(--ease-out)]",
        hidden && "translate-y-[calc(100%+12px)]",
      )}
    >
      <motion.div
        role="toolbar"
        aria-label="Actions"
        initial={false}
        animate={width ? { width } : undefined}
        transition={reduce ? { duration: 0 } : spring}
        className="pointer-events-auto overflow-hidden rounded-full bg-surface shadow-float"
      >
        <div ref={ref} className="relative flex w-max items-center gap-1 p-1.5">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

export function DockButton({
  children,
  variant = "ghost",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      type="button"
      className={cn(
        "pressable inline-flex h-11 shrink-0 select-none items-center justify-center gap-2 rounded-full px-4 text-[14.5px] font-medium whitespace-nowrap disabled:cursor-not-allowed",
        variant === "primary" && "bg-ink pr-5 pl-4 text-bg hover:bg-ink/88",
        variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "bg-danger pr-5 pl-4 text-white hover:bg-danger/90 disabled:bg-danger/30",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** Blur-crossfade wrapper for dock contents that swap. */
export function DockSlot({ children, slotKey }: { children: ReactNode; slotKey: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={slotKey}
      className="flex items-center gap-1"
      initial={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(4px)", scale: 0.97 }}
      animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(4px)", scale: 0.97 }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}
