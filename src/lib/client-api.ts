import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, type AcceptedType } from "./config";
import type { Screenshot } from "./screenshot";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("You seem to be offline. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status}).`, res.status);
  return data as T;
}

const postJson = <T,>(url: string, body: unknown) =>
  request<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function verifyPasscode(passcode: string) {
  return postJson<{ ok: true }>("/api/auth", { passcode });
}

export function deleteScreenshot(id: string, passcode: string) {
  return request<{ ok: true }>(`/api/screenshots/${id}`, { method: "DELETE", headers: { "x-passcode": passcode } });
}

const EXT_TYPES: Record<string, AcceptedType> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Some pickers hand over files with an empty type; fall back to the extension. */
export function resolveType(file: File): AcceptedType | null {
  if (file.type in ACCEPTED_TYPES) return file.type as AcceptedType;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TYPES[ext] ?? null;
}

export function validateFile(file: File): string | null {
  if (!resolveType(file)) return "Not a PNG, JPEG or WebP image";
  if (file.size === 0) return "This file is empty";
  if (file.size > MAX_UPLOAD_BYTES) return "Larger than 50 MB";
  return null;
}

/** PUT straight to Supabase Storage with real upload progress. */
function putToStorage(url: string, blob: Blob, onProgress: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Upload failed (${xhr.status}).`;
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string };
        if (xhr.status === 413) message = "Larger than 50 MB.";
        else if (body.message) message = body.message;
      } catch {}
      reject(new ApiError(message, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("The connection dropped while uploading. Try again.", 0));
    const form = new FormData();
    form.append("cacheControl", "31536000");
    form.append("", blob, "upload");
    xhr.send(form);
  });
}

export type UploadPhase = { phase: "uploading"; progress: number } | { phase: "processing" };

export async function uploadScreenshot(file: File, passcode: string, onPhase: (p: UploadPhase) => void) {
  const type = resolveType(file);
  if (!type) throw new ApiError("Not a PNG, JPEG or WebP image.", 415);

  const init = await postJson<{ id: string; path: string; uploadUrl: string }>("/api/uploads", {
    passcode,
    name: file.name,
    size: file.size,
    type,
  });

  onPhase({ phase: "uploading", progress: 0 });
  await putToStorage(init.uploadUrl, file.slice(0, file.size, type), (progress) => onPhase({ phase: "uploading", progress }));

  onPhase({ phase: "processing" });
  const { screenshot } = await postJson<{ screenshot: Screenshot }>(`/api/uploads/${init.id}`, {
    passcode,
    name: file.name,
    path: init.path,
  });
  return screenshot;
}
