import { UUID_RE } from "@/lib/config";
import { admin } from "@/lib/server/admin";
import { assertPasscode, errorResponse, HttpError } from "@/lib/server/http";

export const runtime = "nodejs";

/** Deletes a screenshot: original, tiles, preview and record. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertPasscode(req, req.headers.get("x-passcode"));
    if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid id.");
    await admin("delete", { id });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
