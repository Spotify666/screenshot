"use client";

import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from "input-otp";
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { verifyPasscode } from "@/lib/client-api";
import { Spinner } from "./ui";

const LENGTH = 4;

/**
 * Four-box passcode entry. Checks the code with the server as soon as the
 * fourth digit lands, and shakes (briefly) when it's wrong.
 */
export function PasscodeField({ onVerified, label = "Passcode" }: { onVerified: (code: string) => void; label?: string }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const controls = useAnimationControls();
  const reduce = useReducedMotion();

  async function check(code: string) {
    setState("checking");
    setMessage(null);
    try {
      await verifyPasscode(code);
      onVerified(code);
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Couldn't check the passcode.");
      if (!reduce) controls.start({ x: [0, -7, 6, -4, 3, 0], transition: { duration: 0.32, ease: "easeOut" } });
      setTimeout(() => setValue(""), 260);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <span id="passcode-label" className="sr-only">
        {label}
      </span>
      <motion.div animate={controls}>
        <OTPInput
          aria-labelledby="passcode-label"
          maxLength={LENGTH}
          value={value}
          onChange={(v) => {
            setValue(v);
            if (state === "error") setState("idle");
          }}
          onComplete={check}
          disabled={state === "checking"}
          pattern={REGEXP_ONLY_DIGITS}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          containerClassName="flex items-center gap-2.5 has-[:disabled]:opacity-70"
          render={({ slots }) => (
            <>
              {slots.map((slot, i) => (
                <Slot key={i} {...slot} error={state === "error"} />
              ))}
            </>
          )}
        />
      </motion.div>
      <p
        aria-live="polite"
        className={cn(
          "flex h-5 items-center gap-1.5 text-[13px]",
          state === "error" ? "text-danger" : "text-ink-3",
        )}
      >
        {state === "checking" ? (
          <>
            <Spinner className="size-3.5" /> Checking…
          </>
        ) : (
          (message ?? "Enter the 4-digit passcode")
        )}
      </p>
    </div>
  );
}

function Slot({ char, isActive, hasFakeCaret, error }: SlotProps & { error: boolean }) {
  return (
    <div
      className={cn(
        "relative flex h-14 w-12 items-center justify-center rounded-[14px] bg-surface-2 text-[22px] text-ink ring-1 ring-line transition-[box-shadow,background-color] duration-150",
        isActive && "bg-surface ring-2 ring-ink/70",
        error && "ring-2 ring-danger/70",
      )}
    >
      {char ? <span className="size-2.5 rounded-full bg-ink" aria-hidden /> : null}
      {hasFakeCaret && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-6 w-px animate-[caret_1s_steps(1)_infinite] bg-ink" />
        </span>
      )}
    </div>
  );
}
