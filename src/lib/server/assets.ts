import "server-only";
import { publicUrl, tilePath, tileRegions, type Screenshot } from "../screenshot";
import type { AssetResult } from "./tiling";

/** Database fields describing a freshly built set of derived files. */
export function assetFields(result: AssetResult) {
  return {
    width: result.width,
    height: result.height,
    tiles: result.tiles,
    thumb_path: result.thumb.path,
    thumb_width: result.thumb.width,
    thumb_height: result.thumb.height,
    preview_path: result.preview.path,
    preview_width: result.preview.width,
    preview_height: result.preview.height,
  };
}

/** Pulls every derived file through the CDN edge nearest this region. */
export async function warmCdn(s: Screenshot) {
  const urls = [
    ...(s.preview_path ? [publicUrl(s.preview_path)] : []),
    publicUrl(s.thumb_path),
    ...tileRegions(s.width, s.height, s.tiles).map((r) => publicUrl(tilePath(s.id, s.tiles, r.row, r.col))),
  ];
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      await fetch(url, { cache: "no-store" })
        .then((res) => res.arrayBuffer())
        .catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}

/** Strips server-only fields before anything reaches the browser. */
export function toPublic<T extends Screenshot>(row: T): Screenshot {
  return {
    id: row.id,
    name: row.name,
    share_slug: row.share_slug,
    original_bytes: row.original_bytes,
    width: row.width,
    height: row.height,
    tiles: row.tiles,
    thumb_path: row.thumb_path,
    thumb_width: row.thumb_width,
    thumb_height: row.thumb_height,
    preview_path: row.preview_path,
    preview_width: row.preview_width,
    preview_height: row.preview_height,
    created_at: row.created_at,
  };
}
