import { after } from "next/server";
import { UUID_RE } from "@/lib/config";
import { publicUrl, type ScreenshotRow } from "@/lib/screenshot";
import { admin } from "@/lib/server/admin";
import { assetFields, toPublic, warmCdn } from "@/lib/server/assets";
import { assertPasscode, errorResponse, HttpError, readJson } from "@/lib/server/http";
import { buildAssets, newRevision, storeOriginal } from "@/lib/server/tiling";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Rebuilds a screenshot's derived files from its original with the current
 * pipeline (new revision folder, so no stale cache can mix in), moving the
 * original into private storage if it was uploaded before that existed.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readJson(req);
    await assertPasscode(req, body.passcode);
    if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid id.");

    const { row } = await admin<{ row: ScreenshotRow | null }>("get", { id });
    if (!row) throw new HttpError(404, "Screenshot not found.");

    const legacy = row.original_path.startsWith("originals/");
    const sourceUrl = legacy
      ? publicUrl(row.original_path)
      : (await admin<{ url: string }>("original-url", { path: row.original_path })).url;
    const res = await fetch(sourceUrl, { cache: "no-store" });
    if (!res.ok) throw new HttpError(410, "The original file is missing.");
    const input = Buffer.from(await res.arrayBuffer());

    let originalPath = row.original_path;
    if (legacy) {
      originalPath = row.original_path.replace(/^originals\//, "");
      await storeOriginal(originalPath, input, row.original_mime);
    }

    const rev = newRevision();
    const result = await buildAssets(id, rev, input);
    const { row: updated } = await admin<{ row: ScreenshotRow }>("update", {
      id,
      patch: { ...assetFields(result), original_path: originalPath },
    });

    // Old revisions and any legacy public copies (including a public original).
    await admin("remove-files", { id, keepRev: rev });
    after(() => warmCdn(updated));
    return Response.json({ screenshot: toPublic(updated) });
  } catch (err) {
    return errorResponse(err);
  }
}
