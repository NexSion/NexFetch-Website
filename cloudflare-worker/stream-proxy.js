// Cloudflare Worker — stream proxy + HLS download assembler for NexFetch.
//
// Two jobs, both here because both need the same "fetch upstream with a
// spoofed Referer" capability that only a server (not a browser) has:
//
// 1. GET /?url=<target>&ref=<referer-origin>
//    Playback proxy. Used only when a source's Referer-based hotlink
//    protection blocks direct browser requests (most sources don't need
//    it — see lib/streamProxy.ts's direct-first probe on the website).
//    Rewrites m3u8 playlists so every URI inside (segments, variant
//    playlists, EXT-X-KEY/EXT-X-MAP) routes back through this same
//    worker; hls.js only ever needs the top-level playlist URL.
//
// 2. GET /download?playlist=<url>&ref=<referer>&name=<filename>&height=<n>
//    Full-file HLS download. Fetches every segment *from the Worker*
//    (fast Cloudflare-internal network, not the user's browser),
//    decrypts AES-128 segments as it goes (SubtleCrypto, same as
//    playback), and streams the concatenated result back as one
//    ordinary HTTP download (Content-Disposition: attachment) —
//    something the browser or the extension's chrome.downloads API
//    can just save directly. No giant Blob ever sits in the webpage's
//    memory, and no cross-context messaging is needed, so this also
//    sidesteps the page-idle "BRIDGE_TIMEOUT" failure the old
//    client-side blob-then-postMessage approach hit.
//
//    Memory stays bounded (a few segments' worth) via a small ordered
//    fetch pipeline (concurrency N, emitted strictly in sequence) —
//    important since Workers have limited per-request memory and a
//    multi-GB video can never be buffered whole.
//
// Only AES-128 (the standard, non-DRM HLS content-key scheme) is
// decrypted. Real DRM (SAMPLE-AES / SAMPLE-AES-CENC — Widevine,
// FairPlay, PlayReady) is rejected on purpose: there's no client-side
// or server-side bypass for a licensed key exchange.
//
// Deploy: `wrangler deploy` from this folder, or paste into a new
// Worker in the Cloudflare dashboard. Then set
// NEXT_PUBLIC_STREAM_PROXY_BASE in the website's Vercel env vars to
// this Worker's URL.

// ---------- shared m3u8 helpers ----------

function resolveUri(base, ref) {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

function isM3u8Text(text) {
  return text.trimStart().startsWith("#EXTM3U");
}

function isMasterPlaylist(text) {
  return text.includes("#EXT-X-STREAM-INF");
}

function parseMasterPlaylist(text, baseUrl) {
  const lines = text.split("\n").map((l) => l.trim());
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0);
    const resolution = /RESOLUTION=\d+x(\d+)/.exec(line)?.[1];
    const next = lines[i + 1];
    if (next && !next.startsWith("#")) {
      variants.push({
        uri: resolveUri(baseUrl, next),
        bandwidth,
        height: resolution ? Number(resolution) : undefined
      });
    }
  }
  return variants;
}

// Full segment-level parse (used by the download assembler): tracks
// EXT-X-KEY state and media-sequence numbers per segment, needed for
// AES-128 IV derivation.
function parseMediaPlaylist(text, baseUrl) {
  const lines = text.split("\n").map((l) => l.trim());
  const segments = [];
  let mapUri = null;
  let currentKey = null;
  let sequence = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE")) {
      const n = Number(line.split(":")[1]);
      if (!Number.isNaN(n)) sequence = n;
      continue;
    }

    if (line.startsWith("#EXT-X-KEY")) {
      const method = /METHOD=([^,]+)/.exec(line)?.[1] ?? "NONE";
      if (method === "NONE") {
        currentKey = null;
      } else {
        const uri = /URI="([^"]+)"/.exec(line)?.[1];
        const iv = /IV=0[xX]([0-9a-fA-F]+)/.exec(line)?.[1] ?? null;
        currentKey = { method, keyUri: uri ? resolveUri(baseUrl, uri) : "", ivHex: iv };
      }
      continue;
    }

    if (line.startsWith("#EXT-X-MAP")) {
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      if (uri) mapUri = resolveUri(baseUrl, uri);
      continue;
    }

    if (line.startsWith("#EXTINF")) {
      const next = lines[i + 1];
      if (next && !next.startsWith("#")) {
        segments.push({ uri: resolveUri(baseUrl, next), sequence, key: currentKey });
        sequence++;
        i++;
      }
      continue;
    }
  }

  return { segments, mapUri };
}

