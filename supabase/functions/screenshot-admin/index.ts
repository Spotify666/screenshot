// Longshot admin gateway.
//
// The Vercel server is the only caller: it checks the passcode, then asks this
// function (which holds the service-role key) to sign uploads, write records
// and delete files. Requests must carry the shared secret in `x-admin-secret`;
// only its SHA-256 lives here, the secret itself is a Vercel env var.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const SECRET_SHA256 = "c8b0613c3f059fcea877276d8e26e5feefc19f52145d78e827f0e181fc6ee835";
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!provided || !safeEqual(await sha256Hex(provided), SECRET_SHA256)) {
    return json({ error: "Unauthorized" }, 401);
  }

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
