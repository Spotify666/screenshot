# Longshot

Upload long screenshots (WhatsApp chats, scroll captures — up to 50 MB each) and
read them at full resolution, smoothly, on any phone, tablet or desktop browser.

- **View:** open the site to browse; tap a screenshot to read it.
- **Share:** the Share button gives a short `/share/<id>` link that opens just
  that screenshot: no gallery, no upload or delete. Deleting the screenshot kills
  the link immediately.
- **Upload / Delete:** the two actions in the bottom bar, protected by a passcode
  (`ADMIN_PASSCODE`, currently `1111`). The passcode is remembered for the browser
  session after the first correct entry.

## How it stays sharp everywhere

Browsers, iOS Safari especially, quietly downsample very tall images, so a
1080×50,000 screenshot shown as one `<img>` turns blurry on phones. Longshot never
does that:

1. The browser uploads the original **directly to Supabase Storage** through a
   one-time signed URL (Vercel functions cap request bodies at 4.5 MB).
2. A Vercel function (`/api/uploads/[id]`) decodes it once with `sharp` and cuts it
   into **full-resolution tiles** of about 2 MP each:
   - PNG/WebP sources become **lossless WebP** tiles (exact pixels, about 3.5× smaller
     than PNG). JPEG sources become 4:4:4 JPEG at quality 95.
   - The source's ICC profile (e.g. Display P3 on iPhone) is carried over without
     converting pixel values.
   - Each tile overlaps the next by 4 px, so there are never hairline seams.
3. The viewer stacks the tiles in a box with the image's exact aspect ratio (no
   layout shift). Tiles within 3 screens load immediately; the rest prefetch
   quietly in the background, nearest first, so flinging or scrubbing never lands on blank space.

Loading is ordered so the capture always reads top to bottom: a ~200 KB preview of
the whole image paints first (so the full capture is on screen, in order, at once),
then full-resolution tiles sharpen it starting with what's on screen, then what's
below. Only three download at a time, and far-away ones are cancelled when you jump.

Viewer extras: a draggable fast-scroll handle for very long captures, an
auto-hiding header and dock, zoom on desktop (`+` `−` `0`; it keeps your place),
native pinch-zoom on touch, and "Continue at 42%" when you come back. Drop or paste
an image anywhere to upload.

There is no download: originals sit in a private bucket and are never served,
and long-press / right-click "save image" is blocked on the viewer.

## Architecture

```
Browser ──PUT original──▶ Supabase Storage "screenshot-originals" (private)
                           Supabase Storage "screenshots" (public: tiles, thumb, preview)
   │                                ▲
   ▼                                │ signed upload URLs, delete, insert
Vercel (Next.js, bom1)  ──Vercel OIDC token──▶ Edge Function "screenshot-admin"
   │  checks passcode                         (holds the service-role key)
   │  tiles with sharp
   └─ reads records ──▶ Postgres table public.screenshots (RLS: public select only)
```

- `supabase/migrations/`: table, column-level read grants (the original's
  location is never public), share slugs, passcode rate-limit (10 wrong tries per
  IP per 15 minutes) and the two 50 MB buckets.
- Derived files live under `assets/<id>/<revision>/` with a 1-hour cache, so a
  deleted screenshot drops out of CDN caches within the hour (the free Supabase
  plan can't purge the CDN), while its page and share link 404 at once.
- `supabase/functions/screenshot-admin`: the only code holding the service-role key.
  There's no shared secret: it accepts only requests carrying a Vercel OIDC token
  that Vercel signed for this project (`prj_oKmOlzK9zzWYlGpJ1d4PwRyvN5hN`), checked
  against Vercel's public keys.
- `src/lib/server/tiling.ts`: the sharp tiling pipeline.
- `src/components/tiled-image.tsx`, `viewer.tsx`, `scrubber.tsx`: the viewer.

## Environment variables (Vercel)

| Name | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key, used for read-only access |
| `ADMIN_PASSCODE` | Passcode for upload/delete. Change it here and redeploy |

If the Vercel project is moved or recreated, update `VERCEL_PROJECT_ID` (and the
team slug) in `supabase/functions/screenshot-admin/index.ts` and redeploy the function.

## Local development

```bash
npm install
vercel link && vercel env pull .env.local   # includes VERCEL_OIDC_TOKEN
npm run dev
```