function hexToBytes(hex) {
  const clean = hex.length % 2 ? "0" + hex : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Per HLS spec (RFC 8216 §5.2): if EXT-X-KEY has no IV attribute, the
// segment's media-sequence number is the IV — a 128-bit big-endian int.
function sequenceToIv(sequence) {
  const iv = new Uint8Array(16);
  let n = sequence;
  for (let i = 15; i >= 0 && n > 0; i--) {
    iv[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return iv;
}

function buildUpstreamHeaders(request, ref, range) {
  const headers = { "User-Agent": request.headers.get("user-agent") || "Mozilla/5.0" };
  if (ref) {
    headers["Referer"] = ref;
    try {
      headers["Origin"] = new URL(ref).origin;
    } catch {
      /* ignore */
    }
  }
  if (range) headers["Range"] = range;
  return headers;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };
const CHUNK_CORS_HEADERS = {
  ...CORS_HEADERS,
  "Access-Control-Expose-Headers": "X-Total-Segments, X-Container, X-Range-Start, X-Range-Count"
};

// ---------- mode 1: playback proxy (single resource, playlist-rewriting) ----------

function buildProxiedUrl(workerOrigin, target, ref) {
  const params = new URLSearchParams({ url: target });
  if (ref) params.set("ref", ref);
  return `${workerOrigin}/?${params.toString()}`;
}

function rewritePlaylist(text, baseUrl, ref, workerOrigin) {
  return text
    .split("\n")
    .map((raw) => {
      const line = raw.trim();
      if (!line) return raw;
      if (line.startsWith("#EXT-X-KEY") || line.startsWith("#EXT-X-MAP")) {
        return line.replace(/URI="([^"]+)"/, (_m, uri) =>
          `URI="${buildProxiedUrl(workerOrigin, resolveUri(baseUrl, uri), ref)}"`
        );
      }
      if (line.startsWith("#")) return raw;
      return buildProxiedUrl(workerOrigin, resolveUri(baseUrl, line), ref);
    })
    .join("\n");
}

async function handlePlaybackProxy(request) {
  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url");
  const ref = requestUrl.searchParams.get("ref");
  const workerOrigin = requestUrl.origin;

  if (!target) return json({ error: "MISSING_URL" }, 400);
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: "INVALID_URL" }, 400);
  }
  if (parsed.protocol !== "https:") return json({ error: "INVALID_PROTOCOL" }, 400);

  let upstream;
  try {
    upstream = await fetch(target, { headers: buildUpstreamHeaders(request, ref, request.headers.get("range")) });
  } catch {
    return json({ error: "UPSTREAM_UNREACHABLE" }, 502);
  }
  if (!upstream.ok && upstream.status !== 206) {
    return json({ error: "UPSTREAM_FAILED", status: upstream.status }, upstream.status);
  }

  const contentType = upstream.headers.get("content-type") || "";
  const looksLikePlaylist = target.includes(".m3u8") || contentType.includes("mpegurl");

  if (looksLikePlaylist) {
    const text = await upstream.text();
    if (isM3u8Text(text)) {
      return new Response(rewritePlaylist(text, target, ref, workerOrigin), {
        headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store", ...CORS_HEADERS }
      });
    }
    return new Response(text, { headers: { "Content-Type": contentType || "text/plain", ...CORS_HEADERS } });
  }

  const headers = { "Content-Type": contentType || "application/octet-stream", "Cache-Control": "no-store", ...CORS_HEADERS };
  const contentLength = upstream.headers.get("content-length");
  const contentRange = upstream.headers.get("content-range");
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (contentLength) headers["Content-Length"] = contentLength;
  if (contentRange) headers["Content-Range"] = contentRange;
  if (acceptRanges) headers["Accept-Ranges"] = acceptRanges;

  return new Response(upstream.body, { status: upstream.status, headers });
}

