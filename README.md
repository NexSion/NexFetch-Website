# NexFetch-Website

Next.js + Supabase backend/website for the NexFetch-Chrome extension.
Built against the real API contract found in `background/service_worker.js`
and `content_scripts/bridge.js` in nexerisltd/NexFetch-Chrome — not a
redesign of it.

## What's actually implemented (builds clean, zero TS errors)

- **Auth**: Supabase email/password, cookie-based session (`@supabase/ssr`)
  so the extension's `credentials: "include"` fetches from your browser
  work automatically once you're logged in on the site.
- **`POST /api/device/claim`** — links an extension's `device_key` to your account.
- **`GET /api/user`** — returns `{ success, data: { is_premium } }`.
- **`GET/POST/DELETE /api/videos`** — Watch Later sync (DELETE is an
  addition for the dashboard's remove button, not part of the discovered
  contract but additive/non-breaking).
- **`GET /api/video/fetch-video-info`** — page-title/og:video scrape +
  1‑hour cache. **Not** a full yt-dlp-style extractor — see the comment
  in that file for what real production hardening still needs.
- **`POST /api/reports`**, **`POST /api/streaming/check-limit`**,
  **`POST /api/streaming/check-cast-limit`** — quota enforcement backed
  by a `streaming_usage` table, free/premium numbers in `lib/limits.ts`
  are placeholders — set them to NexFetch's real numbers.
- **Pages**: landing, login/signup, dashboard (plan + today's usage +
  counts), account, linked devices (with unlink), saved videos (with
  remove), `/video/stream/[id]` and `/video/cast/[id]` — these actually
  speak the `BroadcastChannel` bridge protocol from `bridge.js`
  (`lib/bridge.ts`), not just a static `<video>` tag.
- **Database**: full schema + Row Level Security in `supabase/schema.sql`.

## What's intentionally NOT done (be honest about this)

- No payment/billing provider — the brief said not to invent one.
  `profiles.is_premium` is a plain boolean you can flip manually or wire
  up to Stripe/Lemon Squeezy later.
- `fetch-video-info` is a basic scraper, not a full extractor for every
  video platform.
- No automated tests.
- Not deployed anywhere yet — see setup steps below.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the Supabase project

Go to [supabase.com](https://supabase.com) → New project. Once it's up:

- **SQL Editor → New query** → paste the entire contents of
  `supabase/schema.sql` → Run.
- **Project Settings → API** → copy:
  - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
  - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only, never
    expose this to the client)
- **Authentication → URL Configuration**:
  - Site URL: `https://nexfetch.vercel.app` (or your actual domain)
  - Redirect URLs: add `https://nexfetch.vercel.app/auth/callback` and,
    for local dev, `http://localhost:3000/auth/callback`
- **Authentication → Providers → Email**: leave "Confirm email" on for
  production; turn it off temporarily if you want to test signup
  without an inbox.

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in the three Supabase
values above, plus:

```
NEXT_PUBLIC_SITE_URL=http://localhost:3000   # or your prod URL
```

### 4. Run locally

```bash
npm run dev
```

### 5. Deploy to Vercel

- Push this folder to its own GitHub repo (`NexFetch-Website`).
- Import it in Vercel, add the same four env vars in
  **Project Settings → Environment Variables**.
- Set the production domain to `nexfetch.vercel.app` (matches the
  extension's `manifest.json` `content_scripts` matches and the
  `host_permissions`) — if you use a different domain, update
  `manifest.json` in NexFetch-Chrome to match, or the injected
  `bridge.js` won't run on your site.

### 6. Cloudflare (optional, per the brief's "only where it helps")

Not required for the API/auth flows above, since Vercel already serves
those cheaply. Only reach for Cloudflare if you start proxying large
media files through your own domain (e.g. a future signed-URL
downloader) — point a CNAME at Vercel and put media-heavy routes behind
a Cloudflare cache rule at that point, not before.

## Project structure

```
app/
  page.tsx                     landing
  login/ signup/               auth
  dashboard/ account/ saved/   authenticated pages
  video/stream/[id]/           stream player (talks to bridge.js)
  video/cast/[id]/             cast source page
  api/                         the 7 contract endpoints
lib/
  supabase/                    browser + server (SSR cookie) clients
  bridge.ts                    BroadcastChannel protocol client
  limits.ts                    free/premium quota numbers
supabase/schema.sql            full DB schema + RLS
```
