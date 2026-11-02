import { after } from "next/server";
import { MAX_UPLOAD_BYTES, UUID_RE } from "@/lib/config";
import { publicUrl, tilePath, tileRegions, type Screenshot } from "@/lib/screenshot";
import { admin } from "@/lib/server/admin";
import { assertPasscode, errorResponse, HttpError, readJson } from "@/lib/server/http";
import { buildTiles } from "@/lib/server/tiling";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Step 2 of an upload: once the original is in storage, cut it into
 * full-resolution tiles and record it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let mayHaveFiles = false;

  try {
    const body = await readJson(req);
    await assertPasscode(req, body.passcode);

    if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid upload id.");
    const originalPath = String(body.path ?? "");
    if (!new RegExp(`^originals/${id}\\.(png|jpg|webp)$`).test(originalPath)) {
      throw new HttpError(400, "Invalid upload path.");
    }
    mayHaveFiles = true;

    const res = await fetch(publicUrl(originalPath), { cache: "no-store" });
    if (!res.ok) throw new HttpError(409, "The file didn't finish uploading. Please try again.");
    const input = Buffer.from(await res.arrayBuffer());
    if (input.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "Files can be up to 50 MB.");

    const result = await buildTiles(id, input);
    const name = String(body.name ?? "").trim().slice(0, 200) || `Screenshot ${new Date().toISOString().slice(0, 10)}`;

    const { row } = await admin<{ row: Screenshot }>("insert", {
      row: {
        id,
        name,
        original_path: originalPath,
        original_mime: result.mime,
        original_bytes: input.length,
        width: result.width,
        height: result.height,
        tiles: result.tiles,
        thumb_path: result.thumb.path,
        thumb_width: result.thumb.width,
        thumb_height: result.thumb.height,
      },
    });

    // Warm the CDN edge nearest this region so first views are fast.
    after(() => warmCdn(row));

    return Response.json({ screenshot: row });
  } catch (err) {
    if (mayHaveFiles) await admin("remove-files", { id }).catch(() => undefined);
    return errorResponse(err);
  }
}

async function warmCdn(s: Screenshot) {
  const urls = [
    publicUrl(s.thumb_path),
    ...tileRegions(s.width, s.height, s.tiles).map((r) => publicUrl(tilePath(s.id, r.row, r.col, s.tiles.format))),
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
