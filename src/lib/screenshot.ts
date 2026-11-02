import { BUCKET, SUPABASE_URL } from "./config";

export type TileFormat = "webp" | "jpg";

/**
 * How a screenshot is cut into tiles. Tiles are stored at full resolution and
 * each one (except the last row/column) carries `overlap` extra pixels on its
 * right and bottom edge, so the next tile is painted over identical pixels and
 * no hairline seam can appear at any zoom level.
 */
export interface TileSet {
  format: TileFormat;
  overlap: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

export interface Screenshot {
  id: string;
  name: string;
  original_path: string;
  original_mime: string;
  original_bytes: number;
  width: number;
  height: number;
  tiles: TileSet;
  thumb_path: string;
  thumb_width: number;
  thumb_height: number;
  created_at: string;
}

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

export function planTiles(width: number, height: number, format: TileFormat): TileSet {
  const cols = Math.max(1, Math.ceil(width / MAX_TILE_WIDTH));
  const tileWidth = Math.ceil(width / cols);
  const tileHeight = Math.max(512, Math.min(4096, Math.floor(TARGET_TILE_PIXELS / tileWidth)));
  const rows = Math.max(1, Math.ceil(height / tileHeight));
  return { format, overlap: TILE_OVERLAP, cols, rows, tileWidth, tileHeight };
}

export interface TileRegion {
  row: number;
  col: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pixel regions to extract, including the overlap. */
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

export function tilePath(id: string, row: number, col: number, format: TileFormat) {
  return `tiles/${id}/${row}-${col}.${format}`;
}

export function publicUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

export function downloadUrl(s: Screenshot) {
  return `${publicUrl(s.original_path)}?download=${encodeURIComponent(s.name)}`;
}

export function tileRects(s: Screenshot): TileRect[] {
  return tileRegions(s.width, s.height, s.tiles).map((r) => ({
    key: `${r.row}-${r.col}`,
    row: r.row,
    col: r.col,
    src: publicUrl(tilePath(s.id, r.row, r.col, s.tiles.format)),
    left: (r.left / s.width) * 100,
    top: (r.top / s.height) * 100,
    width: (r.width / s.width) * 100,
    height: (r.height / s.height) * 100,
  }));
}

/** File name without its extension. */
export function displayName(name: string) {
  const trimmed = name.replace(/\.(png|jpe?g|webp)$/i, "").trim();
  return trimmed || name;
}

/** How many phone screens tall the capture is (19.5:9 screens). */
export function screensTall(s: Pick<Screenshot, "width" | "height">) {
  return Math.max(1, Math.round(s.height / (s.width * (19.5 / 9))));
}
