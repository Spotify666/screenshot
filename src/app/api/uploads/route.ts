import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, type AcceptedType } from "@/lib/config";
import { admin } from "@/lib/server/admin";
import { assertPasscode, errorResponse, HttpError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * Step 1 of an upload: hands the browser a one-time signed URL so the file
 * goes straight into the private originals bucket (Vercel functions cap
 * request bodies at 4.5 MB).
 */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    await assertPasscode(req, body.passcode);

    const ext = ACCEPTED_TYPES[body.type as AcceptedType];
    if (!ext) throw new HttpError(415, "Only PNG, JPEG and WebP images are supported.");

    const size = Number(body.size);
    if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, "That file is empty.");
    if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, "Files can be up to 50 MB.");

    const id = crypto.randomUUID();
    const path = `${id}.${ext}`;
    const { signedUrl } = await admin<{ signedUrl: string }>("sign-original", { path });

    return Response.json({ id, path, uploadUrl: signedUrl });
  } catch (err) {
    return errorResponse(err);
  }
}