// ---------- mode 2: full-file HLS download (ordered streaming assembler) ----------

// Fetches `items` with up to `concurrency` in flight, but enqueues
// their bytes into the returned stream strictly in order — so a later
// segment finishing before an earlier one never gets emitted out of
// sequence, while still overlapping network latency across segments.
//
// `footerBytes`, if given, is enqueued once every item has been
// emitted, right before the stream closes — used by /fetch-batch (see
// below) as an end-to-end completeness marker. It is NEVER passed for
// /download or /download-range, since those responses are the actual
// video bytes handed straight to the user/extension and must not be
// tampered with.
function createOrderedStream(items, fetchOne, footerBytes) {
  const concurrency = 6;
  let nextToEmit = 0;
  let nextToStart = 0;
  let cancelled = false;
  let failed = null;
  let footerSent = false;
  const inFlight = new Map();
  const completed = new Map();

  function startMore() {
    while (!cancelled && inFlight.size < concurrency && nextToStart < items.length) {
      const idx = nextToStart++;
      const p = fetchOne(items[idx])
        .then((buf) => {
          completed.set(idx, buf);
        })
        .catch((err) => {
          failed = err;
        })
        .finally(() => {
          inFlight.delete(idx);
        });
      inFlight.set(idx, p);
    }
  }

  return new ReadableStream({
    async pull(controller) {
      startMore();
      while (!failed && nextToEmit < items.length && !completed.has(nextToEmit)) {
        const pending = [...inFlight.values()];
        if (pending.length === 0) break; // shouldn't happen unless items.length === 0
        await Promise.race(pending);
        startMore();
      }
      if (failed) {
        controller.error(failed);
        return;
      }
      if (nextToEmit >= items.length) {
        if (footerBytes && !footerSent) {
          footerSent = true;
          controller.enqueue(footerBytes);
        }
        controller.close();
        return;
      }
      const buf = completed.get(nextToEmit);
      completed.delete(nextToEmit);
      nextToEmit++;
      controller.enqueue(new Uint8Array(buf));
      startMore();
    },
    cancel() {
      cancelled = true;
    }
  });
}

