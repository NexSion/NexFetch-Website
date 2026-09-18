"use client";

// Client helper for the Cloudflare Worker proxy (see
// /cloudflare-worker/stream-proxy.js). Only used when a source CDN's
// Referer-based hotlink protection blocks direct browser requests —
// most sources don't need it, so callers probe first and only route
// through the proxy for the ones that actually 403 directly. This
// keeps proxy bandwidth (and Cloudflare Worker invocations) limited to
// the streams that genuinely require it, per NexApp's request.

function proxyBase(): string | null {
  const base = process.env.NEXT_PUBLIC_STREAM_PROXY_BASE;
  return base ? base.replace(/\/$/, "") : null;
}

export function buildProxiedUrl(target: string, refererUrl: string | null): string {
  const base = proxyBase();
  if (!base) return target; // proxy not configured — fail open to direct
  const params = new URLSearchParams({ url: target });
  if (refererUrl) params.set("ref", refererUrl);
  return `${base}/?${params.toString()}`;
}

// Best-effort Referer to present upstream: the page that originally
// embedded this video, falling back to the CDN's own origin.
export function refererFor(payload: { source_url?: string | null; url: string }): string | null {
  if (payload.source_url) {
    try {
      return new URL(payload.source_url).origin + "/";
    } catch {
      /* fall through */
    }
  }
  try {
    return new URL(payload.url).origin + "/";
  } catch {
    return null;
  }
}

// One lightweight probe against the top-level playlist URL decides
// proxy-or-not for the whole playback/download session — a source's
// hotlink policy applies per-domain, not per-segment, so this single
// check is representative of every segment that stream will serve.
export async function needsProxy(url: string): Promise<boolean> {
  if (!proxyBase()) return false; // nothing to fall back to — always try direct
  try {
    const res = await fetch(url, { method: "GET" });
    return !res.ok;
  } catch {
    return true;
  }
}

// Resolves the URL a player/downloader should actually use: direct
// when reachable, proxied only when the direct probe failed.
export async function resolvePlayableUrl(
  payload: { source_url?: string | null; url: string },
  targetUrl: string = payload.url
): Promise<string> {
  if (await needsProxy(targetUrl)) {
    return buildProxiedUrl(targetUrl, refererFor(payload));
  }
  return targetUrl;
}
