import "server-only";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, ORIGINALS_BUCKET, SUPABASE_KEY, SUPABASE_URL } from "../config";
import { assetsPrefix, planTiles, tilePath, tileRegions, type TileSet } from "../screenshot";
import { admin } from "./admin";
import { HttpError } from "./http";

sharp.cache(false);

/** Hard ceiling so a single request can't exhaust the function's memory. */
const MAX_PIXELS = 250_000_000;
const MAX_FILES = 590;
const UPLOAD_CONCURRENCY = 6;
/**
 * One hour. The free Supabase CDN can't purge on delete, so a short TTL is
 * what makes deleted screenshots disappear from edge caches quickly.
 */
const CACHE_SECONDS = "3600";
const PREVIEW_WIDTH = 240;

const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const publicStorage = client.storage.from(BUCKET);

export interface AssetResult {
  width: number;
  height: number;
  mime: string;
  tiles: TileSet;
  thumb: { path: string; width: number; height: number };
  preview: { path: string; width: number; height: number };
}

export function newRevision() {
  return randomBytes(6).toString("hex");
}

async function putSigned(filePath: string, token: string, body: Buffer, contentType: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await publicStorage.uploadToSignedUrl(
      filePath,
      token,
      new Blob([new Uint8Array(body)], { type: contentType }),
      { contentType, cacheControl: CACHE_SECONDS, upsert: true },
    );
    if (!error) return;
    lastError = error;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(`Upload of ${filePath} failed.`);
}

/** Stores an original in the private bucket (used when migrating old uploads). */
export async function storeOriginal(originalPath: string, body: Buffer, contentType: string) {
  const { token } = await admin<{ token: string }>("sign-original", { path: originalPath });
  const { error } = await client.storage
    .from(ORIGINALS_BUCKET)
    .uploadToSignedUrl(originalPath, token, new Blob([new Uint8Array(body)], { type: contentType }), {
      contentType,
      upsert: true,
    });
  if (error) throw error;
}

/**
 * Cuts the original into full-resolution tiles, plus a gallery thumbnail and a
 * tiny whole-image preview, uploading each file as soon as it's encoded.
 *
 * The image is decoded once into a libvips `.v` file (raw pixels + metadata),
 * so every tile is a cheap crop rather than a fresh decode. The source's ICC
 * profile (e.g. Display P3 on iPhone screenshots) is carried over untouched, so
 * pixel values are never converted. PNG/WebP sources become lossless WebP
 * tiles; JPEG sources become quality-95 JPEG with the source's own chroma
 * subsampling (re-encoding 4:2:0 as 4:4:4 only adds bytes, never detail).
 */
export async function buildAssets(id: string, rev: string, input: Buffer): Promise<AssetResult> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw new HttpError(415, "That file couldn't be read as an image.");
  }

  const format = meta.format === "jpeg" ? "jpg" : meta.format === "png" || meta.format === "webp" ? "webp" : null;
  if (!format) throw new HttpError(415, "Only PNG, JPEG and WebP images are supported.");
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_PIXELS) {
    throw new HttpError(413, "That image has too many pixels to process (max 250 megapixels).");
  }

  const keepIcc = Boolean(meta.icc) && meta.space !== "cmyk";
  const chroma = meta.chromaSubsampling === "4:4:4" ? "4:4:4" : "4:2:0";
  const dir = await mkdtemp(path.join(tmpdir(), "longshot-"));
  const vfile = path.join(dir, "source.v");

  try {
    let decoder = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate();
    if (keepIcc) decoder = decoder.keepIccProfile();
    await decoder.toFile(vfile);

    const { width = 0, height = 0 } = await sharp(vfile).metadata();
    const tiles = planTiles(width, height, format, rev);
    const regions = tileRegions(width, height, tiles);
    if (regions.length + 2 > MAX_FILES) {
      throw new HttpError(413, "That image is too large to tile. Try splitting it into parts.");
    }

    const prefix = assetsPrefix(id, rev);
    const thumbPath = `${prefix}/thumb.webp`;
    const previewPath = `${prefix}/preview.jpg`;
    const paths = [previewPath, thumbPath, ...regions.map((r) => tilePath(id, tiles, r.row, r.col))];
    const { urls } = await admin<{ urls: { path: string; token: string }[] }>("sign", { paths });
    const tokens = new Map(urls.map((u) => [u.path, u.token]));

    const inFlight = new Set<Promise<void>>();
    const failures: unknown[] = [];
    const enqueue = async (filePath: string, body: Buffer, type: string) => {
      while (inFlight.size >= UPLOAD_CONCURRENCY) await Promise.race(inFlight);
      if (failures.length) throw failures[0];
      const task = putSigned(filePath, tokens.get(filePath)!, body, type)
        .catch((err) => void failures.push(err))
        .finally(() => inFlight.delete(task));
      inFlight.add(task);
    };

    // 1. Whole-image preview: shown instantly so the capture is always complete
    //    and in order on screen while full-resolution tiles stream in.
    let previewWidth = Math.min(PREVIEW_WIDTH, width);
    if ((height * previewWidth) / width > 60000) previewWidth = Math.max(1, Math.floor((60000 * width) / height));
    const previewHeight = Math.max(1, Math.round((height * previewWidth) / width));
    const preview = await sharp(vfile)
      .resize({ width: previewWidth, height: previewHeight, fit: "fill" })
      .jpeg({ quality: 60, mozjpeg: true })
      .toBuffer();
    await enqueue(previewPath, preview, "image/jpeg");

    // 2. Gallery thumbnail: the top of the capture, 640px wide.
    const cropHeight = Math.min(height, Math.round(width * 2));
    const thumbWidth = Math.min(640, width);
    const thumbHeight = Math.max(1, Math.round((cropHeight * thumbWidth) / width));
    const thumb = await sharp(vfile)
      .extract({ left: 0, top: 0, width, height: cropHeight })
      .resize({ width: thumbWidth })
      .webp({ quality: 82 })
      .toBuffer();
    await enqueue(thumbPath, thumb, "image/webp");

    // 3. Full-resolution tiles, top to bottom.
    for (const r of regions) {
      let tile = sharp(vfile).extract({ left: r.left, top: r.top, width: r.width, height: r.height });
      if (keepIcc) tile = tile.keepIccProfile();
      const body =
        format === "jpg"
          ? await tile.jpeg({ quality: 95, chromaSubsampling: chroma, mozjpeg: true }).toBuffer()
          : await tile.webp({ lossless: true, effort: 1 }).toBuffer();
      await enqueue(tilePath(id, tiles, r.row, r.col), body, format === "jpg" ? "image/jpeg" : "image/webp");
    }

    await Promise.all(inFlight);
    if (failures.length) throw failures[0];

    return {
      width,
      height,
      mime: `image/${meta.format}`,
      tiles,
      thumb: { path: thumbPath, width: thumbWidth, height: thumbHeight },
      preview: { path: previewPath, width: previewWidth, height: previewHeight },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
