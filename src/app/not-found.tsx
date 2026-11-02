import Link from "next/link";

export default function NotFound() {
  return (
    <main className="enter mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-[12px] text-ink-3">404</p>
      <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em]">This screenshot isn&rsquo;t here</h1>
      <p className="mt-2 text-[15px] text-ink-2">It may have been deleted, or the link is incomplete.</p>
      <Link
        href="/"
        className="pressable mt-7 inline-flex h-11 items-center rounded-full bg-ink px-5 text-[14.5px] font-medium text-bg"
      >
        All screenshots
      </Link>
    </main>
  );
}