async function handleDownload(request) {
  const params = new URL(request.url).searchParams;
  const playlist = params.get("playlist");
  const ref = params.get("ref");
  const name = (params.get("name") || "video").replace(/["\r\n]/g, "");
  const heightParam = params.get("height");
  const targetHeight = heightParam ? Number(heightParam) : undefined;

  if (!playlist) return json({ error: "MISSING_PLAYLIST" }, 400);
  try {
    if (new URL(playlist).protocol !== "https:") return json({ error: "INVALID_PROTOCOL" }, 400);
  } catch {
    return json({ error: "INVALID_URL" }, 400);
  }

  const upstreamHeaders = buildUpstreamHeaders(request, ref, null);

  let rootText;
  let mediaPlaylistUrl = playlist;
  try {
    const res = await fetch(playlist, { headers: upstreamHeaders });
    if (!res.ok) return json({ error: "PLAYLIST_FETCH_FAILED", status: res.status }, res.status);
    rootText = await res.text();
  } catch {
    return json({ error: "UPSTREAM_UNREACHABLE" }, 502);
  }

  if (isMasterPlaylist(rootText)) {
    const variants = parseMasterPlaylist(rootText, playlist);
    if (!variants.length) return json({ error: "NO_VARIANTS_FOUND" }, 422);
    const chosen = targetHeight
      ? variants.reduce((best, v) =>
          Math.abs((v.height ?? 0) - targetHeight) < Math.abs((best.height ?? 0) - targetHeight) ? v : best
        )
      : variants.reduce((best, v) => (v.bandwidth > best.bandwidth ? v : best));
    mediaPlaylistUrl = chosen.uri;
    try {
      const mres = await fetch(mediaPlaylistUrl, { headers: upstreamHeaders });
      if (!mres.ok) return json({ error: "PLAYLIST_FETCH_FAILED", status: mres.status }, mres.status);
      rootText = await mres.text();
    } catch {
      return json({ error: "UPSTREAM_UNREACHABLE" }, 502);
    }
  }

  const { segments, mapUri } = parseMediaPlaylist(rootText, mediaPlaylistUrl);
  if (!segments.length) return json({ error: "NO_SEGMENTS_FOUND" }, 422);
  for (const seg of segments) {
    if (seg.key && seg.key.method !== "AES-128") return json({ error: "ENCRYPTED_STREAM_UNSUPPORTED" }, 422);
  }

  const keyCache = new Map();
  async function getAesKey(keyUri) {
    let p = keyCache.get(keyUri);
    if (!p) {
      p = fetch(keyUri, { headers: upstreamHeaders })
        .then((r) => r.arrayBuffer())
        .then((buf) => crypto.subtle.importKey("raw", buf, { name: "AES-CBC" }, false, ["decrypt"]));
      keyCache.set(keyUri, p);
    }
    return p;
  }

  async function fetchItem(item) {
    const res = await fetch(item.uri, { headers: upstreamHeaders });
    if (!res.ok) throw new Error(`SEGMENT_FETCH_FAILED_${res.status}`);
    const buf = await res.arrayBuffer();
    if (!item.key) return buf;
    const aesKey = await getAesKey(item.key.keyUri);
    const iv = item.key.ivHex ? hexToBytes(item.key.ivHex) : sequenceToIv(item.sequence);
    return crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, buf);
  }

  const items = mapUri ? [{ uri: mapUri, key: null, sequence: -1 }, ...segments] : segments;
  const container = mapUri ? "mp4" : "ts";
  const stream = createOrderedStream(items, fetchItem);

  return new Response(stream, {
    headers: {
      "Content-Type": container === "mp4" ? "video/mp4" : "video/mp2t",
      "Content-Disposition": `attachment; filename="${name}.${container}"`,
      "Cache-Control": "no-store",
      ...CORS_HEADERS
    }
  });
}

// ---------- mode 3: chunked download (free-plan friendly) ----------
//
// Cloudflare Workers on the Free plan are hard-capped at 50 external
// subrequests per invocation — a 2h+ HLS video can have 500-1000+
// segments, so a single /download call (mode 2 above) simply gets cut
// off mid-file once it hits that cap. Free-plan-friendly answer: split
// the work across many small invocations instead of one huge one. The
// client calls this endpoint repeatedly with a `start`/`count` window
// (count capped server-side well under 50), and stitches the chunks
// together itself — either straight to disk via the File System Access
// API (no memory ceiling) or, as a fallback, into one Blob at the end.

const MAX_CHUNK_SEGMENTS = 40;

async function handleDownloadRange(request) {
  const params = new URL(request.url).searchParams;
  const playlist = params.get("playlist");
  const ref = params.get("ref");
  const heightParam = params.get("height");
  const targetHeight = heightParam ? Number(heightParam) : undefined;
  const start = Math.max(0, Number(params.get("start") ?? "0") || 0);
  const requestedCount = Number(params.get("count") ?? String(MAX_CHUNK_SEGMENTS)) || MAX_CHUNK_SEGMENTS;
  const count = Math.min(Math.max(1, requestedCount), MAX_CHUNK_SEGMENTS);

  if (!playlist) return json({ error: "MISSING_PLAYLIST" }, 400);
  try {
    if (new URL(playlist).protocol !== "https:") return json({ error: "INVALID_PROTOCOL" }, 400);
  } catch {
    return json({ error: "INVALID_URL" }, 400);
  }

  const upstreamHeaders = buildUpstreamHeaders(request, ref, null);

  let rootText;
  let mediaPlaylistUrl = playlist;
  try {
    const res = await fetch(playlist, { headers: upstreamHeaders });
    if (!res.ok) return json({ error: "PLAYLIST_FETCH_FAILED", status: res.status }, res.status);
    rootText = await res.text();
  } catch {
    return json({ error: "UPSTREAM_UNREACHABLE" }, 502);
  }

  if (isMasterPlaylist(rootText)) {
    const variants = parseMasterPlaylist(rootText, playlist);
    if (!variants.length) return json({ error: "NO_VARIANTS_FOUND" }, 422);
    const chosen = targetHeight
      ? variants.reduce((best, v) =>
          Math.abs((v.height ?? 0) - targetHeight) < Math.abs((best.height ?? 0) - targetHeight) ? v : best
        )
      : variants.reduce((best, v) => (v.bandwidth > best.bandwidth ? v : best));
    mediaPlaylistUrl = chosen.uri;
    try {
      const mres = await fetch(mediaPlaylistUrl, { headers: upstreamHeaders });
      if (!mres.ok) return json({ error: "PLAYLIST_FETCH_FAILED", status: mres.status }, mres.status);
      rootText = await mres.text();
    } catch {
      return json({ error: "UPSTREAM_UNREACHABLE" }, 502);
    }
  }

  const { segments, mapUri } = parseMediaPlaylist(rootText, mediaPlaylistUrl);
  if (!segments.length) return json({ error: "NO_SEGMENTS_FOUND" }, 422);
  for (const seg of segments) {
    if (seg.key && seg.key.method !== "AES-128") return json({ error: "ENCRYPTED_STREAM_UNSUPPORTED" }, 422);
  }

  const container = mapUri ? "mp4" : "ts";
  const rangeSegments = segments.slice(start, start + count);
  if (start < segments.length && rangeSegments.length === 0) {
    return json({ error: "EMPTY_RANGE" }, 422);
  }

  const keyCache = new Map();
  async function getAesKey(keyUri) {
    let p = keyCache.get(keyUri);
    if (!p) {
      p = fetch(keyUri, { headers: upstreamHeaders })
        .then((r) => r.arrayBuffer())
        .then((buf) => crypto.subtle.importKey("raw", buf, { name: "AES-CBC" }, false, ["decrypt"]));
      keyCache.set(keyUri, p);
    }
    return p;
  }

  async function fetchItem(item) {
    const res = await fetch(item.uri, { headers: upstreamHeaders });
    if (!res.ok) throw new Error(`SEGMENT_FETCH_FAILED_${res.status}`);
    const buf = await res.arrayBuffer();
    if (!item.key) return buf;
    const aesKey = await getAesKey(item.key.keyUri);
    const iv = item.key.ivHex ? hexToBytes(item.key.ivHex) : sequenceToIv(item.sequence);
    return crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, buf);
  }

  // The fMP4 init segment (EXT-X-MAP) isn't part of the numbered
  // segment list, so it only rides along with chunk 0 — not counted
  // against `count`, never re-sent on later chunks.
  const items = start === 0 && mapUri ? [{ uri: mapUri, key: null, sequence: -1 }, ...rangeSegments] : rangeSegments;
  const stream = createOrderedStream(items, fetchItem);

  return new Response(stream, {
    headers: {
      "Content-Type": container === "mp4" ? "video/mp4" : "video/mp2t",
      "Cache-Control": "no-store",
      "X-Total-Segments": String(segments.length),
      "X-Container": container,
      "X-Range-Start": String(start),
      "X-Range-Count": String(rangeSegments.length),
      ...CHUNK_CORS_HEADERS
    }
  });
}

