import "server-only";
import { SUPABASE_URL } from "../config";

/**
 * Calls the `screenshot-admin` Supabase Edge Function, which holds the
 * service-role key. Authenticated with a shared secret only this server knows.
 */
export async function admin<T = { ok: true }>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const secret = process.env.ADMIN_SHARED_SECRET;
  if (!secret) throw new Error("ADMIN_SHARED_SECRET is not configured.");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/screenshot-admin`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": secret },
    body: JSON.stringify({ action, ...payload }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Admin action "${action}" failed (${res.status}).`);
  return data as T;
}
