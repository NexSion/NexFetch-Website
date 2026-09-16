# NexFetch Website — Architecture & Planning Document
*Derived from inspecting `nexerisltd/NexFetch-Chrome` (manifest v4.0.0). Bismillah.*

---

## 0. What the extension already expects from us

This isn't a greenfield design — the extension has a **live contract baked into its compiled JS** that the website must honor:

| Contract piece | Detail found in code |
|---|---|
| Base URL | `https://nexfetch.vercel.app/` |
| Device identity | `device_key` generated client-side, stored in `chrome.storage.local`, sent as `dkey` query param when opening web pages |
| Claim endpoint | `POST /api/device/claim { device_key }` — links device to logged-in account |
| Video info resolver | `GET /api/video/fetch-video-info?url=...` — server resolves a raw media URL into structured info (title/qualities/thumbnail) |
| Save video | `POST /api/videos` (FormData: link, thumbnail, id/hash…) — used to create a "stream/cast" entry |
| Report broken link | `POST /api/reports { type, url, device_key, metadata }` |
| HD download limit check | `POST /api/streaming/check-limit { device_key }` |
| Cast limit check | `POST /api/streaming/check-cast-limit { device_key }` |
| Player pages | `/video/stream/:id` and `/video/cast/:id` — the ONLY two routes the extension's `bridge.js` content script activates on |
| Extension↔page channel | `BroadcastChannel('channel-' + tabId)` — page posts `{id, cmd, data}`, extension replies `{id, data}`; extension will only honor `GET_TAB_ID`, `SET_RULES`, `REMOVE_RULES`, `GET_HLS_VIDEO_DATA`, and a forwarded whitelist (`downloads:start`, `downloads:settings`, `downloads:hls-blob`, `savedVideos:get/add/remove`) |

**Conclusion:** we are not free to invent arbitrary routes/params for the extension-facing surface — `/video/stream/[id]`, `/video/cast/[id]`, and the `api/*` paths above must exist with matching request/response shapes, or the existing (and any future) extension builds break. Everything else (marketing, dashboard, auth pages) is ours to design.

---

## 1. Project Architecture

```
                        ┌─────────────────────────────┐
                        │   NexFetch-Chrome extension  │
                        │  (content script + SW,       │
                        │   device_key in local store)  │
                        └───────────┬───────────────────┘
                                    │ opens tabs w/ ?dkey=
                                    │ BroadcastChannel bridge (stream/cast pages only)
                                    ▼
┌───────────────────────────────────────────────────────────────────┐
│                    NexFetch-Website (Next.js, Vercel)              │
│                                                                     │
│  Public/marketing   Auth (Supabase)   Dashboard   Player pages     │
│  /                  /login /signup    /account    /video/stream/id │
│  /pricing           /reset-password   /library    /video/cast/id   │
│  /blog  /help                          /devices    (hls.js)        │
│                                                                     │
│  API routes (/app/api/*)                                           │
│   /api/device/claim        /api/videos            /api/reports     │
│   /api/video/fetch-video-info                                      │
│   /api/streaming/check-limit   /api/streaming/check-cast-limit     │
│   /api/webhooks/stripe (billing)                                   │
└───────────────────────┬─────────────────────────────────┬─────────┘
                         │                                 │
                         ▼                                 ▼
                 ┌───────────────┐                 ┌───────────────────┐
                 │   Supabase     │                 │  Cloudflare        │
                 │  Postgres +    │                 │  (optional CDN /   │
                 │  Auth + Storage│                 │  Workers for       │
                 │  (RLS-enforced)│                 │  bandwidth-heavy   │
                 └───────────────┘                 │  segment proxy /   │
                                                     │  R2 thumbnail CDN) │
                                                     └───────────────────┘
```

**Key architectural decisions**

