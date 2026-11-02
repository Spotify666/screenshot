import { BUCKET, SUPABASE_URL } from "./config";

export type TileFormat = "webp" | "jpg";

/**
 * How a screenshot is cut into tiles. Tiles are stored at full resolution and
 * each one (except the last row/column) carries `overlap` extra pixels on its
 * right and bottom edge, so the next tile is painted over identical pixels and
 * no hairline seam can appear at any zoom level.
 *
 * `rev` names the folder the derived files live in; reprocessing writes a new
 * revision so stale CDN copies can never be mixed with fresh ones.
 */
export interface TileSet {
  format: TileFormat;
  overlap: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  rev?: string;
}

/** What the browser is allowed to know about a screenshot. */
export interface Screenshot {
  id: string;
  name: string;
  share_slug: string;
  original_bytes: number;
  width: number;
  height: number;
  tiles: TileSet;
  thumb_path: string;
  thumb_width: number;
  thumb_height: number;
  preview_path: string | null;
  preview_width: number | null;
  preview_height: number | null;
  created_at: string;
}

/** Server-side only: includes where the private original lives. */
export interface ScreenshotRow extends Screenshot {
  original_path: string;
  original_mime: string;
}

export const PUBLIC_COLUMNS =
  "id,name,share_slug,original_bytes,width,height,tiles,thumb_path,thumb_width,thumb_height,preview_path,preview_width,preview_height,created_at";

export interface TileRect {
  key: string;
  row: number;
  col: number;
  src: string;
  /** Position and size as percentages of the full image. */
  left: number;
  top: number;
  width: number;
  height: number;
}

const TILE_OVERLAP = 4;
const MAX_TILE_WIDTH = 2560;
/** ~2 MP per tile keeps every decode well inside mobile Safari's limits. */
const TARGET_TILE_PIXELS = 2_000_000;

export function planTiles(width: number, height: number, format: TileFormat, rev: string): TileSet {
  const cols = Math.max(1, Math.ceil(width / MAX_TILE_WIDTH));
  const tileWidth = Math.ceil(width / cols);
  const tileHeight = Math.max(512, Math.min(4096, Math.floor(TARGET_TILE_PIXELS / tileWidth)));
  const rows = Math.max(1, Math.ceil(height / tileHeight));
  return { format, overlap: TILE_OVERLAP, cols, rows, tileWidth, tileHeight, rev };
}

export interface TileRegion {
  row: number;
  col: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pixel regions to extract, including the overlap. Row-major, top to bottom. */
export function tileRegions(width: number, height: number, t: TileSet): TileRegion[] {
  const out: TileRegion[] = [];
  for (let row = 0; row < t.rows; row++) {
    for (let col = 0; col < t.cols; col++) {
      const left = col * t.tileWidth;
      const top = row * t.tileHeight;
      const w = Math.min(t.tileWidth + (col < t.cols - 1 ? t.overlap : 0), width - left);
      const h = Math.min(t.tileHeight + (row < t.rows - 1 ? t.overlap : 0), height - top);
      out.push({ row, col, left, top, width: w, height: h });
    }
  }
  return out;
}

export function assetsPrefix(id: string, rev: string) {
  return `assets/${id}/${rev}`;
}

export function tilePath(id: string, t: Pick<TileSet, "format" | "rev">, row: number, col: number) {
  return t.rev
    ? `${assetsPrefix(id, t.rev)}/tiles/${row}-${col}.${t.format}`
    : `tiles/${id}/${row}-${col}.${t.format}`;
}

export function publicUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

export function tileRects(s: Screenshot): TileRect[] {
  return tileRegions(s.width, s.height, s.tiles).map((r) => ({
    key: `${r.row}-${r.col}`,
    row: r.row,
    col: r.col,
    src: publicUrl(tilePath(s.id, s.tiles, r.row, r.col)),
    left: (r.left / s.width) * 100,
    top: (r.top / s.height) * 100,
    width: (r.width / s.width) * 100,
    height: (r.height / s.height) * 100,
  }));
}

export function sharePath(s: Pick<Screenshot, "share_slug">) {
  return `/share/${s.share_slug}`;
}

export const SLUG_RE = /^[A-Za-z0-9_-]{6,32}$/;

/** File name without its extension. */
export function displayName(name: string) {
  const trimmed = name.replace(/\.(png|jpe?g|webp)$/i, "").trim();
  return trimmed || name;
}

/** How many phone screens tall the capture is (19.5:9 screens). */
export function screensTall(s: Pick<Screenshot, "width" | "height">) {
  return Math.max(1, Math.round(s.height / (s.width * (19.5 / 9))));
}
