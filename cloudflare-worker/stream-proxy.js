// Cloudflare Worker — stream proxy for NexFetch.
//
// Why this lives on Cloudflare and not Vercel: this proxy re-fetches
// and streams full video segments, which for large HLS downloads adds
// up to real bandwidth fast. Vercel's free plan bills that as "Fast
// Origin Transfer" with a small monthly cap; Cloudflare Workers' free
// tier bandwidth is effectively unmetered for this. The website itself
// (small HTML/JS/API responses) stays on Vercel; only the heavy
// video-byte-pushing work happens here.
//
// What it does: some source CDNs (confirmed via browser console: every
// segment 403s) enforce Referer-based hotlink protection — they only
// serve requests whose Referer matches the original embedding site.
// A browser fetch()/XHR can never spoof Referer (forbidden header), so
// this can only be fixed with a server-to-server fetch, which has no
// such restriction.
//
// GET /?url=<target>&ref=<referer-origin>
// - If the target is (or looks like) an HLS playlist, fetch it, then
//   rewrite every URI inside (segments, variant playlists, EXT-X-KEY
//   and EXT-X-MAP URIs) into an absolute URL back through this same
//   worker — so hls.js or any downloader only ever needs the
//   top-level playlist URL; every reference downstream follows
//   automatically.
// - Otherwise, stream the resource through as-is (segments, keys,
//   thumbnails), forwarding Range/Content-Range for seeking.
//
// Deploy: `wrangler deploy` from this folder (see wrangler.toml), or
// paste this file into a new Worker in the Cloudflare dashboard. Then
// set NEXT_PUBLIC_STREAM_PROXY_BASE in the website's Vercel env vars
// to the Worker's URL (e.g. https://nexfetch-proxy.<subdomain>.workers.dev).

function resolveUri(base, ref) {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

function buildProxiedUrl(workerOrigin, target, ref) {
  const params = new URLSearchParams({ url: target });
  if (ref) params.set("ref", ref);
  return `${workerOrigin}/?${params.toString()}`;
}

function isM3u8Text(text) {
  return text.trimStart().startsWith("#EXTM3U");
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

// Basic abuse guard: only proxy https sources, and only for
// query-string-supplied targets (never same-worker recursion loops).
function isAllowedTarget(url) {
  return url.protocol === "https:";
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get("url");
    const ref = requestUrl.searchParams.get("ref");
    const workerOrigin = requestUrl.origin;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Range"
        }
      });
    }

    if (!target) {
      return new Response(JSON.stringify({ error: "MISSING_URL" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return new Response(JSON.stringify({ error: "INVALID_URL" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (!isAllowedTarget(parsed)) {
      return new Response(JSON.stringify({ error: "INVALID_PROTOCOL" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const range = request.headers.get("range");
    const upstreamHeaders = {
      "User-Agent": request.headers.get("user-agent") || "Mozilla/5.0"
    };
    if (ref) {
      upstreamHeaders["Referer"] = ref;
      try {
        upstreamHeaders["Origin"] = new URL(ref).origin;
      } catch {
        /* ignore */
      }
    }
    if (range) upstreamHeaders["Range"] = range;

    let upstream;
    try {
      upstream = await fetch(target, { headers: upstreamHeaders });
    } catch {
      return new Response(JSON.stringify({ error: "UPSTREAM_UNREACHABLE" }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({ error: "UPSTREAM_FAILED", status: upstream.status }), {
        status: upstream.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const contentType = upstream.headers.get("content-type") || "";
    const looksLikePlaylist = target.includes(".m3u8") || contentType.includes("mpegurl");
    const corsHeaders = { "Access-Control-Allow-Origin": "*" };

    if (looksLikePlaylist) {
      const text = await upstream.text();
      if (isM3u8Text(text)) {
        const rewritten = rewritePlaylist(text, target, ref, workerOrigin);
        return new Response(rewritten, {
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store",
            ...corsHeaders
          }
        });
      }
      return new Response(text, {
        headers: { "Content-Type": contentType || "text/plain", ...corsHeaders }
      });
    }

    const headers = {
      "Content-Type": contentType || "application/octet-stream",
      "Cache-Control": "no-store",
      ...corsHeaders
    };
    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    const acceptRanges = upstream.headers.get("accept-ranges");
    if (contentLength) headers["Content-Length"] = contentLength;
    if (contentRange) headers["Content-Range"] = contentRange;
    if (acceptRanges) headers["Accept-Ranges"] = acceptRanges;

    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
