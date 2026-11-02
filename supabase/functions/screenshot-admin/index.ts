// Longshot admin gateway.
//
// The Vercel app is the only caller: it checks the passcode, then asks this
// function (which holds the service-role key) to sign uploads, write records
// and delete files.
//
// There is no shared secret. Each request carries the Vercel deployment's own
// OIDC token (x-vercel-oidc-token), signed by Vercel; we verify it against
// Vercel's public keys and accept only tokens issued to the Longshot project.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.15";

const VERCEL_TEAM_SLUG = "spotifys-projects-00b6ab18";
const VERCEL_PROJECT_ID = "prj_oKmOlzK9zzWYlGpJ1d4PwRyvN5hN";
const VERCEL_PROJECT_NAME = "longshot";
const OIDC_ISSUER = `https://oidc.vercel.com/${VERCEL_TEAM_SLUG}`;
const OIDC_AUDIENCE = `https://vercel.com/${VERCEL_TEAM_SLUG}`;
const JWKS = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks`));
const BUCKET = "screenshots";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_RE = new RegExp(
  `^(originals/${UUID}\\.(png|jpg|webp)|tiles/${UUID}/\\d{1,4}-\\d{1,3}\\.(webp|jpg)|thumbs/${UUID}\\.webp)$`,
);
const ID_RE = new RegExp(`^${UUID}$`);
const MAX_PATHS = 600;

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return keys.default ?? Object.values(keys)[0];
}

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", connection: "keep-alive" },
  });

async function isLongshotDeployment(req: Request): Promise<boolean> {
  const token = req.headers.get("x-vercel-oidc-token");
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: OIDC_ISSUER, audience: OIDC_AUDIENCE });
    if (typeof payload.project_id === "string") return payload.project_id === VERCEL_PROJECT_ID;
    return (
      typeof payload.sub === "string" &&
      payload.sub.startsWith(`owner:${VERCEL_TEAM_SLUG}:project:${VERCEL_PROJECT_NAME}:environment:`)
    );
  } catch {
    return false;
  }
}

function validPaths(paths: unknown): paths is string[] {
  return (
    Array.isArray(paths) &&
    paths.length > 0 &&
    paths.length <= MAX_PATHS &&
    paths.every((p) => typeof p === "string" && PATH_RE.test(p))
  );
}

async function removeScreenshotFiles(id: string) {
  const tiles = await supabase.storage.from(BUCKET).list(`tiles/${id}`, { limit: 1000 });
  const paths = (tiles.data ?? []).map((f) => `tiles/${id}/${f.name}`);
  const originals = await supabase.storage.from(BUCKET).list("originals", { search: id, limit: 10 });
  for (const f of originals.data ?? []) paths.push(`originals/${f.name}`);
  paths.push(`thumbs/${id}.webp`);
  for (let i = 0; i < paths.length; i += 500) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 500));
    if (error) throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!(await isLongshotDeployment(req))) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  try {
    switch (body.action) {
      case "retry-after": {
        const { data, error } = await supabase.rpc("screenshot_auth_retry_after", { p_ip: String(body.ip ?? "") });
        if (error) throw error;
        return json({ retryAfter: Number(data ?? 0) });
      }

      case "record-failure": {
        const { error } = await supabase.rpc("screenshot_auth_record_failure", { p_ip: String(body.ip ?? "") });
        if (error) throw error;
        return json({ ok: true });
      }

      case "sign": {
        if (!validPaths(body.paths)) return json({ error: "Invalid paths" }, 400);
        const urls = await Promise.all(
          body.paths.map(async (path) => {
            const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
            if (error) throw error;
            return { path, signedUrl: data.signedUrl, token: data.token };
          }),
        );
        return json({ urls });
      }

      case "insert": {
        const row = body.row as Record<string, unknown> | undefined;
        if (!row || typeof row.id !== "string" || !ID_RE.test(row.id)) return json({ error: "Invalid row" }, 400);
        const { data, error } = await supabase.from("screenshots").insert(row).select().single();
        if (error) throw error;
        return json({ row: data });
      }

      case "delete": {
        const id = String(body.id ?? "");
        if (!ID_RE.test(id)) return json({ error: "Invalid id" }, 400);
        await removeScreenshotFiles(id);
        const { error } = await supabase.from("screenshots").delete().eq("id", id);
        if (error) throw error;
        return json({ ok: true });
      }

      case "remove-files": {
        const id = String(body.id ?? "");
        if (!ID_RE.test(id)) return json({ error: "Invalid id" }, 400);
        await removeScreenshotFiles(id);
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(body.action, message);
    return json({ error: message }, 500);
  }
});
