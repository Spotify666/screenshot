"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="enter mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Couldn&rsquo;t load screenshots</h1>
      <p className="mt-2 text-[15px] text-ink-2">The connection may have dropped. Give it another go.</p>
      <button
        type="button"
        onClick={reset}
        className="pressable mt-7 inline-flex h-11 items-center rounded-full bg-ink px-5 text-[14.5px] font-medium text-bg"
      >
        Try again
      </button>
    </main>
  );
}
