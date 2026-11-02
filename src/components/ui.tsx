"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:bg-ink/90 disabled:bg-ink/30",
  secondary: "bg-surface-2 text-ink hover:bg-line-strong disabled:text-ink-3",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink disabled:text-ink-3",
  danger: "bg-danger text-white hover:bg-danger/90 disabled:bg-danger/35",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-full px-3 text-[13px]",
  md: "h-10 gap-2 rounded-full px-4 text-[14px]",
  lg: "h-11 gap-2 rounded-full px-5 text-[14.5px]",
  icon: "size-10 rounded-full",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "pressable inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={cn("size-4 animate-[spin_600ms_linear_infinite]", className)}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** A tall capture with message lines: the Longshot mark. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn("size-6", className)}>
      <rect x="6" y="1.75" width="12" height="20.5" rx="3.25" fill="currentColor" />
      <rect x="8.5" y="5" width="5" height="2" rx="1" fill="var(--bg)" />
      <rect x="10.5" y="9" width="5" height="2" rx="1" fill="var(--bg)" opacity="0.75" />
      <rect x="8.5" y="13" width="4" height="2" rx="1" fill="var(--bg)" opacity="0.55" />
      <rect x="11.5" y="17" width="4" height="2" rx="1" fill="var(--bg)" opacity="0.35" />
    </svg>
  );
}
