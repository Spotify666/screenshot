import { after } from "next/server";
import { MAX_UPLOAD_BYTES, UUID_RE } from "@/lib/config";
import type { ScreenshotRow } from "@/lib/screenshot";
import { admin } from "@/lib/server/admin";
import { assetFields, toPublic, warmCdn } from "@/lib/server/assets";
import { assertPasscode, errorResponse, HttpError, readJson } from "@/lib/server/http";
import { buildAssets, newRevision } from "@/lib/server/tiling";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Step 2 of an upload: once the original is in private storage, cut it into
 * full-resolution tiles (plus thumbnail and preview) and record it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let mayHaveFiles = false;

  try {
    const body = await readJson(req);
    await assertPasscode(req, body.passcode);

    if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid upload id.");
    const originalPath = String(body.path ?? "");
    if (!new RegExp(`^${id}\\.(png|jpg|webp)$`).test(originalPath)) {
      throw new HttpError(400, "Invalid upload path.");
    }
    mayHaveFiles = true;

    const { url } = await admin<{ url: string }>("original-url", { path: originalPath }).catch(() => {
      throw new HttpError(409, "The file didn't finish uploading. Please try again.");
    });
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new HttpError(409, "The file didn't finish uploading. Please try again.");
    const input = Buffer.from(await res.arrayBuffer());
    if (input.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "Files can be up to 50 MB.");

    const result = await buildAssets(id, newRevision(), input);
    const name = String(body.name ?? "").trim().slice(0, 200) || `Screenshot ${new Date().toISOString().slice(0, 10)}`;

    const { row } = await admin<{ row: ScreenshotRow }>("insert", {
      row: {
        id,
        name,
        original_path: originalPath,
        original_mime: result.mime,
        original_bytes: input.length,
        ...assetFields(result),
      },
    });

    after(() => warmCdn(row));
    return Response.json({ screenshot: toPublic(row) });
  } catch (err) {
    if (mayHaveFiles) await admin("remove-files", { id, includeOriginal: true }).catch(() => undefined);
    return errorResponse(err);
  }
}
