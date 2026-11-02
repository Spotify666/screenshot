import { assertPasscode, errorResponse, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

/** Checks a passcode without doing anything else, so the UI can unlock early. */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    await assertPasscode(req, body.passcode);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
