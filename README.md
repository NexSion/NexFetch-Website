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
- **Pages**: landing, `/login`, `/register`, dashboard (plan + today's
  usage + counts), account, linked devices (with unlink), `/videos`
  (saved list, with remove).
- **`/video/stream/[id]`** — the actual vidow.io-style player/download
  UI, not a bare `<video>` tag: thumbnail + play-button overlay,
  duration/quality/size/format chips, "Open source" link, speed
  control (1x/2x/3x), Auto-start and Auto-save toggles (per-viewer,
  `localStorage`), an editable filename field, a Start Download button
  with a live progress bar, and real `.m3u8`/`.mpd` playback via
  `hls.js` — a plain `<video src="…m3u8">` silently fails in Chrome,
  which is exactly the "Playback failed" you hit before this pass.
  `/video/cast/[id]` got the same `hls.js` fix, kept lighter since it's
  just the cast source, not a download UI.
- **`lib/hlsDownload.ts`** — a from-scratch `.m3u8` parser + segment
  fetcher/concatenator for the actual "Start Download" button on HLS
  sources. Read the limitations comment at the top of that file before
  relying on it — short version below.
- **`/installed`, `/uninstalled`, `/disabled`, `/contact`, `/help`,
  `/pricing`, `/review`, `/changelog`** — every route the extension's
  own `popup.js`/`options.js`/`service_worker.js` actually redirects
  to (found via `core.js`'s `ss()` URL builder and the `Ot`/`x` route
  table it uses — route names like `register`, `videos`,
  `privacy-policy`, `terms-of-service` come directly from there, not
  guessed). `/installed` reads the `dkey` query param the extension
  appends on first install and calls `/api/device/claim` immediately
  if you're already logged in, or hands the key through `/login` →
  `/register` → the email-confirm link so it still gets claimed the
  moment your session exists.
- **Database**: full schema + Row Level Security in `supabase/schema.sql`.

## What's intentionally NOT done (be honest about this)

- No payment/billing provider — the brief said not to invent one.
  `profiles.is_premium` is a plain boolean you can flip manually or wire
  up to Stripe/Lemon Squeezy later.
- `fetch-video-info` is a basic scraper, not a full extractor for every
  video platform.
- **HLS downloads are segment-concatenation, not an ffmpeg-grade
  remux.** For fMP4/CMAF sources (an `EXT-X-MAP` init segment present)
  the result is a genuinely valid fragmented MP4. For legacy
  `.ts`-segmented HLS, the result is a valid MPEG-TS file — plays fine
  in VLC/mpv, isn't repackaged into `.mp4`. AES-128/SAMPLE-AES
  encrypted streams are detected and rejected outright rather than
  half-supported.
- **HLS download requires the source to allow cross-origin fetches
  from a browser page.** The extension's background script can bypass
  CORS via its host permissions; this page-side downloader cannot —
  that's *why* the extension exists for this part of vidow.io's
  feature set. Expect some sources to fail with a CORS error here even
  though the extension's own native flow (once you build that path out
  further) could reach them.
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
  login/ register/             auth
  dashboard/ account/ videos/  authenticated pages
  video/stream/[id]/           stream player (talks to bridge.js)
  video/cast/[id]/             cast source page
  installed/ uninstalled/      extension-triggered redirect pages
  disabled/ contact/ help/
  pricing/ review/ changelog/
  privacy-policy/              legal pages (path names match core.js's
  terms-of-service/            route table exactly)
  api/                         the 7 contract endpoints
lib/
  supabase/                    browser + server (SSR cookie) clients
  bridge.ts                    BroadcastChannel protocol client
  limits.ts                    free/premium quota numbers
supabase/schema.sql            full DB schema + RLS
.gitignore                     node_modules/.next/.env* excluded
```

## A note on how the routes were chosen

The first pass of this site guessed route names (`/signup`, `/saved`,
`/privacy`) instead of checking what the extension actually redirects
to — that caused the `/installed` 404 you hit after reinstalling. Every
route name above was re-derived from `core.js`'s `ss()` URL-builder and
the frozen route-name objects (`Ot` in background code, `x`/`E`/`D` in
popup/options) by grepping the actual calls, not by pattern-matching
the brief's wording. If NexFetch-Chrome ever adds a new redirect target
in a future version, grep `assets/js/popup.js` and `options.js` for new
`A(...)`/`fe(...)` calls against those route-name objects before adding
a matching page here.
