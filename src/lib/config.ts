export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const BUCKET = "screenshots";

/** 50 MB — matches the bucket's file_size_limit. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const ACCEPTED_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type AcceptedType = keyof typeof ACCEPTED_TYPES;

export const ACCEPT_ATTR = Object.keys(ACCEPTED_TYPES).join(",");

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
