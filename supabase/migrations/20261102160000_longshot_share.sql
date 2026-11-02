-- Longshot v2: share links, low-res previews, private originals.

-- 1. Short, unguessable share id per screenshot (existing rows get one too).
alter table public.screenshots
  add column if not exists share_slug text not null
    default replace(replace(rtrim(encode(extensions.gen_random_bytes(8), 'base64'), '='), '+', '-'), '/', '_'),
  add column if not exists preview_path text,
  add column if not exists preview_width integer,
  add column if not exists preview_height integer;

create unique index if not exists screenshots_share_slug_key on public.screenshots (share_slug);

-- 2. The public may read display fields only, never where the original lives.
revoke select on table public.screenshots from anon, authenticated;
grant select (
  id, name, share_slug, original_bytes, width, height, tiles,
  thumb_path, thumb_width, thumb_height,
  preview_path, preview_width, preview_height, created_at
) on table public.screenshots to anon, authenticated;

-- 3. Originals live in a private bucket: no public URL, no downloads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshot-originals', 'screenshot-originals', false, 52428800, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
