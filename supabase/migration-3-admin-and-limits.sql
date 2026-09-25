-- Run in Supabase SQL Editor after supabase/schema.sql.
-- Adds: admin role on profiles, byte-usage tracking on streaming_usage
-- (for the 10GB/day free-plan data cap), and enables Google as the
-- only auth provider (that last part is a Dashboard setting, not SQL
-- — see the note at the bottom of this file).

alter table public.profiles
  add column if not exists role text not null default 'user' check (role in ('user', 'admin'));

alter table public.streaming_usage
  add column if not exists bytes bigint not null default 0;

-- Promote your own account to admin once you know your user id
-- (Supabase Dashboard -> Authentication -> Users -> copy the UUID):
--   update public.profiles set role = 'admin' where id = '<your-user-uuid>';

-- ---------------------------------------------------------------
-- Auth provider change (do this in the Supabase Dashboard, not SQL):
--   Authentication -> Providers -> Email: turn OFF (disables
--     password sign-up/sign-in entirely, matching the site no longer
--     exposing an email/password form).
--   Authentication -> Providers -> Google: turn ON, and fill in the
--     OAuth Client ID/Secret from Google Cloud Console. Add
--     https://<your-domain>/auth/callback as an authorized redirect
--     URI on the Google OAuth client, and add the same URL under
--     Authentication -> URL Configuration -> Redirect URLs here too.
-- ---------------------------------------------------------------