// ---------- mode 4: lean batch fetch (playlist parsed client-side) ----------
//
// /download-range (mode 3) still re-fetches and re-parses the *entire*
// playlist on every single chunk call, and for a long VOD playlist
// (hundreds of lines, regex per line) that parsing work itself is real
// CPU time — on top of N segment fetches and their AES-128 decrypts.
// Free-plan Workers get just 10ms of *CPU* time per invocation (fetch
// I/O wait doesn't count against that, but JS execution does), and
// repeating full-playlist parsing on every chunk is exactly the kind
// of redundant work that blows through it — inconsistently, since it
// depends on playlist size and how much decrypt work lands in the same
// invocation. This mode removes that redundancy entirely: the browser
// (no CPU-time limit) fetches+parses the playlist *once*, then just
// hands this endpoint an already-resolved list of segment (and key)
// URLs to fetch and decrypt — no parsing here at all.
//
// POST /fetch-batch  { items: [{ uri, sequence, key: {method,keyUri,ivHex}|null }], ref }
// Response: raw concatenated (decrypted) bytes for that batch, in
// order, followed by a 4-byte end marker (BATCH_END_MARKER below).
//
// The marker exists because a Worker invocation that gets killed mid-
// stream (CPU-time limit, subrequest cap, transient upstream failure
// on a later segment) can otherwise look like a perfectly valid,
// shorter HTTP response to the client — `res.ok` is true and
// `res.arrayBuffer()` resolves fine, it's just missing the tail end of
// the batch. That silent truncation is what used to produce a video
// with a clean-looking but missing chunk in the middle, with the
// progress bar still counting the whole batch as done. The client
// (lib/chunkedDownload.ts) now checks the buffer ends with this exact
// marker before trusting it, strips it, and otherwise retries the
// whole batch — so a truncated batch either self-heals via retry or
// surfaces as a visible download error, never a silent gap.
const BATCH_END_MARKER = new TextEncoder().encode("NXOK");

