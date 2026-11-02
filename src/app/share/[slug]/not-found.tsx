import { Logo } from "@/components/ui";

export default function SharedNotFound() {
  return (
    <main className="enter mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <Logo className="mb-6 size-7 text-ink-3" />
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">This link no longer works</h1>
      <p className="mt-2 text-[15px] text-pretty text-ink-2">
        The screenshot was deleted, or the link is incomplete. Ask whoever sent it for a new one.
      </p>
    </main>
  );
}
