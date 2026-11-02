// Longshot admin gateway.
//
// The Vercel app is the only caller: it checks the passcode, then asks this
// function (which holds the service-role key) to sign uploads, write records
// and delete files.
//
// There is no shared secret. Each request carries the Vercel deployment's own
// OIDC token (x-vercel-oidc-token), signed by Vercel; we verify it against
// Vercel's public keys and accept only tokens issued to the Longshot project.
//
// Storage layout
//   screenshots (public)           assets/<id>/<rev>/tiles/<row>-<col>.(webp|jpg)
//                                   assets/<id>/<rev>/thumb.webp
//                                   assets/<id>/<rev>/preview.jpg
//   screenshot-originals (private) <id>.(png|jpg|webp)
// Older uploads used tiles/<id>/…, thumbs/<id>.webp and originals/<id>.* in the
// public bucket; those are still cleaned up on delete.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.15";

const VERCEL_TEAM_SLUG = "spotifys-projects-00b6ab18";
const VERCEL_PROJECT_ID = "prj_oKmOlzK9zzWYlGpJ1d4PwRyvN5hN";
const VERCEL_PROJECT_NAME = "longshot";
const OIDC_ISSUER = `https://oidc.vercel.com/${VERCEL_TEAM_SLUG}`;
const OIDC_AUDIENCE = `https://vercel.com/${VERCEL_TEAM_SLUG}`;
const JWKS = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks`));

const PUBLIC_BUCKET = "screenshots";
const PRIVATE_BUCKET = "screenshot-originals";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ASSET_RE = new RegExp(
  `^assets/${UUID}/[a-z0-9]{6,16}/(tiles/\\d{1,4}-\\d{1,3}\\.(webp|jpg)|thumb\\.webp|preview\\.jpg)$`,
);
const ORIGINAL_RE = new RegExp(`^${UUID}\\.(png|jpg|webp)$`);
const ID_RE = new RegExp(`^${UUID}$`);
const REV_RE = /^[a-z0-9]{6,16}$/;
const MAX_PATHS = 600;
const EXTS = ["png", "jpg", "webp"];
const UPDATABLE = new Set([
  "tiles",
  "thumb_path",
  "thumb_width",
  "thumb_height",
  "preview_path",
  "preview_width",
  "preview_height",
  "original_path",
  "original_mime",
]);

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

function validAssetPaths(paths: unknown): paths is string[] {
  return (
    Array.isArray(paths) &&
    paths.length > 0 &&
    paths.length <= MAX_PATHS &&
    paths.every((p) => typeof p === "string" && ASSET_RE.test(p))
  );
}

/** Every file under a prefix (folders are expanded up to `depth` levels). */
async function listFiles(bucket: string, prefix: string, depth = 3): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      if (item.id === null) {
        if (depth > 0) out.push(...(await listFiles(bucket, path, depth - 1)));
      } else {
        out.push(path);
      }
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function removePaths(bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 500) {
    const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + 500));
    if (error) throw error;
  }
}

/** Removes derived files (and legacy public copies). Keeps `keepRev` if given. */
async function removeAssets(id: string, keepRev?: string) {
  const current = (await listFiles(PUBLIC_BUCKET, `assets/${id}`)).filter(
    (p) => !keepRev || !p.startsWith(`assets/${id}/${keepRev}/`),
  );
  const legacyTiles = await listFiles(PUBLIC_BUCKET, `tiles/${id}`, 0);
  const legacy = [...legacyTiles, `thumbs/${id}.webp`, ...EXTS.map((e) => `originals/${id}.${e}`)];
  await removePaths(PUBLIC_BUCKET, [...current, ...legacy]);
}

async function removeOriginal(id: string) {
  await removePaths(PRIVATE_BUCKET, EXTS.map((e) => `${id}.${e}`));
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

      // Signed upload URLs for derived, public files.
      case "sign": {
        if (!validAssetPaths(body.paths)) return json({ error: "Invalid paths" }, 400);
        const urls = await Promise.all(
          body.paths.map(async (path) => {
            const { data, error } = await supabase.storage
              .from(PUBLIC_BUCKET)
              .createSignedUploadUrl(path, { upsert: true });
            if (error) throw error;
            return { path, signedUrl: data.signedUrl, token: data.token };
          }),
        );
        return json({ urls });
      }

      // Signed upload URL for an original (private bucket).
      case "sign-original": {
        const path = String(body.path ?? "");
        if (!ORIGINAL_RE.test(path)) return json({ error: "Invalid path" }, 400);
        const { data, error } = await supabase.storage
          .from(PRIVATE_BUCKET)
          .createSignedUploadUrl(path, { upsert: true });
        if (error) throw error;
        return json({ path, signedUrl: data.signedUrl, token: data.token });
      }

      // Short-lived read URL so the server can process an original.
      case "original-url": {
        const path = String(body.path ?? "");
        if (!ORIGINAL_RE.test(path)) return json({ error: "Invalid path" }, 400);
        const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(path, 300);
        if (error) throw error;
        return json({ url: data.signedUrl });
      }

      case "get": {
        const id = String(body.id ?? "");
        if (!ID_RE.test(id)) return json({ error: "Invalid id" }, 400);
        const { data, error } = await supabase.from("screenshots").select("*").eq("id", id).maybeSingle();
        if (error) throw error;
        return json({ row: data });
      }

      case "insert": {
        const row = body.row as Record<string, unknown> | undefined;
        if (!row || typeof row.id !== "string" || !ID_RE.test(row.id)) return json({ error: "Invalid row" }, 400);
        const { data, error } = await supabase.from("screenshots").insert(row).select().single();
        if (error) throw error;
        return json({ row: data });
      }

      case "update": {
        const id = String(body.id ?? "");
        const patch = body.patch as Record<string, unknown> | undefined;
        if (!ID_RE.test(id) || !patch || !Object.keys(patch).every((k) => UPDATABLE.has(k))) {
          return json({ error: "Invalid update" }, 400);
        }
        const { data, error } = await supabase.from("screenshots").update(patch).eq("id", id).select().single();
        if (error) throw error;
        return json({ row: data });
      }

      case "delete": {
        const id = String(body.id ?? "");
        if (!ID_RE.test(id)) return json({ error: "Invalid id" }, 400);
        // Record first, so every link to it stops working immediately.
        const { error } = await supabase.from("screenshots").delete().eq("id", id);
        if (error) throw error;
        await removeAssets(id);
        await removeOriginal(id);
        return json({ ok: true });
      }

      case "remove-files": {
        const id = String(body.id ?? "");
        if (!ID_RE.test(id)) return json({ error: "Invalid id" }, 400);
        const keepRev = typeof body.keepRev === "string" && REV_RE.test(body.keepRev) ? body.keepRev : undefined;
        await removeAssets(id, keepRev);
        if (body.includeOriginal === true) await removeOriginal(id);
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