1. **Next.js App Router**, deployed on Vercel. API routes live as Route Handlers (`app/api/**/route.ts`) — free tier friendly, no separate backend service needed initially.
2. **Supabase** is both the database *and* the auth provider. We use Supabase Auth (email/password + optional Google OAuth) rather than rolling our own, and Postgres Row Level Security (RLS) as the primary authorization layer — not just app-level checks.
3. **Device-key identity is separate from account identity.** A `devices` table maps `device_key → user_id (nullable)`. Anonymous/free usage is tracked by device_key alone; once claimed, it's tied to a user. This mirrors what the extension already assumes — we're not changing that model, just giving it a real backend.
4. **Stream/cast entries are ephemeral, not permanent library items** unless the user is Premium and explicitly saves them. A `videos` table row is created by `POST /api/videos` when the user hits "Cast"/"Play in browser" from the popup; short TTL for free tier (matches the extension's own `dataExpiry.free = 1hr / empty = 5min` constants found in its code), indefinite for Premium "Saved".
5. **No server-side video proxying/re-hosting by default.** The website does not download and store users' videos — it stores *metadata* (source URL, title, thumbnail, quality list) and plays/downloads client-side via hls.js, exactly like the extension does. This keeps us bandwidth-cheap and avoids copyright/hosting liability. Cloudflare is only needed if we later add thumbnail caching or a segment-proxy for CORS-blocked sources.
6. **Billing**: Stripe (or Lemon Squeezy/Paddle for merchant-of-record simplicity — your call) drives the `premium` flag on the user's row; a webhook is the single source of truth, never trust client-reported plan state.
7. **Rate limiting / abuse prevention** happens in the API route layer using device_key + IP heuristics, backed by a `usage_counters` table (see §4) rather than in-memory counters, so it survives serverless cold starts.

---

## 2. User Flow

**A. First-time free user (extension only, no account)**
1. Installs extension → SW generates `device_key`, stores locally.
2. Browses a site with video → popup shows detected media.
3. Clicks Download → local download via `chrome.downloads`, no website involved (small/SD files may not even hit the backend — only HD/limit-gated actions call `check-limit`).
4. Clicks Cast → extension calls `POST /api/videos` to register the video, opens `nexfetch.vercel.app/video/cast/:id?dkey=...` in a new tab.
5. Website page loads, `bridge.js` activates, page calls `GET_HLS_VIDEO_DATA`/`GET_TAB_ID` over the BroadcastChannel to hydrate itself, then plays via hls.js and offers a real Chromecast (Cast API) button.
6. Hits daily cast limit → `check-cast-limit` returns `allowed:false` → popup shows upgrade modal (this logic already exists client-side in the extension; website just needs to answer correctly).

**B. Free user upgrading to Premium**
1. Clicks "Upgrade" in popup → opens `nexfetch.vercel.app/pricing?dkey=...&utm_content=...`.
2. If not logged in, redirected through `/login` → `/signup`, Supabase Auth session created.
3. Website reads `dkey` from the URL (already present from step 1) → immediately calls `/api/device/claim` for the now-authenticated session, linking device to account *before* checkout (so limit-checks are correctly account-scoped for the duration of checkout).
4. Completes Stripe Checkout → webhook flips `profiles.plan = 'premium'`.
5. Next `auth:syncRemoteStatus` call from the extension picks up the new plan.

**C. Returning Premium user, cross-device**
1. Installs extension on a second machine → new `device_key`.
2. Opens `/account` (logged in) → sees "Devices" list, can claim the new device manually (`dkey` param flow, same endpoint) or the site auto-claims if it detects the extension is present and unclaimed.
3. "Saved" videos and settings tied to the *account* (not the device) sync down — this is new: the extension currently only has local `saved_videos`; per your brief this website+backend introduces true cross-device sync as a Premium feature.

**D. Anonymous visitor (no extension) browsing marketing site**
1. Lands on `/`, `/pricing`, `/blog`, `/download` (Chrome Web Store link) — pure marketing, no auth required, statically generated where possible.

---

## 3. Route Map

### Public / marketing (SSG/ISR where possible)
- `/` — landing page
- `/pricing`
- `/download` — CWS link + "why install"
- `/blog`, `/blog/[slug]`
- `/help`, `/help/[article]`
- `/privacy`, `/terms` (required — extension requests `<all_urls>` host permission, so a clear privacy policy is both good practice and a Chrome Web Store review requirement)

### Auth
- `/login`
- `/signup`
- `/reset-password`
- `/auth/callback` (Supabase OAuth/email-link callback)

### Extension-facing player pages *(contract — must not break URL shape)*
- `/video/stream/[id]`
- `/video/cast/[id]`

### Account / dashboard (auth required)
- `/account` — profile, plan, billing portal link
- `/account/devices` — linked devices, unlink/rename
- `/library` — saved videos (Premium)
- `/library/watch-later`
- `/account/usage` — today's download/cast counts vs. limits (transparency, reduces support load)

### API routes
- `POST /api/device/claim`
- `GET /api/video/fetch-video-info`
- `POST /api/videos`
- `GET /api/videos/[id]` (used by stream/cast pages to hydrate)
- `POST /api/reports`
- `POST /api/streaming/check-limit`
- `POST /api/streaming/check-cast-limit`
- `POST /api/webhooks/stripe`
- `GET /api/account/usage`
- `POST /api/account/devices/[id]/unlink`

---

## 4. Database / Data Model Plan (Supabase / Postgres)

```sql
-- Supabase auth.users is the source of truth for identity; we extend via profiles.
profiles
  id            uuid PK references auth.users(id)
  plan          text default 'free'   -- 'free' | 'premium'
  stripe_customer_id text
  created_at    timestamptz default now()

devices
  device_key    text PK
  user_id       uuid references profiles(id) null   -- null until claimed
  claimed_at    timestamptz null
  last_seen_at  timestamptz default now()
  user_agent    text
  created_at    timestamptz default now()

videos
  id            uuid PK default gen_random_uuid()
  device_key    text references devices(device_key)
  user_id       uuid references profiles(id) null
  source_url    text not null
  title         text
  thumbnail_url text
  qualities     jsonb           -- [{label, url, bandwidth}, ...]
  webpage_url   text
  kind          text            -- 'hls' | 'dash' | 'direct'
  is_saved      boolean default false   -- true = Premium "Watch Later/Library" entry
  expires_at    timestamptz     -- null if is_saved=true; else now()+1h (free) matching extension's own TTL logic
  created_at    timestamptz default now()

usage_counters
  device_key    text references devices(device_key)
  day           date
  downloads_hd  int default 0
  casts         int default 0
  saves         int default 0
  primary key (device_key, day)

reports
  id            uuid PK default gen_random_uuid()
  device_key    text
  type          text
  url           text
  metadata      jsonb
  created_at    timestamptz default now()
```

**RLS approach:** `videos`, `devices`, `usage_counters` are only readable/writable via service-role in API routes (never directly from the browser client) except `library`/`account` pages, which query as the authenticated user with RLS `user_id = auth.uid()`. This keeps the device-key-based free-tier logic server-controlled and unspoofable from the client.

**Cleanup:** a scheduled job (Supabase cron / Vercel cron) purges expired, unsaved `videos` rows and rolls `usage_counters` older than ~90 days into nothing (they're daily counters, not needed long-term) — keeps the free-tier Supabase DB small.

---

## 5. Extension ↔ Website/API Communication Plan

Two channels, already defined by the extension — we implement the website side of both:

1. **HTTP API** (`fetch` from the service worker) — device-key-authenticated, stateless, used for claim/report/limit-check/video-create. Every request includes `device_key`; the server resolves it to a device row (creating one on first sight) and, if claimed, its associated user.
2. **BroadcastChannel bridge** (only on `/video/stream/*` and `/video/cast/*`) — page-to-extension, same-tab only, used to pull live HLS data and forward download/save commands back into the extension rather than duplicating that logic server-side. Our Next.js pages need a small client module replicating the `postMessage({id, cmd, data})` / listen-for-reply pattern already present in `bridge.js`, matching the exact command names (`GET_TAB_ID`, `GET_HLS_VIDEO_DATA`, `EXT_SEND` wrapping `downloads:*`/`savedVideos:*`).

**Versioning safety:** since we don't control when users update the extension, every API response includes a stable, additive JSON shape (`{success, data, error}` — matches what we already see the extension expect: `i.success`, `i.data`, `i.error?.message`). We never remove a field the current extension reads; we only add.

---

## 6. Security Plan

- **Device key is a capability token, not a secret identity** — treat it like a bearer token: rate-limit by it, never trust it alone for sensitive account actions (claiming requires an authenticated Supabase session server-side, not just knowledge of the key).
- **RLS on every table**; API routes use the Supabase service role only where device-key logic requires bypassing RLS, and even then scope queries tightly (never `select *` without a `device_key`/`user_id` filter).
- **Rate limiting** on `/api/videos`, `/api/reports`, `/api/device/claim` by IP + device_key (e.g. Upstash Redis or Vercel's built-in rate limiting) to stop scripted abuse of the "create video entry" endpoint, which is the main abuse surface (someone could try to mass-create rows or probe `fetch-video-info` as a free URL-metadata proxy).
- **`/api/video/fetch-video-info` is an SSRF risk** — it fetches an arbitrary user-supplied URL server-side. Must: restrict to http/https, block internal/private IP ranges (169.254.x, 10.x, 172.16-31.x, 192.168.x, localhost, link-local, cloud metadata IP `169.254.169.254`), set strict timeouts, cap response size, and never follow redirects into blocked ranges.
- **CORS**: API routes callable from the extension (background service worker → no page origin restrictions apply there) but the browser-based stream/cast pages should keep default same-origin; don't open `Access-Control-Allow-Origin: *` on account-sensitive endpoints.
- **Stripe webhook signature verification** — never trust an unauthenticated POST to flip someone to premium.
- **Content Security Policy** on the Next.js site (important since `/video/stream|cast` pages run a media player and talk to a BroadcastChannel — keep script-src tight, no inline scripts).
- **Abuse of the claim flow**: claiming should require a valid, freshly-issued `dkey` (short expiry, or at minimum only accepted while there's an authenticated session actively performing the claim) so a leaked device_key from one user can't be silently claimed by an attacker's account to poison someone else's usage counters — though note this key is generated locally and only meaningful for rate-limiting, not for accessing private data, which limits real damage.
- **Privacy policy is not optional**: the extension has `host_permissions: <all_urls>` and `webRequest`; Chrome Web Store review and general trust require a clear, accurate privacy policy page describing exactly what's collected (device_key, reported URLs, video metadata) and what is *not* (we are not storing downloaded video content).

---

## 7. Complete Prioritized Task List

**Phase 0 — Foundation**
1. Scaffold Next.js (App Router, TypeScript) project in `NexFetch-Website/`
2. Wire up Supabase project (you'll create it — see step-by-step below) + env vars + `@supabase/ssr` client setup
3. Base layout, design tokens, marketing shell (`/`, `/pricing` placeholder)

**Phase 1 — Auth & Identity**
4. Supabase Auth: `/login`, `/signup`, `/reset-password`, `/auth/callback`
5. `profiles` table + auto-create-on-signup trigger
6. `devices` table + `POST /api/device/claim`

**Phase 2 — Core extension-facing contract**
7. `videos` table + `POST /api/videos` + `GET /api/videos/[id]`
8. `/video/stream/[id]` page with hls.js playback
9. `/video/cast/[id]` page + Chromecast (Cast API) integration
10. BroadcastChannel bridge client module matching `bridge.js` protocol
11. `GET /api/video/fetch-video-info` (with SSRF hardening)
12. `POST /api/reports`

**Phase 3 — Limits & Billing**
13. `usage_counters` table + `POST /api/streaming/check-limit` + `check-cast-limit`
14. Stripe integration (checkout + `/api/webhooks/stripe` + `profiles.plan` sync)
15. `/pricing` real page wired to checkout

**Phase 4 — Account dashboard**
16. `/account` (profile, plan, manage billing)
17. `/account/devices` (list/unlink)
18. `/library` + `/library/watch-later` (Premium saved videos)
19. `/account/usage`

**Phase 5 — Hardening & polish**
20. Rate limiting on abuse-prone endpoints
21. Scheduled cleanup job (expired videos, stale usage rows)
22. Privacy policy / Terms pages (content-accurate to actual data collection)
23. Marketing content: `/blog`, `/help`
24. Cloudflare layer only if/when bandwidth needs justify it (thumbnail CDN via R2, or segment proxy for CORS-restricted sources)

---

### External setup you'll need to do (I'll give exact steps when we reach each one)
- Create the Supabase project, grab URL + anon key + service role key
- Create the GitHub repo `nexerisltd/NexFetch-Website` and push
- Connect repo to Vercel, set env vars
- Stripe (or chosen billing provider) account + product/price setup, webhook secret
- Cloudflare — deferred until actually needed

---

**Awaiting your review/approval before starting Phase 0, Task 1.**