async function handleFetchBatch(request) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_BODY" }, 400);
  }

  const items = Array.isArray(body?.items) ? body.items : null;
  const ref = typeof body?.ref === "string" ? body.ref : null;
  if (!items || items.length === 0) return json({ error: "MISSING_ITEMS" }, 400);
  if (items.length > 45) return json({ error: "TOO_MANY_ITEMS" }, 400);
  for (const item of items) {
    if (typeof item?.uri !== "string") return json({ error: "INVALID_ITEM" }, 400);
    if (item.key && item.key.method !== "AES-128") return json({ error: "ENCRYPTED_STREAM_UNSUPPORTED" }, 422);
  }

  const upstreamHeaders = buildUpstreamHeaders(request, ref, null);

  const keyCache = new Map();
  async function getAesKey(keyUri) {
    let p = keyCache.get(keyUri);
    if (!p) {
      p = fetch(keyUri, { headers: upstreamHeaders })
        .then((r) => r.arrayBuffer())
        .then((buf) => crypto.subtle.importKey("raw", buf, { name: "AES-CBC" }, false, ["decrypt"]));
      keyCache.set(keyUri, p);
    }
    return p;
  }

  async function fetchItem(item) {
    const res = await fetch(item.uri, { headers: upstreamHeaders });
    if (!res.ok) throw new Error(`SEGMENT_FETCH_FAILED_${res.status}`);
    const buf = await res.arrayBuffer();
    if (!item.key) return buf;
    const aesKey = await getAesKey(item.key.keyUri);
    const iv = item.key.ivHex ? hexToBytes(item.key.ivHex) : sequenceToIv(item.sequence ?? 0);
    return crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, buf);
  }

  const stream = createOrderedStream(items, fetchItem, BATCH_END_MARKER);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Batch-Segment-Count": String(items.length),
      ...CORS_HEADERS
    }
  });
}

// ---------- entry point ----------

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          ...CORS_HEADERS,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Content-Type"
        }
      });
    }

    if (url.pathname === "/download") return handleDownload(request);
    if (url.pathname === "/download-range") return handleDownloadRange(request);
    if (url.pathname === "/fetch-batch") return handleFetchBatch(request);
    return handlePlaybackProxy(request);
  }
};
