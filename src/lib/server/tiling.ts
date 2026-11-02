import "server-only";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, SUPABASE_KEY, SUPABASE_URL } from "../config";
import { planTiles, tilePath, tileRegions, type TileSet } from "../screenshot";
import { admin } from "./admin";
import { HttpError } from "./http";

sharp.cache(false);

/** Hard ceiling so a single request can't exhaust the function's memory. */
const MAX_PIXELS = 250_000_000;
const MAX_FILES = 590;
const UPLOAD_CONCURRENCY = 6;
const IMMUTABLE = "31536000";

const storage = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from(BUCKET);

export interface TileResult {
  width: number;
  height: number;
  mime: string;
  tiles: TileSet;
  thumb: { path: string; width: number; height: number };
}

async function putSigned(filePath: string, token: string, body: Buffer, contentType: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await storage.uploadToSignedUrl(filePath, token, new Blob([new Uint8Array(body)], { type: contentType }), {
      contentType,
      cacheControl: IMMUTABLE,
      upsert: true,
    });
    if (!error) return;
    lastError = error;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(`Upload of ${filePath} failed.`);
}

/**
 * Cuts the original into full-resolution tiles and a small preview, uploading
 * each one as soon as it's encoded.
 *
 * The image is decoded once into a libvips `.v` file (raw pixels + metadata),
 * so every tile is a cheap crop rather than a fresh decode. The source's ICC
 * profile (e.g. Display P3 on iPhone screenshots) is carried over untouched, so
 * pixel values are never converted. PNG/WebP sources become lossless WebP
 * tiles; JPEG sources become 4:4:4 JPEG at quality 95.
 */
export async function buildTiles(id: string, input: Buffer): Promise<TileResult> {
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
  const dir = await mkdtemp(path.join(tmpdir(), "longshot-"));
  const vfile = path.join(dir, "source.v");

  try {
    let decoder = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate();
    if (keepIcc) decoder = decoder.keepIccProfile();
    await decoder.toFile(vfile);

    const { width = 0, height = 0 } = await sharp(vfile).metadata();
    const tiles = planTiles(width, height, format);
    const regions = tileRegions(width, height, tiles);
    if (regions.length + 1 > MAX_FILES) {
      throw new HttpError(413, "That image is too large to tile. Try splitting it into parts.");
    }

    const thumbPath = `thumbs/${id}.webp`;
    const paths = [...regions.map((r) => tilePath(id, r.row, r.col, format)), thumbPath];
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

    // Preview first: the top of the capture, 640px wide, used by gallery cards.
    const cropHeight = Math.min(height, Math.round(width * 2));
    const thumbWidth = Math.min(640, width);
    const thumbHeight = Math.max(1, Math.round((cropHeight * thumbWidth) / width));
    const thumb = await sharp(vfile)
      .extract({ left: 0, top: 0, width, height: cropHeight })
      .resize({ width: thumbWidth })
      .webp({ quality: 82 })
      .toBuffer();
    await enqueue(thumbPath, thumb, "image/webp");

    for (const r of regions) {
      let tile = sharp(vfile).extract({ left: r.left, top: r.top, width: r.width, height: r.height });
      if (keepIcc) tile = tile.keepIccProfile();
      const body =
        format === "jpg"
          ? await tile.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer()
          : await tile.webp({ lossless: true, effort: 1 }).toBuffer();
      await enqueue(tilePath(id, r.row, r.col, format), body, format === "jpg" ? "image/jpeg" : "image/webp");
    }

    await Promise.all(inFlight);
    if (failures.length) throw failures[0];

    return {
      width,
      height,
      mime: `image/${meta.format}`,
      tiles,
      thumb: { path: thumbPath, width: thumbWidth, height: thumbHeight },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
