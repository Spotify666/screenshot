export default function Loading() {
  return (
    <div className="viewer-root min-h-dvh bg-canvas" aria-busy>
      <div className="fixed inset-x-0 top-0 z-30 border-b border-line bg-canvas/95 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-3 px-3 sm:px-5">
          <div className="size-8 rounded-full bg-surface-2" />
          <div className="flex flex-col gap-1.5">
            <div className="skeleton h-3 w-40 rounded-full" />
            <div className="skeleton h-2.5 w-28 rounded-full" />
          </div>
        </div>
      </div>
      <div className="pt-[calc(env(safe-area-inset-top)+57px)] sm:px-4 sm:pt-[calc(env(safe-area-inset-top)+84px)]">
        <div className="skeleton mx-auto h-[140vh] w-full sm:w-[560px] sm:rounded-[12px]" />
      </div>
    </div>
  );
}
