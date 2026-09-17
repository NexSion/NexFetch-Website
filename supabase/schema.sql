-- =============================================================
-- NexFetch-Website — Supabase schema
-- Run this in Supabase SQL Editor (Project -> SQL Editor -> New query)
-- Matches the API contract discovered in NexFetch-Chrome:
--   POST api/device/claim
--   GET  api/user
--   GET  api/video/fetch-video-info
--   GET/POST api/videos
--   POST api/reports
--   POST api/streaming/check-limit
--   POST api/streaming/check-cast-limit
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------
-- profiles: 1:1 with auth.users, holds premium/entitlement state
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_premium boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

-- auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------
-- devices: one row per installed extension instance (device_key)
-- ---------------------------------------------------------------
create table if not exists public.devices (
  device_key uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  claimed_at timestamptz,
  last_seen_at timestamptz not null default now(),
  browser text,
  created_at timestamptz not null default now()
);

alter table public.devices enable row level security;

create policy "devices: read own" on public.devices
  for select using (auth.uid() = user_id);

-- Claiming a device happens through the service-role-backed
-- api/device/claim route, not a direct client insert. Unlinking,
-- however, is a normal user action from the dashboard, so it's allowed
-- directly — scoped so a person can only ever null out their own row,
-- never touch someone else's device.
create policy "devices: unlink own" on public.devices
  for update using (auth.uid() = user_id)
  with check (user_id is null);

-- ---------------------------------------------------------------
-- saved_videos: Watch Later / saved list, keyed by content hash
-- ---------------------------------------------------------------
create table if not exists public.saved_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hash text not null,
  title text,
  url text,
  webpage_url text,
  thumbnail text,
  duration numeric,
  extension text,
  quality text,
  size bigint,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, hash)
);

alter table public.saved_videos enable row level security;

create policy "saved_videos: read own" on public.saved_videos
  for select using (auth.uid() = user_id);

create policy "saved_videos: insert own" on public.saved_videos
  for insert with check (auth.uid() = user_id);

create policy "saved_videos: delete own" on public.saved_videos
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- reports: user-submitted problem reports (broken site, bad video, etc)
-- ---------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  -- Not a foreign key on purpose: popup.js's "no video found" report
  -- fires from any device, including ones that were never claimed to
  -- an account (never inserted into public.devices at all).
  device_key uuid,
  url text,
  type text not null,
  metadata jsonb not null default '{}'::jsonb,
  details text,
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "reports: insert any authenticated or anon" on public.reports
  for insert with check (true);

create policy "reports: read own" on public.reports
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- streaming_usage: daily counters for stream/cast limit enforcement
-- ---------------------------------------------------------------
create table if not exists public.streaming_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  -- Not a foreign key on purpose, same reasoning as reports.device_key:
  -- check-limit/check-cast-limit track usage for devices that were
  -- never claimed to an account (never inserted into public.devices).
  device_key uuid,
  kind text not null check (kind in ('stream', 'cast')),
  usage_date date not null default current_date,
  count integer not null default 0
);

-- A table-level UNIQUE(...) constraint can't call a function like
-- coalesce() on its columns — only a unique INDEX can, since indexes
-- support expressions. This is what actually enforces "one row per
-- identity+kind+day", covering both the user_id path and the
-- device_key-only (anonymous) path with a single index.
create unique index if not exists streaming_usage_identity_kind_date
  on public.streaming_usage (
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(device_key, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    usage_date
  );

alter table public.streaming_usage enable row level security;

create policy "streaming_usage: read own" on public.streaming_usage
  for select using (auth.uid() = user_id);

-- Free/premium daily limits — tune to your product's real numbers.
-- Enforced server-side in app/api/streaming/check-*-limit routes.
-- FREE_STREAM_LIMIT = 10, PREMIUM_STREAM_LIMIT = unlimited (-1)
-- FREE_CAST_LIMIT   = 5,  PREMIUM_CAST_LIMIT   = unlimited (-1)

-- ---------------------------------------------------------------
-- video_info_cache: cache for api/video/fetch-video-info lookups
-- ---------------------------------------------------------------
create table if not exists public.video_info_cache (
  url_hash text primary key,
  url text not null,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.video_info_cache enable row level security;
-- No client policies: only the service-role API route reads/writes this table.

