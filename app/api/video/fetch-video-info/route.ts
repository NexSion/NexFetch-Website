import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

// GET api/video/fetch-video-info?url=<page-url>
// Contract: called by the extension's "Last Resort" fallback path when
// on-page detection finds nothing. Expects
//   { success: true, data: { found: boolean, title?, ext?, ... } }
// Cached for an hour (free) / an hour (premium) per the extension's own
// TTL logic (dataExpiry.free / dataExpiry.premium), so we mirror that
// here with a simple timestamped cache table instead of re-fetching
// every call.
//
// NOTE: this stub only reads the page's <title> and any og:video /
// twitter:player meta tags — it does not attempt full yt-dlp-style
// extraction for every site (YouTube, Vimeo, DRM'd platforms, etc.).
// That is real, sizeable scope on its own; wire in a proper extractor
// service here before relying on this in production.
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ success: false, error: "URL_REQUIRED" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad protocol");
  } catch {
    return NextResponse.json({ success: false, error: "INVALID_URL" }, { status: 400 });
  }

  const urlHash = createHash("sha256").update(url).digest("hex");
  const supabase = createSupabaseServiceClient();

  const { data: cached } = await supabase
    .from("video_info_cache")
    .select("data, fetched_at")
    .eq("url_hash", urlHash)
    .maybeSingle();

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
    return NextResponse.json({ success: true, data: cached.data });
  }

  let data: Record<string, unknown> = { found: false };

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NexFetchBot/1.0)" },
      signal: AbortSignal.timeout(8000)
    });
    const html = await res.text();

    const title =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<title>([^<]+)<\/title>/i)?.[1] ??
      null;

    const videoUrl =
      html.match(/<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      null;

    data = {
      found: Boolean(title || videoUrl),
      title: title?.trim() ?? null,
      videoUrl,
      sourceUrl: url
    };
  } catch (err) {
    data = { found: false, error: err instanceof Error ? err.message : "fetch_failed" };
  }

  await supabase.from("video_info_cache").upsert({
    url_hash: urlHash,
    url,
    data,
    fetched_at: new Date().toISOString()
  });

  return NextResponse.json({ success: true, data });
}
