-- Longshot: long-screenshot viewer.
-- Everything here is namespaced (screenshots*, screenshot_private) so it stays
-- isolated from the other tables that live in this Supabase project.

-- 1. Screenshot records (publicly readable, writable only by the service role)
create table if not exists public.screenshots (
  id              uuid primary key,
  name            text        not null check (char_length(name) between 1 and 200),
  original_path   text        not null,
  original_mime   text        not null,
  original_bytes  bigint      not null check (original_bytes > 0),
  width           integer     not null check (width > 0),
  height          integer     not null check (height > 0),
  tiles           jsonb       not null,
  thumb_path      text        not null,
  thumb_width     integer     not null,
  thumb_height    integer     not null,
  created_at      timestamptz not null default now()
);

create index if not exists screenshots_created_at_idx on public.screenshots (created_at desc);

alter table public.screenshots enable row level security;

revoke all on table public.screenshots from anon, authenticated;
grant select on table public.screenshots to anon, authenticated;

drop policy if exists "Screenshots are publicly readable" on public.screenshots;
create policy "Screenshots are publicly readable"
  on public.screenshots for select
  to anon, authenticated
  using (true);

-- 2. Passcode brute-force protection (private schema, not exposed over the API)
create schema if not exists screenshot_private;
revoke all on schema screenshot_private from public, anon, authenticated;

create table if not exists screenshot_private.auth_failures (
  id          bigint generated always as identity primary key,
  ip          text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists auth_failures_ip_created_idx
  on screenshot_private.auth_failures (ip, created_at desc);

-- Seconds until this IP may try again (0 = allowed). 10 failures / 15 minutes.
create or replace function public.screenshot_auth_retry_after(p_ip text)
returns integer
language sql
security definer
set search_path = ''
as $$
  select case
    when count(*) >= 10 then
      greatest(1, ceil(extract(epoch from (min(created_at) + interval '15 minutes' - now())))::integer)
    else 0
  end
  from screenshot_private.auth_failures
  where ip = p_ip
    and created_at > now() - interval '15 minutes';
$$;

create or replace function public.screenshot_auth_record_failure(p_ip text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from screenshot_private.auth_failures where created_at < now() - interval '1 day';
  insert into screenshot_private.auth_failures (ip) values (left(p_ip, 64));
end;
$$;

revoke execute on function public.screenshot_auth_retry_after(text) from public, anon, authenticated;
revoke execute on function public.screenshot_auth_record_failure(text) from public, anon, authenticated;
grant execute on function public.screenshot_auth_retry_after(text) to service_role;
grant execute on function public.screenshot_auth_record_failure(text) to service_role;

-- 3. Storage bucket: public reads (CDN-cached tiles), writes only via signed upload URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', true, 52428800, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
