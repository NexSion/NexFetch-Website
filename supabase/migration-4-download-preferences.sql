-- Run after migration-3-admin-and-limits.sql.
-- Auto-download/auto-save are now account-level preferences (set once,
-- apply on every device/session) instead of per-browser localStorage.
alter table public.profiles
  add column if not exists auto_download boolean not null default false,
  add column if not exists auto_save boolean not null default true;

-- No new RLS policy needed — "profiles: update own" (from schema.sql)
-- already lets a logged-in user update their own row, which covers
-- these two columns too.
