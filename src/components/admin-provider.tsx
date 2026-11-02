"use client";

import { AlertCircle, Check, ImageUp } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { ApiError, deleteScreenshot, uploadScreenshot, validateFile } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { ACCEPT_ATTR } from "@/lib/config";
import { formatBytes, formatNumber } from "@/lib/format";
import { navState } from "@/lib/nav-state";
import { displayName, publicUrl, type Screenshot } from "@/lib/screenshot";
import { PasscodeField } from "./passcode-field";
import { Button, Spinner } from "./ui";

const PASSCODE_KEY = "longshot:passcode";
const PREVIEW_LIMIT = 25 * 1024 * 1024;

type ItemStatus = "ready" | "invalid" | "uploading" | "processing" | "done" | "error";

interface UploadItem {
  key: string;
  file: File;
  preview: string | null;
  status: ItemStatus;
  progress: number;
  error?: string;
}

type Sheet =
  | { kind: "upload"; items: UploadItem[] }
  | { kind: "delete"; targets: Screenshot[]; onDone?: (ids: string[]) => void };

interface AdminApi {
  /** Opens the system file picker. Call straight from a click handler. */
  pickFiles: () => void;
  openUpload: (files: File[]) => void;
  requestDelete: (targets: Screenshot[], onDone?: (ids: string[]) => void) => void;
}

const AdminContext = createContext<AdminApi | null>(null);

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside <AdminProvider>");
  return ctx;
}

const isAuthError = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 429);
const messageOf = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

