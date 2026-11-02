import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { admin } from "./admin";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message, ...err.extra }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/**
 * Throws unless `passcode` matches ADMIN_PASSCODE. Failed attempts are counted
 * per IP in Supabase: 10 wrong tries locks that IP out for 15 minutes.
 */
export async function assertPasscode(req: Request, passcode: unknown) {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected) throw new HttpError(500, "The passcode isn't configured on the server.");

  const ip = clientIp(req);
  const { retryAfter } = await admin<{ retryAfter: number }>("retry-after", { ip });
  if (retryAfter > 0) {
    const minutes = Math.ceil(retryAfter / 60);
    throw new HttpError(429, `Too many wrong attempts. Try again in ${minutes} min.`, { retryAfter });
  }

  const ok = typeof passcode === "string" && timingSafeEqual(digest(passcode), digest(expected));
  if (!ok) {
    await admin("record-failure", { ip });
    throw new HttpError(401, "That passcode isn't right.");
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}
