import "server-only";
import { getVercelOidcToken } from "@vercel/oidc";
import { SUPABASE_URL } from "../config";

/**
 * Calls the `screenshot-admin` Supabase Edge Function, which holds the
 * service-role key. Authenticated with this deployment's Vercel OIDC token
 * (verified by the function against Vercel's public keys), so no shared
 * secret exists anywhere.
 */
export async function admin<T = { ok: true }>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  let token: string;
  try {
    token = await getVercelOidcToken();
  } catch {
    throw new Error("Vercel OIDC token unavailable. Locally, run `vercel env pull` to get VERCEL_OIDC_TOKEN.");
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/screenshot-admin`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vercel-oidc-token": token },
    body: JSON.stringify({ action, ...payload }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Admin action "${action}" failed (${res.status}).`);
  return data as T;
}
