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
- **`GET/POST/DELETE /api/videos`** — Watch Later sync. **Body shapes
  were corrected against `popup.js`'s actual `un()`/`tn()`/`on()`
  functions**, not guessed: POST takes a flat `{ hash, title?, link?,
  thumbnail? }` (not `{ video: {...} }`), and an unauthenticated
  request returns HTTP 403 with `{ error: { code: "LOGIN_REQUIRED" } }`
  rather than a bare 401 — popup.js's own HTTP client throws away the
  response body on a true 401, so that's the only way its "please log
  in" messaging actually fires.
- **`GET /api/video/fetch-video-info`** — page-title/og:video scrape +
  1‑hour cache. **Not** a full yt-dlp-style extractor — see the comment
  in that file for what real production hardening still needs.
- **`POST /api/reports`** — body is `{ type, url?, device_key?,
  metadata? }` (corrected from an earlier `{ reason, details }` guess —
  popup.js's `Go()` sends `type` and an arbitrary `metadata` object,
  and expects `{ success, data }`, not just `{ success }`).
- **`POST /api/streaming/check-limit`** / **`check-cast-limit`** — the
  two routes directly responsible for the "HD limit check failed" /
  "Unable to start the secure download" errors you hit. Two real bugs,
  found by reading `popup.js`'s `$e()`/`Mo()` functions line by line
  instead of assuming: (1) the payload must be nested under `data` —
  popup.js does `if (!t.success || !t.data) throw ...`, so a flat
  `{success, allowed, remaining, limit}` response makes that check
  fail every time; (2) **this must never require a login cookie** —
  popup.js calls it with only a `device_key`, and an unclaimed device
  is a completely normal free-tier caller, not an auth failure. Now
  resolves premium status via device_key → devices.user_id →
  profiles.is_premium when there's no cookie session, and always
  responds `{ success, data: { allowed, remaining, limit, reset_at,
  reason, ... } }`. Free/premium numbers in `lib/limits.ts` are still
  placeholders — set them to NexFetch's real numbers.
- **Pages**: landing, `/login`, `/register`, dashboard (plan + today's
  usage + counts), account, linked devices (with unlink), `/videos`
  (saved list, with remove).
- **`/video/stream`, `/video/cast`, `/video/download`** — **corrected
  from dynamic `[id]` routes to flat routes reading a `?data=<base64>`
  param**, after finding `popup.js`'s `ue()`/`hn()`/`ko()`/`xo()`
  functions: the extension doesn't ask this site to look a video up by
  id at all — it base64-encodes the whole payload (url, title,
  thumbnail, duration, quality, size, audio_url, stream_type) directly
  into the link it opens. `id`/`tid`/`dkey` ride along only so the page
  can talk back to the extension over the `BroadcastChannel` bridge for
  the download step. This also fixes the actual vidow.io-style
  player/download UI: thumbnail + play-button overlay,
  duration/quality/size/format chips, "Open source" link, speed control
  (1x/2x/3x), Auto-start/Auto-save toggles (per-viewer `localStorage`),
  an editable filename field, a Start Download button with a live
  progress bar, and real `.m3u8` playback via `hls.js` — a plain
  `<video src="…m3u8">` silently fails in Chrome, which is exactly the
  "Playback failed" from the first pass. `/video/download` is the
  "last resort" server-fetch fallback (`xo()`'s path) for pages where
  the extension couldn't detect a direct video URL at all.
- **`lib/hlsDownload.ts`** — a from-scratch `.m3u8` parser + segment
  fetcher/concatenator for the "Start Download" button on HLS sources.
  Read the limitations comment at the top of that file before relying
  on it — short version below.
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
- **Database**: full schema + Row Level Security in `supabase/schema.sql`
  — this pass fixed a real syntax error (`UNIQUE(coalesce(...))` isn't
  valid SQL — a table constraint can't call a function; needed a unique
  *index* instead) and verified the whole file end-to-end against a
  real local Postgres 16 instance before handing it back, not just
  read-through. That syntax error meant the script could never
  actually finish for anyone before now — Supabase runs it as one
  transaction, so the failure silently rolled back every table before
  it too. If it failed for you with that error, your database has
  nothing in it yet; just run the corrected file fresh (skip
  `migration-2-fix-contract.sql` — it has nothing to migrate from).

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
  video/stream/                stream player (?data=<base64>, talks to bridge.js)
  video/cast/                  cast source page (?data=<base64>)
  video/download/              "last resort" server-fetch fallback
  installed/ uninstalled/      extension-triggered redirect pages
  disabled/ contact/ help/
  pricing/ review/ changelog/
  privacy-policy/              legal pages (path names match core.js's
  terms-of-service/            route table exactly)
  api/                         the 7 contract endpoints
lib/
  supabase/                    browser + server (SSR cookie) clients
  bridge.ts                    BroadcastChannel protocol client (download step only)
  dataParam.ts                 decodes the ?data=<base64> the extension builds
  hlsDownload.ts                m3u8 parser + segment downloader
  limits.ts                    free/premium quota numbers
supabase/schema.sql              full DB schema + RLS
supabase/migration-2-fix-contract.sql   run only if you already had the old schema
.gitignore                     node_modules/.next/.env* excluded
```

## A note on how this contract was actually figured out

Two passes of guessing happened before this got right, and both are worth
naming so future-you doesn't repeat them:

1. **Route names.** The first pass guessed `/signup`, `/saved`,
   `/privacy` instead of checking what the extension redirects to —
   that caused the `/installed` 404. Fixed by grepping `core.js`'s
   `ss()` URL-builder and the frozen route-name objects (`Ot` in
   background code, `x`/`E`/`D` in popup/options) for the actual calls.
2. **Request/response shapes.** The second pass assumed `/video/stream`
   was a dynamic `[id]` lookup route and that `check-limit`/`videos`/
   `reports` used the shapes that seemed reasonable — both wrong.
   `popup.js` turned out to already contain a complete, load-bearing
   description of the contract (its own fetch calls, body shapes, and
   the exact `if (!t.success || !t.data) throw` checks it runs on every
   response) — reading that file's actual `$e()`, `Mo()`, `un()`,
   `tn()`, `on()`, `hn()`, `ue()`, `ko()`, `xo()`, `Go()` functions
   directly is what surfaced the real shapes, not inference from the
   background script alone.

If NexFetch-Chrome adds a new endpoint or redirect target in a future
version, grep `assets/js/popup.js` and `options.js` for the new
`Q.post(...)`/`A(...)` calls and read the surrounding function rather
than assuming a shape — that's the mistake this pass corrected twice.
