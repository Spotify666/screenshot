import "server-only";
import { cache } from "react";
import { SUPABASE_KEY, SUPABASE_URL, UUID_RE } from "../config";
import type { Screenshot } from "../screenshot";

async function rest<T>(query: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers: { apikey: SUPABASE_KEY, accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listScreenshots = cache(async () =>
  rest<Screenshot[]>("screenshots?select=*&order=created_at.desc"),
);

export const getScreenshot = cache(async (id: string): Promise<Screenshot | null> => {
  if (!UUID_RE.test(id)) return null;
  const rows = await rest<Screenshot[]>(`screenshots?select=*&id=eq.${id}&limit=1`);
  return rows[0] ?? null;
});