export function AdminProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);

  const passcodeRef = useRef<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const sheetRef = useRef<Sheet | null>(null);
  sheetRef.current = sheet;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(PASSCODE_KEY);
      if (saved) {
        passcodeRef.current = saved;
        setUnlocked(true);
      }
    } catch {}
  }, []);

  const remember = useCallback((code: string) => {
    passcodeRef.current = code;
    setUnlocked(true);
    try {
      sessionStorage.setItem(PASSCODE_KEY, code);
    } catch {}
  }, []);

  const forget = useCallback(() => {
    passcodeRef.current = null;
    setUnlocked(false);
    try {
      sessionStorage.removeItem(PASSCODE_KEY);
    } catch {}
  }, []);

  const setBusyState = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };

  const updateItem = useCallback((key: string, patch: Partial<UploadItem>) => {
    setSheet((s) =>
      s?.kind === "upload" ? { ...s, items: s.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) } : s,
    );
  }, []);

  const runUploads = useCallback(async () => {
    const current = sheetRef.current;
    const code = passcodeRef.current;
    if (current?.kind !== "upload" || !code || busyRef.current) return;
    const queue = current.items.filter((i) => i.status === "ready" || i.status === "error");
    if (!queue.length) return;

    setBusyState(true);
    const uploaded: Screenshot[] = [];
    let stoppedByAuth = false;

    for (const item of queue) {
      updateItem(item.key, { status: "uploading", progress: 0, error: undefined });
      try {
        const s = await uploadScreenshot(item.file, code, (p) =>
          updateItem(
            item.key,
            p.phase === "uploading" ? { status: "uploading", progress: p.progress } : { status: "processing", progress: 1 },
          ),
        );
        uploaded.push(s);
        updateItem(item.key, { status: "done" });
      } catch (err) {
        if (isAuthError(err)) {
          stoppedByAuth = true;
          forget();
          updateItem(item.key, { status: "ready", progress: 0 });
          toast.error(messageOf(err));
          break;
        }
        updateItem(item.key, { status: "error", error: messageOf(err) });
      }
    }

    setBusyState(false);
    if (stoppedByAuth || !uploaded.length) return;
    navState.dirty = true;

    const failed = queue.length - uploaded.length;
    if (failed === 0) {
      setOpen(false);
      if (uploaded.length === 1) {
        toast.success("Uploaded", { description: displayName(uploaded[0].name) });
        navState.fromGallery = pathname === "/";
        router.push(`/s/${uploaded[0].id}`);
      } else {
        toast.success(`${uploaded.length} screenshots uploaded`);
        if (pathname === "/") router.refresh();
        else router.push("/");
      }
    } else {
      toast.message(`${uploaded.length} uploaded · ${failed} failed`);
      router.refresh();
    }
  }, [forget, pathname, router, updateItem]);

  const openUpload = useCallback(
    (files: File[]) => {
      if (busyRef.current || !files.length) return;
      const items: UploadItem[] = files.map((file, i) => {
        const error = validateFile(file);
        return {
          key: `${Date.now()}-${i}-${file.name}`,
          file,
          preview: !error && file.size <= PREVIEW_LIMIT ? URL.createObjectURL(file) : null,
          status: error ? "invalid" : "ready",
          progress: 0,
          error: error ?? undefined,
        };
      });
      setSheet((prev) => {
        if (prev?.kind === "upload") prev.items.forEach((it) => it.preview && URL.revokeObjectURL(it.preview));
        return { kind: "upload", items };
      });
      sheetRef.current = { kind: "upload", items };
      setOpen(true);
      if (passcodeRef.current) queueMicrotask(runUploads);
    },
    [runUploads],
  );

  const pickFiles = useCallback(() => {
    if (busyRef.current) return;
    inputRef.current?.click();
  }, []);

  const requestDelete = useCallback((targets: Screenshot[], onDone?: (ids: string[]) => void) => {
    if (busyRef.current || !targets.length) return;
    setSheet({ kind: "delete", targets, onDone });
    setOpen(true);
  }, []);

  const runDelete = useCallback(async () => {
    const current = sheetRef.current;
    const code = passcodeRef.current;
    if (current?.kind !== "delete" || !code || busyRef.current) return;

    setBusyState(true);
    const deleted: string[] = [];
    let failure: unknown = null;
    for (const t of current.targets) {
      try {
        await deleteScreenshot(t.id, code);
        deleted.push(t.id);
      } catch (err) {
        failure = err;
        if (isAuthError(err)) forget();
        break;
      }
    }
    setBusyState(false);

    if (deleted.length) {
      navState.dirty = true;
      toast.success(deleted.length === 1 ? "Screenshot deleted" : `${deleted.length} screenshots deleted`);
      if (current.onDone) current.onDone(deleted);
      else router.refresh();
    }
    if (failure) {
      toast.error(messageOf(failure));
      setSheet({ ...current, targets: current.targets.filter((t) => !deleted.includes(t.id)) });
    } else {
      setOpen(false);
    }
  }, [forget, router]);

  const clearSheet = useCallback(() => {
    setSheet((s) => {
      if (s?.kind === "upload") s.items.forEach((it) => it.preview && URL.revokeObjectURL(it.preview));
      return null;
    });
  }, []);

  // Drop files anywhere, or paste an image, to upload.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      openUpload(Array.from(e.dataTransfer?.files ?? []));
    };
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable='true']")) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      openUpload(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [openUpload]);

  const api = useMemo<AdminApi>(() => ({ pickFiles, openUpload, requestDelete }), [pickFiles, openUpload, requestDelete]);

  return (
    <AdminContext.Provider value={api}>
      {children}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          openUpload(files);
        }}
      />

      <Drawer.Root
        open={open}
        onOpenChange={(next) => {
          if (!next && busyRef.current) return;
          setOpen(next);
        }}
        dismissible={!busy}
        onAnimationEnd={(isOpen) => {
          if (!isOpen) clearSheet();
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-[460px] flex-col px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] outline-none">
            <div className="rounded-[26px] bg-surface px-5 pt-3 pb-5 shadow-float sm:px-6 sm:pb-6">
              <div aria-hidden className="mx-auto mb-5 h-1 w-9 rounded-full bg-line-strong" />
              {sheet?.kind === "upload" && (
                <UploadSheet
                  items={sheet.items}
                  unlocked={unlocked}
                  busy={busy}
                  onVerified={(code) => {
                    remember(code);
                    void runUploads();
                  }}
                  onRetry={() => void runUploads()}
                  onPickOther={pickFiles}
                  onClose={() => setOpen(false)}
                />
              )}
              {sheet?.kind === "delete" && (
                <DeleteSheet
                  targets={sheet.targets}
                  unlocked={unlocked}
                  busy={busy}
                  onVerified={remember}
                  onConfirm={() => void runDelete()}
                  onCancel={() => setOpen(false)}
                />
              )}
              {!sheet && <Drawer.Title className="sr-only">Actions</Drawer.Title>}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-bg/80 p-6 transition-opacity duration-150",
          dragging ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="flex w-full max-w-md flex-col items-center gap-2 rounded-[28px] border-2 border-dashed border-ink/25 bg-surface/70 px-8 py-14 text-center">
          <ImageUp className="mb-1 size-6 text-ink-2" strokeWidth={1.75} />
          <p className="text-[17px] font-semibold tracking-[-0.01em]">Drop to upload</p>
          <p className="text-[13.5px] text-ink-3">PNG, JPEG or WebP · up to 50 MB each</p>
        </div>
      </div>
    </AdminContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */

function SheetHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5 text-center">
      <Drawer.Title className="text-[19px] font-semibold tracking-[-0.015em] text-balance">{title}</Drawer.Title>
      <Drawer.Description className={cn("mt-1 text-[14px] text-pretty text-ink-2", !description && "sr-only")}>
        {description || title}
      </Drawer.Description>
    </div>
  );
}

