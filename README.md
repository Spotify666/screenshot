# Longshot

Upload long screenshots (WhatsApp chats, scroll captures — up to 50 MB each) and
read them at full resolution, smoothly, on any phone, tablet or desktop browser.

- **View:** anyone with the link can browse and read.
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

Viewer extras: a draggable fast-scroll handle for very long captures, an
auto-hiding header and dock, zoom on desktop (`+` `−` `0`; it keeps your place),
native pinch-zoom on touch, "Continue at 42%" when you come back, and a download of
the untouched original. Drop or paste an image anywhere to upload.

## Architecture

```
Browser ──PUT original──▶ Supabase Storage (bucket "screenshots", public read)
   │                                ▲
   ▼                                │ signed upload URLs, delete, insert
Vercel (Next.js, bom1)  ──Vercel OIDC token──▶ Edge Function "screenshot-admin"
   │  checks passcode                         (holds the service-role key)
   │  tiles with sharp
   └─ reads records ──▶ Postgres table public.screenshots (RLS: public select only)
```

- `supabase/migrations/…_longshot.sql`: table, RLS, passcode rate-limit
  (10 wrong tries per IP per 15 minutes) and the 50 MB bucket.
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