function UploadSheet({
  items,
  unlocked,
  busy,
  onVerified,
  onRetry,
  onPickOther,
  onClose,
}: {
  items: UploadItem[];
  unlocked: boolean;
  busy: boolean;
  onVerified: (code: string) => void;
  onRetry: () => void;
  onPickOther: () => void;
  onClose: () => void;
}) {
  const valid = items.filter((i) => i.status !== "invalid");
  const failed = items.some((i) => i.status === "error");
  const n = items.length;

  const description = !valid.length
    ? "None of these can be uploaded."
    : !unlocked
      ? "Enter the passcode to start uploading."
      : busy
        ? "Keep this open. It's shown at full resolution once ready."
        : undefined;

  return (
    <>
      <SheetHeader title={n === 1 ? "Upload screenshot" : `Upload ${n} screenshots`} description={description} />

      <ul className="-mx-1 max-h-[38dvh] divide-y divide-line overflow-y-auto overscroll-contain px-1">
        {items.map((item) => (
          <UploadRow key={item.key} item={item} />
        ))}
      </ul>

      <div className="mt-5">
        {!valid.length ? (
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" onClick={onClose}>
              Close
            </Button>
            <Button size="lg" variant="primary" onClick={onPickOther}>
              Choose others
            </Button>
          </div>
        ) : !unlocked ? (
          <PasscodeField onVerified={onVerified} />
        ) : failed && !busy ? (
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" onClick={onClose}>
              Close
            </Button>
            <Button size="lg" variant="primary" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : (
          <Button size="lg" variant="secondary" className="w-full" disabled>
            <Spinner className="size-4" />
            Uploading…
          </Button>
        )}
      </div>
    </>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const { file, status, progress, error, preview } = item;
  const pct = Math.round(progress * 100);

  const meta =
    status === "invalid" || status === "error"
      ? error
      : status === "uploading"
        ? `Uploading · ${pct}%`
        : status === "processing"
          ? "Preparing full-resolution tiles…"
          : status === "done"
            ? "Done"
            : formatBytes(file.size);

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded-[8px] bg-surface-2 ring-1 ring-line">
        {preview ? (
          <img
            src={preview}
            alt=""
            decoding="async"
            onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            className="size-full object-cover object-top"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[14px] font-medium">{displayName(file.name)}</p>
          {status !== "invalid" && status !== "ready" && (
            <span className="shrink-0 font-mono text-[11.5px] text-ink-3 tabular">{formatBytes(file.size)}</span>
          )}
        </div>
        <p
          className={cn(
            "mt-0.5 truncate text-[12.5px] tabular",
            status === "invalid" || status === "error" ? "text-danger" : "text-ink-3",
          )}
        >
          {meta}
        </p>
        {(status === "uploading" || status === "processing") && (
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-surface-2">
            {status === "uploading" ? (
              <div
                className="h-full origin-left rounded-full bg-accent transition-transform duration-200 ease-out"
                style={{ transform: `scaleX(${Math.max(0.02, progress)})` }}
              />
            ) : (
              <div className="reduce-motion-static h-full w-2/5 animate-[indeterminate_1.1s_var(--ease-in-out)_infinite] rounded-full bg-accent" />
            )}
          </div>
        )}
      </div>
      <div className="flex size-5 shrink-0 items-center justify-center">
        {status === "done" && <Check className="size-4 text-accent" strokeWidth={2.5} />}
        {(status === "invalid" || status === "error") && <AlertCircle className="size-4 text-danger" strokeWidth={2} />}
        {(status === "uploading" || status === "processing") && <Spinner className="size-3.5 text-ink-3" />}
      </div>
    </li>
  );
}

function DeleteSheet({
  targets,
  unlocked,
  busy,
  onVerified,
  onConfirm,
  onCancel,
}: {
  targets: Screenshot[];
  unlocked: boolean;
  busy: boolean;
  onVerified: (code: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const n = targets.length;
  const single = n === 1 ? targets[0] : null;

  return (
    <>
      <SheetHeader
        title={single ? "Delete this screenshot?" : `Delete ${n} screenshots?`}
        description="The original and its tiles are removed for good."
      />

      {single ? (
        <div className="flex items-center gap-3 rounded-[16px] bg-surface-2/70 p-2.5 pr-4 ring-1 ring-line">
          <img
            src={publicUrl(single.thumb_path)}
            alt=""
            className="h-14 w-10 shrink-0 rounded-[8px] object-cover object-top ring-1 ring-line"
          />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium">{displayName(single.name)}</p>
            <p className="mt-0.5 font-mono text-[11.5px] text-ink-3 tabular">
              {formatNumber(single.width)} × {formatNumber(single.height)} · {formatBytes(single.original_bytes)}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex justify-center -space-x-4">
          {targets.slice(0, 5).map((t, i) => (
            <img
              key={t.id}
              src={publicUrl(t.thumb_path)}
              alt=""
              className="h-16 w-12 rounded-[9px] object-cover object-top shadow-sm ring-2 ring-surface"
              style={{ transform: `rotate(${(i - Math.min(4, n - 1) / 2) * 4}deg)` }}
            />
          ))}
        </div>
      )}

      <div className="mt-6">
        {!unlocked ? (
          <PasscodeField onVerified={onVerified} label="Passcode to delete" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button size="lg" variant="danger" onClick={onConfirm} disabled={busy} autoFocus className="disabled:bg-danger">
              {busy ? <Spinner className="size-4" /> : null}
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
